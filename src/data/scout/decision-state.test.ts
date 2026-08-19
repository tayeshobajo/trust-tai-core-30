import { describe, expect, it } from "vitest";

import { buildDecisionState, draftQuestionFor } from "./decision-state";
import { contradictions, evidenceCoverage, scoutRead } from "./research-brief";
import { researchPermission } from "./research-consent";
import { reviewStatedEvidence } from "./research-workspace";
import type { ActivityEvent } from "@/domain/activity";
import type { ProspectCandidate, ScoutSignal } from "@/domain/scout";
import type { FounderSignalPacket } from "@/domain/stated";

function signal(id: string, statement: string): ScoutSignal {
  return {
    id,
    statement,
    provenance: {
      appId: "scout",
      actor: { type: "system", id: "scout.research" },
      observedAt: "2026-08-19T10:00:00.000Z",
      confidence: "observed",
    },
    sourceUrl: "https://northwind.com/about",
  };
}

function packet(
  claims: FounderSignalPacket["claims"],
  authorizesResearch: boolean | null,
): FounderSignalPacket {
  return {
    submissionId: "sub_1",
    submissionRowId: "row_1",
    statedAt: "2026-08-18T09:00:00.000Z",
    claims,
    transcript: [],
    understanding: { authorizesResearch },
    attribution: {},
  };
}

function candidate(input: {
  stated?: FounderSignalPacket;
  signals?: ScoutSignal[];
  status?: string;
  score?: number;
  scoreable?: boolean;
}): ProspectCandidate {
  return {
    prospect: {
      id: "p1",
      organizationId: "org1",
      name: "Northwind",
      domain: "northwind.com",
      websiteUrl: "https://northwind.com",
      status: input.status ?? "discovered",
      createdAt: "2026-08-18T09:00:00.000Z",
      updatedAt: "2026-08-18T09:00:00.000Z",
    } as unknown as ProspectCandidate["prospect"],
    signals: input.signals ?? [],
    fit: { whyItFits: "", recommendation: "" },
    source: { kind: input.stated ? "website_intake" : "preview_demo", label: "src" },
    evaluation: {
      score: input.score ?? 40,
      criteria: [],
      scoreable: input.scoreable ?? false,
    } as unknown as ProspectCandidate["evaluation"],
    lastCheckedAt: "2026-08-19T10:00:00.000Z",
    ...(input.stated ? { stated: input.stated } : {}),
  };
}

function build(input: Parameters<typeof candidate>[0]) {
  const c = candidate(input);
  const review = reviewStatedEvidence(c);
  const permission = researchPermission(c);
  const coverage = evidenceCoverage(c, review.observed);
  const conflicts = contradictions(review);
  const read = scoutRead({ review, coverage, conflicts, permissionState: permission.state });
  return buildDecisionState({
    candidate: c,
    review,
    read,
    conflicts,
    permission,
    coverage,
    events: [],
  });
}

const RICH = [
  signal("s1", "The website ranks well for commercial roofing in Leeds."),
  signal("s2", "The contact form submits to a live inbox and confirms receipt."),
  signal("s3", "A Google Business Profile is claimed with 42 recent reviews."),
  signal("s4", "The site loads in under two seconds on mobile."),
];

