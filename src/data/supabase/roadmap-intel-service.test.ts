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

/** When set, the measurements table answers with a Postgrest error instead. */
let measurementsFail: { code: string; message: string } | null = null;

function failingQuery(error: { code: string; message: string }) {
  const query = {
    select: () => query,
    insert: () => query,
    eq: () => query,
    order: () => query,
    limit: () => query,
    single: () => Promise.resolve({ data: null, error }),
    maybeSingle: () => Promise.resolve({ data: null, error }),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, error }).then(resolve),
  };
  return query;
}

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    from: (table: string) =>
      table === "roadmap_measurements" && measurementsFail
        ? (failingQuery(measurementsFail) as unknown as ReturnType<typeof db.from>)
        : db.from(table),
  },
}));

const { roadmapIntel } = await import("./roadmap-intel-service");
const { isBuildOrderReady } = await import("@/domain/roadmap-intel");

const CONTEXT = { organizationId: "org-1", userId: "user-1", userLabel: "Tai" };
const ROADMAP = "roadmap-1";

const SOURCE = {
  label: "Northbeam. About",
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
  measurementsFail = null;
});

const METRIC = {
  key: "demo_to_close_rate",
  label: "Demo to close rate",
  unit: "%",
  direction: "increase" as const,
  baseline: { value: 12, at: "2026-09-01" },
  target: { value: 25, at: "2026-12-01" },
};

/** One approved milestone that already carries an outcome metric. */
async function measured() {
  const written = await roadmapIntel.replaceCandidates(CONTEXT, ROADMAP, "Northbeam", [
    candidate("Method page"),
  ]);
  return roadmapIntel.setMilestoneMetric(CONTEXT, written[0]!, METRIC, "Northbeam");
}

