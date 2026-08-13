/**
 * Integration tests for the live Roadmap Intelligence v2 persistence layer.
 *
 * The real service, the real row mappers and the real ranking engine run
 * against an in-memory Supabase stand-in whose tables mirror the applied v2
 * schema. What is checked is the behaviour the schema now supports: research
 * history, strategy approval as the only path from Inferred to Decided,
 * milestone decisions, Studio and Walkthrough capture, Ask persistence, the
 * idempotency of upserts, and that a Postgrest error surfaces as itself.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "./fake-supabase";

const db = createFakeSupabase();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    from: (table: string) => db.from(table),
  },
}));

const { roadmapIntel } = await import("./roadmap-intel-service");
const { isBuildOrderReady } = await import("@/domain/roadmap-intel");

const CONTEXT = { organizationId: "org-1", userId: "user-1", userLabel: "Tai" };
const ROADMAP = "roadmap-1";

const SOURCE = {
  label: "Northbeam — About",
  url: "https://northbeam.example/about",
  checkedAt: "2026-08-13T00:00:00.000Z",
  provider: "openai",
  model: "gpt-5-mini",
};

function research() {
  return {
    companyModel: [
      {
        statement: "Sells retained brand systems to founder-led firms.",
        tier: "observed" as const,
        confidence: "high" as const,
        sources: [SOURCE],
      },
    ],
    buyers: [],
    strengths: [],
    digitalPresence: [],
    competitors: [],
    marketDirection: [],
    sources: [SOURCE],
    unknowns: ["Pricing is not published."],
  };
}

function candidate(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    whatWeBuild: `A ${name} asset`,
    intendedUser: "The founder",
    evidence: [SOURCE],
    supportingMarketDirection: "Buyers increasingly self-serve before contact.",
    clientAdvantage: "Leadership already publishes original writing.",
    currentGap: "Nothing on the site explains the method.",
    immediateValue: "A page prospects can be sent today.",
    longTermValue: "A reusable spine for the whole site.",
    dependencies: [],
    executionBoundary: "Copy and build only. No paid media.",
    confidence: "high" as const,
    ...overrides,
  };
}

beforeEach(() => {
  for (const key of Object.keys(db.tables)) db.tables[key] = [];
});

describe("research", () => {
  it("appends a research pass with its provenance", async () => {
    const saved = await roadmapIntel.saveResearch(CONTEXT, ROADMAP, "Northbeam", research(), {
      provider: "openai",
      model: "gpt-5-mini",
      checkedAt: SOURCE.checkedAt,
    });

    expect(saved.status).toBe("complete");
    expect(saved.provider).toBe("openai");
    expect(saved.sources).toHaveLength(1);
    expect(saved.companyModel[0]?.tier).toBe("observed");
    expect(saved.unknowns).toEqual(["Pricing is not published."]);
  });

  it("keeps history rather than overwriting the previous pass", async () => {
    await roadmapIntel.saveResearch(CONTEXT, ROADMAP, "Northbeam", research(), {
      provider: "openai",
      model: "gpt-5-mini",
      checkedAt: SOURCE.checkedAt,
    });
    await roadmapIntel.saveResearch(CONTEXT, ROADMAP, "Northbeam", research(), {
      provider: "openai",
      model: "gpt-5-mini",
      checkedAt: "2026-08-14T00:00:00.000Z",
    });

    const intel = await roadmapIntel.load(ROADMAP);
    expect(intel.researchHistory).toHaveLength(2);
    expect(intel.research).not.toBeNull();
  });

  it("records the research on the activity log", async () => {
    await roadmapIntel.saveResearch(CONTEXT, ROADMAP, "Northbeam", research(), {
      provider: "openai",
      model: "gpt-5-mini",
      checkedAt: SOURCE.checkedAt,
    });
    expect((db.tables["activities"] ?? []).length).toBeGreaterThan(0);
  });
});

describe("strategy", () => {
  const base = {
    pointA: [
      {
        key: "point-a-1",
        statement: "Referral-led, with no public method.",
        because: "Read from the site.",
        tier: "observed" as const,
        confidence: "high" as const,
        sources: [SOURCE],
        approval: "proposed" as const,
      },
    ],
    anchorProof: [],
    horizon: [],
    pointB: {
      key: "point-b",
      statement: "A published method that sells before a call.",
      because: "Follows from the gap.",
      tier: "inferred" as const,
      confidence: "moderate" as const,
      sources: [SOURCE],
      approval: "proposed" as const,
    },
    pointC: null,
    centralTruth: null,
    gaps: [],
    leveragePoint: null,
  };

  it("proposes a strategy without deciding anything", async () => {
    const saved = await roadmapIntel.saveStrategy(CONTEXT, ROADMAP, "Northbeam", base);
    expect(saved.pointB?.approval).toBe("proposed");
    expect(saved.pointB?.tier).toBe("inferred");
  });

  it("upserts one strategy row per roadmap rather than duplicating", async () => {
    await roadmapIntel.saveStrategy(CONTEXT, ROADMAP, "Northbeam", base);
    await roadmapIntel.saveStrategy(CONTEXT, ROADMAP, "Northbeam", base);
    expect(db.tables["roadmap_strategies"]).toHaveLength(1);
  });

  it("only a human approval promotes an item to Decided", async () => {
    const saved = await roadmapIntel.saveStrategy(CONTEXT, ROADMAP, "Northbeam", base);
    const next = await roadmapIntel.setStrategyApproval(
      CONTEXT,
      saved,
      "point-b",
      "approved",
      "Northbeam",
    );
    expect(next.pointB?.approval).toBe("approved");
    expect(next.pointB?.tier).toBe("decided");
    expect(next.pointB?.approvedBy).toBe("user-1");
  });

  it("a rejection returns the item to Inferred and drops attribution", async () => {
    const saved = await roadmapIntel.saveStrategy(CONTEXT, ROADMAP, "Northbeam", base);
    const approved = await roadmapIntel.setStrategyApproval(
      CONTEXT,
      saved,
      "point-b",
      "approved",
      "Northbeam",
    );
    const rejected = await roadmapIntel.setStrategyApproval(
      CONTEXT,
      approved,
      "point-b",
      "rejected",
      "Northbeam",
    );
    expect(rejected.pointB?.approval).toBe("rejected");
    expect(rejected.pointB?.tier).toBe("inferred");
    expect(rejected.pointB?.approvedAt).toBeUndefined();
  });

  it("leaves untouched items exactly as they were", async () => {
    const saved = await roadmapIntel.saveStrategy(CONTEXT, ROADMAP, "Northbeam", base);
    const next = await roadmapIntel.setStrategyApproval(
      CONTEXT,
      saved,
      "point-b",
      "approved",
      "Northbeam",
    );
    expect(next.pointA[0]?.approval).toBe("proposed");
  });
});

describe("milestones", () => {
  it("writes ranked candidates as Inferred, never Decided", async () => {
    const written = await roadmapIntel.replaceCandidates(CONTEXT, ROADMAP, "Northbeam", [
      candidate("Method page"),
      candidate("Proof library", { confidence: "low", evidence: [] }),
    ]);

    expect(written).toHaveLength(2);
    expect(written.every((entry) => entry.tier === "inferred")).toBe(true);
    expect(written.every((entry) => entry.status === "candidate")).toBe(true);
    expect(written[0]!.priorityScore).toBeGreaterThanOrEqual(written[1]!.priorityScore);
    expect(written[0]!.priorityRationale.length).toBeGreaterThan(0);
  });

  it("regenerating replaces candidates but preserves human-decided rows", async () => {
    const written = await roadmapIntel.replaceCandidates(CONTEXT, ROADMAP, "Northbeam", [
      candidate("Method page"),
      candidate("Proof library"),
    ]);
    await roadmapIntel.setMilestoneStatus(CONTEXT, written[0]!, "approved", "Northbeam");

    await roadmapIntel.replaceCandidates(CONTEXT, ROADMAP, "Northbeam", [candidate("New idea")]);

    const intel = await roadmapIntel.load(ROADMAP);
    const names = intel.milestones.map((entry) => entry.name).sort();
    expect(names).toContain("New idea");
    expect(names).toContain(written[0]!.name);
    expect(names).not.toContain("Proof library");
  });

  it("approval is the only path into the Build Order", async () => {
    const written = await roadmapIntel.replaceCandidates(CONTEXT, ROADMAP, "Northbeam", [
      candidate("Method page"),
    ]);
    expect(isBuildOrderReady(written[0]!)).toBe(false);

    const approved = await roadmapIntel.setMilestoneStatus(
      CONTEXT,
      written[0]!,
      "approved",
      "Northbeam",
      "Clear first move.",
    );
    expect(approved.status).toBe("approved");
    expect(approved.tier).toBe("decided");
    expect(approved.decisionNote).toBe("Clear first move.");
    expect(isBuildOrderReady(approved)).toBe(true);
  });

  it("a deferral stays Inferred and out of the Build Order", async () => {
    const written = await roadmapIntel.replaceCandidates(CONTEXT, ROADMAP, "Northbeam", [
      candidate("Method page"),
    ]);
    const deferred = await roadmapIntel.setMilestoneStatus(
      CONTEXT,
      written[0]!,
      "deferred",
      "Northbeam",
    );
    expect(deferred.tier).toBe("inferred");
    expect(isBuildOrderReady(deferred)).toBe(false);
  });

  it("an approval attributes an owner when none is set", async () => {
    const written = await roadmapIntel.replaceCandidates(CONTEXT, ROADMAP, "Northbeam", [
      candidate("Method page"),
    ]);
    const approved = await roadmapIntel.setMilestoneStatus(
      CONTEXT,
      written[0]!,
      "approved",
      "Northbeam",
    );
    expect(approved.ownerLabel).toBe("Tai");
  });

  it("an owner can be set explicitly", async () => {
    const written = await roadmapIntel.replaceCandidates(CONTEXT, ROADMAP, "Northbeam", [
      candidate("Method page"),
    ]);
    const owned = await roadmapIntel.setMilestoneOwner(CONTEXT, written[0]!, "Ada Rowe");
    expect(owned.ownerLabel).toBe("Ada Rowe");
  });
});

describe("studio", () => {
  const sections = [
    {
      key: "point-a",
      title: "Where the business is today",
      body: ["Referral-led, with no public method."],
      tier: "observed" as const,
      sources: [SOURCE],
    },
  ];

  it("stores an artifact with its sections and evidence", async () => {
    const artifact = await roadmapIntel.saveArtifact(
      CONTEXT,
      ROADMAP,
      "preview",
      "Northbeam Roadmap Preview",
      sections,
    );
    expect(artifact.kind).toBe("preview");
    expect(artifact.sections[0]?.sources).toHaveLength(1);
  });

  it("regenerating the same kind updates one row instead of duplicating", async () => {
    await roadmapIntel.saveArtifact(CONTEXT, ROADMAP, "preview", "First", sections);
    await roadmapIntel.saveArtifact(CONTEXT, ROADMAP, "preview", "Second", sections);
    expect(db.tables["roadmap_artifacts"]).toHaveLength(1);
    const intel = await roadmapIntel.load(ROADMAP);
    expect(intel.artifacts[0]?.title).toBe("Second");
  });

  it("preview and full are separate artifacts", async () => {
    await roadmapIntel.saveArtifact(CONTEXT, ROADMAP, "preview", "Preview", sections);
    await roadmapIntel.saveArtifact(CONTEXT, ROADMAP, "full", "Full", sections);
    expect(db.tables["roadmap_artifacts"]).toHaveLength(2);
  });

  it("keeps the provider and model that wrote the document", async () => {
    const artifact = await roadmapIntel.saveArtifact(CONTEXT, ROADMAP, "preview", "P", sections, {
      provider: "openai",
      model: "gpt-5-mini",
      rejected: [{ section: "title", line: "42% growth", reason: "Not in the packet." }],
    });
    expect(artifact.provider).toBe("openai");
    expect(artifact.rejected).toHaveLength(1);
    expect(artifact.humanEdited).toBe(false);
  });

  it("a hand edit sticks and blocks a silent regeneration", async () => {
    const artifact = await roadmapIntel.saveArtifact(CONTEXT, ROADMAP, "preview", "P", sections);
    const edited = await roadmapIntel.editArtifact(CONTEXT, artifact, [
      { ...sections[0]!, body: ["Written by a person."] },
    ]);
    expect(edited.humanEdited).toBe(true);
    expect(edited.editedAt).toBeTruthy();

    await expect(
      roadmapIntel.saveArtifact(CONTEXT, ROADMAP, "preview", "P", sections),
    ).rejects.toThrow(/edited by hand/i);
  });

  it("an explicit replace overrides the hand edited document", async () => {
    const artifact = await roadmapIntel.saveArtifact(CONTEXT, ROADMAP, "preview", "P", sections);
    await roadmapIntel.editArtifact(CONTEXT, artifact, [
      { ...sections[0]!, body: ["Written by a person."] },
    ]);
    const replaced = await roadmapIntel.saveArtifact(
      CONTEXT,
      ROADMAP,
      "preview",
      "Replaced",
      sections,
      { replaceHumanEdits: true },
    );
    expect(replaced.title).toBe("Replaced");
    expect(replaced.humanEdited).toBe(false);
    expect(db.tables["roadmap_artifacts"]).toHaveLength(1);
  });
});


describe("walkthrough", () => {
  it("captures entries in the room, attributed and timestamped", async () => {
    const session = await roadmapIntel.startSession(CONTEXT, ROADMAP, "Northbeam");
    const withEntry = await roadmapIntel.appendEntry(CONTEXT, session, {
      kind: "approval",
      body: "Approved the method page in the room.",
    });
    expect(withEntry.entries).toHaveLength(1);
    expect(withEntry.entries[0]?.authorId).toBe("user-1");
    expect(withEntry.entries[0]?.at).toBeTruthy();
  });

  it("ends a session without losing its entries", async () => {
    const session = await roadmapIntel.startSession(CONTEXT, ROADMAP, "Northbeam");
    const withEntry = await roadmapIntel.appendEntry(CONTEXT, session, {
      kind: "note",
      body: "They want pricing clarity first.",
    });
    const ended = await roadmapIntel.endSession(CONTEXT, withEntry);
    expect(ended.endedAt).toBeTruthy();
    expect(ended.entries).toHaveLength(1);
  });
});

describe("ask", () => {
  it("stores facts, inferences and unknowns separately", async () => {
    const saved = await roadmapIntel.saveAnswer(CONTEXT, ROADMAP, {
      question: "Who do they sell to?",
      answer: "Founder-led firms, on the evidence available.",
      facts: [{ statement: "The site names founder-led firms.", sources: [SOURCE] }],
      inferences: ["Buying is likely founder-driven."],
      unknowns: ["Deal size is not published."],
      provider: "openai",
      model: "gpt-5-mini",
    });

    expect(saved.facts[0]?.sources).toHaveLength(1);
    expect(saved.inferences).toHaveLength(1);
    expect(saved.unknowns).toHaveLength(1);

    const intel = await roadmapIntel.load(ROADMAP);
    expect(intel.questions).toHaveLength(1);
  });
});

describe("errors", () => {
  it("surfaces a Postgrest error as itself, with no fallback data", async () => {
    const failing = {
      select: () => failing,
      eq: () => failing,
      order: () => failing,
      limit: () => failing,
      maybeSingle: async () => ({
        data: null,
        error: { message: 'relation "roadmap_research" does not exist' },
      }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: null,
          error: { message: 'relation "roadmap_research" does not exist' },
        }).then(resolve),
    };
    const supabaseModule = await import("@/integrations/trust-tai/supabase");
    const spy = vi
      .spyOn(supabaseModule.supabase, "from")
      .mockReturnValue(failing as unknown as ReturnType<typeof supabaseModule.supabase.from>);

    await expect(roadmapIntel.load(ROADMAP)).rejects.toThrow(
      'relation "roadmap_research" does not exist',
    );
    spy.mockRestore();
  });
});