describe("decision state", () => {
  it("suggests qualifying when fit is strong and evidence is broad", () => {
    const state = build({
      stated: packet([{ lane: "goals", statement: "Win more commercial roofing work" }], true),
      signals: RICH,
      score: 82,
      scoreable: true,
    });
    expect(state.inbound).toBe(true);
    expect(state.suggested.key).toBe("qualify");
  });

  it("holds when the evidence is sparse", () => {
    const state = build({
      stated: packet([{ lane: "pains", statement: "Nobody finds us online" }], true),
      signals: [signal("s1", "The website mentions commercial roofing.")],
      score: 60,
      scoreable: true,
    });
    expect(state.suggested.key).toBe("hold");
  });

  it("asks one more question when stated and observed disagree", () => {
    const state = build({
      stated: packet(
        [{ lane: "pains", statement: "We are invisible in search and nobody finds us" }],
        true,
      ),
      signals: [
        signal("s1", "The site shows strong organic search visibility for its main services."),
        ...RICH,
      ],
      score: 70,
      scoreable: true,
    });
    expect(state.suggested.key).toBe("ask_question");
  });

  it("asks one more question when research permission is withheld", () => {
    const state = build({
      stated: packet([{ lane: "pains", statement: "Our enquiries dried up" }], false),
    });
    expect(state.suggested.key).toBe("ask_question");
    expect(state.permissionLine.length).toBeGreaterThan(0);
  });

  it("works for a company that never came through the website", () => {
    const state = build({ signals: [] });
    expect(state.inbound).toBe(false);
    expect(state.suggested.key).toBe("hold");
    expect(state.moves.map((move) => move.key)).toEqual([
      "qualify",
      "ask_question",
      "hold",
      "pass",
      "explore_roadmap",
    ]);
  });

  it("closes qualify once the company is already qualified", () => {
    const state = build({ status: "qualified", signals: RICH, score: 80, scoreable: true });
    const qualify = state.moves.find((move) => move.key === "qualify")!;
    expect(qualify.available).toBe(false);
    expect(state.suggested.key).toBe("explore_roadmap");
  });

  it("never promises that anything is sent", () => {
    const state = build({ signals: RICH });
    const ask = state.moves.find((move) => move.key === "ask_question")!;
    expect(ask.consequence).toContain("Nothing is sent");
    const roadmap = state.moves.find((move) => move.key === "explore_roadmap")!;
    expect(roadmap.consequence).toContain("No Roadmap is created");
  });

  it("uses no em dash in any decision copy", () => {
    const state = build({ signals: RICH });
    const copy = [
      state.evidenceLine,
      state.suggested.label,
      state.suggested.because,
      ...state.moves.flatMap((move) => [move.label, move.consequence]),
    ].join(" ");
    expect(copy.includes("\u2014")).toBe(false);
  });

  it("reads the decision record newest first", () => {
    const c = candidate({ signals: RICH });
    const review = reviewStatedEvidence(c);
    const coverage = evidenceCoverage(c, review.observed);
    const events: ActivityEvent[] = [
      {
        id: "e1",
        organizationId: "org1",
        name: "prospect.decided",
        subject: { type: "prospect", id: "p1", label: "Northwind" },
        summary: "Held",
        occurredAt: "2026-08-19T10:00:00.000Z",
        provenance: {
          appId: "scout",
          actor: { type: "user", id: "u1" },
          observedAt: "2026-08-19T10:00:00.000Z",
        },
        payload: { scout_decision_move: "hold" },
      } as unknown as ActivityEvent,
      {
        id: "e2",
        organizationId: "org1",
        name: "prospect.question_drafted",
        subject: { type: "prospect", id: "p1", label: "Northwind" },
        summary: "Question drafted",
        occurredAt: "2026-08-20T10:00:00.000Z",
        provenance: {
          appId: "scout",
          actor: { type: "user", id: "u1" },
          observedAt: "2026-08-20T10:00:00.000Z",
        },
        payload: { scout_decision_move: "ask_question" },
      } as unknown as ActivityEvent,
    ];
    const state = buildDecisionState({
      candidate: c,
      review,
      read: scoutRead({ review, coverage, conflicts: [], permissionState: "not_required" }),
      conflicts: [],
      permission: researchPermission(c),
      coverage,
      events,
    });
    expect(state.record.map((entry) => entry.move)).toEqual(["ask_question", "hold"]);
  });

  it("drafts a question grounded in what is unverified", () => {
    const c = candidate({
      stated: packet([{ lane: "pains", statement: "Our enquiries dried up this year" }], true),
    });
    const review = reviewStatedEvidence(c);
    const draft = draftQuestionFor({ candidate: c, review, conflicts: [] });
    expect(draft).toContain("enquiries dried up");
  });
});