describe("measurements", () => {
  const READING = { value: 18, measuredAt: "2026-09-15", source: "Stripe dashboard" };

  it("records a reading as human evidence with the actor on it", async () => {
    const milestone = await measured();
    const saved = await roadmapIntel.recordMeasurement(CONTEXT, milestone, READING, "Northbeam");

    expect(saved.value).toBe(18);
    expect(saved.measuredAt).toBe("2026-09-15");
    expect(saved.source).toBe("Stripe dashboard");
    expect(saved.recordedBy).toBe("user-1");
    expect(saved.metricKey).toBe("demo_to_close_rate");
    expect(saved.milestoneId).toBe(milestone.id);
    expect(saved.roadmapId).toBe(ROADMAP);
  });

  it("accepts zero as a real reading", async () => {
    const milestone = await measured();
    const saved = await roadmapIntel.recordMeasurement(
      CONTEXT,
      milestone,
      { ...READING, value: 0 },
      "Northbeam",
    );
    expect(saved.value).toBe(0);
  });

  it("refuses a reading when the milestone has no metric, before any write", async () => {
    const written = await roadmapIntel.replaceCandidates(CONTEXT, ROADMAP, "Northbeam", [
      candidate("Method page"),
    ]);
    await expect(
      roadmapIntel.recordMeasurement(CONTEXT, written[0]!, READING, "Northbeam"),
    ).rejects.toThrow(/outcome metric/i);
    expect(db.tables["roadmap_measurements"] ?? []).toHaveLength(0);
  });

  it("refuses a missing value, an unreal date and an empty source", async () => {
    const milestone = await measured();
    for (const bad of [
      { ...READING, value: "" as unknown as number },
      { ...READING, measuredAt: "" },
      { ...READING, measuredAt: "2026-02-31" },
      { ...READING, source: " " },
      { ...READING, source: "manual" },
    ]) {
      await expect(
        roadmapIntel.recordMeasurement(CONTEXT, milestone, bad, "Northbeam"),
      ).rejects.toThrow();
    }
    expect(db.tables["roadmap_measurements"] ?? []).toHaveLength(0);
  });

  it("refuses a milestone that belongs to another organization", async () => {
    const milestone = await measured();
    await expect(
      roadmapIntel.recordMeasurement(
        { ...CONTEXT, organizationId: "org-2" },
        milestone,
        READING,
        "Northbeam",
      ),
    ).rejects.toThrow(/another organization/i);
    expect(db.tables["roadmap_measurements"] ?? []).toHaveLength(0);
  });

  it("replays as one measurement and one event", async () => {
    const milestone = await measured();
    const first = await roadmapIntel.recordMeasurement(CONTEXT, milestone, READING, "Northbeam");
    const events = (db.tables["activities"] ?? []).filter(
      (row) => (row as Record<string, unknown>)["event_type"] === "roadmap.measured",
    ).length;

    const again = await roadmapIntel.recordMeasurement(CONTEXT, milestone, READING, "Northbeam");
    expect(again.id).toBe(first.id);
    expect(db.tables["roadmap_measurements"]).toHaveLength(1);
    expect(
      (db.tables["activities"] ?? []).filter(
        (row) => (row as Record<string, unknown>)["event_type"] === "roadmap.measured",
      ),
    ).toHaveLength(events);
  });

  it("records exactly one event, carrying the reading and its replay key", async () => {
    const milestone = await measured();
    const saved = await roadmapIntel.recordMeasurement(CONTEXT, milestone, READING, "Northbeam");
    const events = (db.tables["activities"] ?? []).filter(
      (row) => (row as Record<string, unknown>)["event_type"] === "roadmap.measured",
    );
    expect(events).toHaveLength(1);
    const payload = (events[0] as Record<string, unknown>)["payload"] as Record<string, unknown>;
    expect(payload["measurementId"]).toBe(saved.id);
    expect(payload["milestoneId"]).toBe(milestone.id);
    expect(payload["metricKey"]).toBe("demo_to_close_rate");
    expect(payload["value"]).toBe(18);
    expect(payload["source"]).toBe("Stripe dashboard");
    expect(String(payload["source_event_key"])).toContain("roadmap.measured:");
    expect((events[0] as Record<string, unknown>)["actor_user_id"]).toBe("user-1");
  });

  it("never touches the metric baseline or target", async () => {
    const milestone = await measured();
    await roadmapIntel.recordMeasurement(CONTEXT, milestone, READING, "Northbeam");
    const intel = await roadmapIntel.load(ROADMAP);
    const metric = intel.milestones[0]!.outcomeMetric;
    expect(metric?.baseline).toEqual({ value: 12, at: "2026-09-01" });
    expect(metric?.target).toEqual({ value: 25, at: "2026-12-01" });
  });

  it("reads history newest first", async () => {
    const milestone = await measured();
    await roadmapIntel.recordMeasurement(
      CONTEXT,
      milestone,
      { ...READING, measuredAt: "2026-09-01", value: 12 },
      "Northbeam",
    );
    await roadmapIntel.recordMeasurement(
      CONTEXT,
      milestone,
      { ...READING, measuredAt: "2026-09-20", value: 21 },
      "Northbeam",
    );
    const history = await roadmapIntel.listMeasurements(milestone.id);
    expect(history.map((entry) => entry.measuredAt)).toEqual(["2026-09-20", "2026-09-01"]);

    const intel = await roadmapIntel.load(ROADMAP);
    expect(intel.measurements.map((entry) => entry.value)).toEqual([21, 12]);
    expect(intel.measurementsError).toBeNull();
  });

  it("an unreadable measurement store is said out loud, not read as an empty history", async () => {
    measurementsFail = { code: "42P01", message: "relation roadmap_measurements does not exist" };
    const intel = await roadmapIntel.load(ROADMAP);
    expect(intel.measurements).toEqual([]);
    expect(intel.measurementsError).toContain("could not be read");
  });

  it("says the store is missing rather than pretending the reading saved", async () => {
    const milestone = await measured();
    measurementsFail = { code: "42P01", message: "relation roadmap_measurements does not exist" };
    await expect(
      roadmapIntel.recordMeasurement(CONTEXT, milestone, READING, "Northbeam"),
    ).rejects.toThrow(/not available in this environment/i);
  });
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

  it("records an outcome metric as decided truth with provenance", async () => {
    const written = await roadmapIntel.replaceCandidates(CONTEXT, ROADMAP, "Northbeam", [
      candidate("Method page"),
    ]);
    const updated = await roadmapIntel.setMilestoneMetric(
      CONTEXT,
      written[0]!,
      {
        key: "Demo to close rate",
        label: "Demo to close rate",
        unit: "%",
        direction: "increase",
        baseline: { value: 12, at: "2026-09-01" },
        target: { value: 25, at: "2026-12-01" },
      },
      "Northbeam",
    );

    expect(updated.outcomeMetric?.key).toBe("demo_to_close_rate");
    expect(updated.outcomeMetric?.tier).toBe("decided");
    expect(updated.outcomeMetric?.recordedBy).toBe("user-1");
    expect(updated.outcomeMetric?.baseline?.value).toBe(12);
  });

  it("a milestone with no metric reads as absence, not zero", async () => {
    const written = await roadmapIntel.replaceCandidates(CONTEXT, ROADMAP, "Northbeam", [
      candidate("Method page"),
    ]);
    expect(written[0]!.outcomeMetric).toBeNull();
  });

  it("refuses an incomplete metric instead of inventing a default", async () => {
    const written = await roadmapIntel.replaceCandidates(CONTEXT, ROADMAP, "Northbeam", [
      candidate("Method page"),
    ]);
    await expect(
      roadmapIntel.setMilestoneMetric(
        CONTEXT,
        written[0]!,
        {
          key: "rate",
          label: "Rate",
          unit: "%",
          direction: "increase",
          baseline: { value: 12, at: "2026-09-01" },
          target: { value: 4, at: "2026-12-01" },
        },
        "Northbeam",
      ),
    ).rejects.toThrow();
    const intel = await roadmapIntel.load(ROADMAP);
    expect(intel.milestones[0]!.outcomeMetric).toBeNull();
  });

  it("creates a manual milestone as decided truth with the person on it", async () => {
    const created = await roadmapIntel.createManualMilestone(CONTEXT, ROADMAP, "Northbeam", {
      name: "  Launch the question bank ",
    });
    expect(created.name).toBe("Launch the question bank");
    expect(created.status).toBe("approved");
    expect(created.tier).toBe("decided");
    expect(created.ownerLabel).toBe("Tai");
    expect(created.decidedBy).toBe("user-1");
    expect(created.outcomeMetric).toBeNull();
  });

  it("a manual milestone invents nothing a person did not type", async () => {
    const created = await roadmapIntel.createManualMilestone(CONTEXT, ROADMAP, "Northbeam", {
      name: "Question bank",
    });
    expect(created.whatWeBuild).toBe("");
    expect(created.executionBoundary).toBe("");
    expect(created.priorityScore).toBe(0);
    expect(created.evidence).toEqual([]);
  });

  it("a manual milestone records one activity with a replay key", async () => {
    const before = (db.tables["activities"] ?? []).length;
    await roadmapIntel.createManualMilestone(CONTEXT, ROADMAP, "Northbeam", {
      name: "Question bank",
    });
    const rows = db.tables["activities"] ?? [];
    expect(rows.length).toBe(before + 1);
    const payload = (rows[rows.length - 1] as Record<string, unknown>)["payload"] as Record<
      string,
      unknown
    >;
    expect(payload["origin"]).toBe("manual");
    expect(String(payload["source_event_key"])).toContain("roadmap.milestone_created");
  });

  it("refuses a nameless manual milestone instead of naming it", async () => {
    await expect(
      roadmapIntel.createManualMilestone(CONTEXT, ROADMAP, "Northbeam", { name: "  " }),
    ).rejects.toThrow(/name/i);
    const intel = await roadmapIntel.load(ROADMAP);
    expect(intel.milestones.length).toBe(0);
  });

  it("a repeat save of the same name returns the existing milestone", async () => {
    const first = await roadmapIntel.createManualMilestone(CONTEXT, ROADMAP, "Northbeam", {
      name: "Question bank",
    });
    const before = (db.tables["activities"] ?? []).length;
    const again = await roadmapIntel.createManualMilestone(
      CONTEXT,
      ROADMAP,
      "Northbeam",
      { name: "  question   BANK " },
      [first],
    );
    expect(again.id).toBe(first.id);
    expect((db.tables["activities"] ?? []).length).toBe(before);
  });

  it("setting the same metric again records no second event", async () => {
    const written = await roadmapIntel.replaceCandidates(CONTEXT, ROADMAP, "Northbeam", [
      candidate("Method page"),
    ]);
    const input = {
      key: "demo_to_close_rate",
      label: "Demo to close rate",
      unit: "%",
      direction: "increase" as const,
      baseline: { value: 12, at: "2026-09-01" },
      target: { value: 25, at: "2026-12-01" },
    };
    const first = await roadmapIntel.setMilestoneMetric(CONTEXT, written[0]!, input, "Northbeam");
    const before = (db.tables["activities"] ?? []).length;
    const again = await roadmapIntel.setMilestoneMetric(CONTEXT, first, input, "Northbeam");
    expect((db.tables["activities"] ?? []).length).toBe(before);
    expect(again.outcomeMetric?.recordedAt).toBe(first.outcomeMetric?.recordedAt);
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
