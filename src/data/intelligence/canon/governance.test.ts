/**
 * Governance guarantees: a proposal is answered once, room events close cases
 * only on exact references, experience is ordered by human word first, and the
 * weekly health read counts nothing but the ledger.
 */

import { describe, expect, it } from "vitest";

import type { ActivityEvent } from "@/domain/activity";
import type {
  IntelligenceCase,
  PatternOutcome,
  PatternRevisionDecision,
  PatternRevisionProposal,
} from "@/domain/intelligence-canon";

import { experienceHealth } from "./health";
import {
  awaitingDecision,
  decisionFor,
  proposalDecisionRow,
  proposalFingerprint,
} from "./proposals";
import { roomEventOutcomes } from "./room-events";
import { checkableKinds } from "./outcome-checks";

const ORG = "org-1";

function aCase(over: Partial<IntelligenceCase> = {}): IntelligenceCase {
  return {
    id: "case-1",
    organizationId: ORG,
    patternId: "delivery.ownership_ambiguity",
    patternVersion: 1,
    entities: [{ type: "project", id: "p-1" }],
    evidenceRefs: [{ kind: "observation", id: "obs-1" }],
    hypothesis: "Work is slipping without anyone saying so.",
    humanDecision: "Named an owner.",
    decidedBy: "user-1",
    decidedAt: "2026-01-01T00:00:00.000Z",
    diagnosisVerdict: "unknown",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function anEvent(over: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "act-1",
    organizationId: ORG,
    name: "project.completed",
    subject: { type: "project", id: "p-1" },
    summary: "Project completed",
    payload: {},
    provenance: {
      appId: "projects",
      actor: { type: "user", id: "user-1" },
      observedAt: "2026-01-03T00:00:00.000Z",
      confidence: "observed",
    },
    occurredAt: "2026-01-03T00:00:00.000Z",
    ...over,
  } as ActivityEvent;
}

const PROPOSAL: PatternRevisionProposal = {
  patternId: "delivery.ownership_ambiguity",
  fromVersion: 1,
  suggestion: "Say plainly that a missed date without a note is the signal.",
  outcomeRefs: ["out-1", "out-2", "out-3"],
  requiresApproval: true,
};

describe("proposal governance", () => {
  it("gives the same proposal a stable fingerprint and new wording a new one", () => {
    expect(proposalFingerprint(PROPOSAL)).toBe(proposalFingerprint({ ...PROPOSAL }));
    expect(proposalFingerprint({ ...PROPOSAL, suggestion: "Something else." })).not.toBe(
      proposalFingerprint(PROPOSAL),
    );
  });

  it("treats a recorded answer as final for that wording", () => {
    const row = proposalDecisionRow({
      organizationId: ORG,
      proposal: PROPOSAL,
      decision: "accepted",
      decidedBy: "user-1",
      now: "2026-01-05T00:00:00.000Z",
    });
    const decisions: PatternRevisionDecision[] = [{ ...row, id: "d-1" }];

    expect(awaitingDecision(PROPOSAL, decisions)).toBe(false);
    expect(decisionFor(PROPOSAL, decisions)?.decision).toBe("accepted");
    expect(awaitingDecision({ ...PROPOSAL, suggestion: "Reworded." }, decisions)).toBe(true);
  });

  it("records no change to the pattern itself", () => {
    const row = proposalDecisionRow({
      organizationId: ORG,
      proposal: PROPOSAL,
      decision: "accepted",
      decidedBy: "user-1",
      now: "2026-01-05T00:00:00.000Z",
    });
    expect(row.proposalText).toBe(PROPOSAL.suggestion);
    expect(row.patternVersion).toBe(1);
  });
});

describe("room events closing cases", () => {
  it("closes a case when the exact entity is completed after the decision", () => {
    expect(checkableKinds("delivery.ownership_ambiguity").length).toBeGreaterThan(0);
    const settled = roomEventOutcomes({ cases: [aCase()], events: [anEvent()] });
    expect(settled).toHaveLength(1);
    expect(settled[0]?.caseId).toBe("case-1");
  });

  it("does nothing when the event is about another entity", () => {
    const settled = roomEventOutcomes({
      cases: [aCase()],
      events: [anEvent({ subject: { type: "project", id: "other" } })],
    });
    expect(settled).toEqual([]);
  });

  it("ignores an event that happened before the decision", () => {
    const settled = roomEventOutcomes({
      cases: [aCase()],
      events: [anEvent({ occurredAt: "2025-12-01T00:00:00.000Z" })],
    });
    expect(settled).toEqual([]);
  });

  it("ignores room events outside the bounded set", () => {
    const settled = roomEventOutcomes({
      cases: [aCase()],
      events: [anEvent({ name: "project.commented" as ActivityEvent["name"] })],
    });
    expect(settled).toEqual([]);
  });
});

describe("weekly experience health", () => {
  it("counts only what the ledger holds", () => {
    const now = "2026-01-08T00:00:00.000Z";
    const cases = [aCase({ decidedAt: "2026-01-06T00:00:00.000Z" })];
    const outcomes: PatternOutcome[] = [
      {
        id: "out-1",
        organizationId: ORG,
        patternId: "delivery.ownership_ambiguity",
        patternVersion: 1,
        caseId: "case-1",
        recommendation: "x",
        decision: "accepted",
        result: "success",
        resultBecause: "The project was completed.",
        humanCorrection: "It was scope, not ownership.",
        recordedBy: "user-1",
        recordedAt: "2026-01-07T00:00:00.000Z",
      },
    ];

    const health = experienceHealth({ cases, outcomes, decisions: [], now });
    expect(health.casesOpened).toBe(1);
    expect(health.casesResolved).toBe(1);
    expect(health.corrections).toBe(1);
    expect(health.oldestOpenCaseDays).toBeNull();
  });

  it("reports zero honestly on an empty ledger", () => {
    const health = experienceHealth({
      cases: [],
      outcomes: [],
      decisions: [],
      now: "2026-01-08T00:00:00.000Z",
    });
    expect(health.casesOpened).toBe(0);
    expect(health.proposalsAwaitingDecision).toBe(0);
    expect(health.oldestOpenCaseDays).toBeNull();
  });
});

describe("prior experience ordering", () => {
  it("puts a pattern a person corrected ahead of a single anecdote", async () => {
    const { experienceLedger } = await import("./experience");
    const corrected = aCase({ id: "case-2", patternId: "delivery.ownership_ambiguity" });
    const anecdote = aCase({ id: "case-3", patternId: "pipeline.healthy_volume_no_conversion" });
    const outcomes: PatternOutcome[] = [
      {
        id: "out-a",
        organizationId: ORG,
        patternId: "delivery.ownership_ambiguity",
        patternVersion: 1,
        caseId: "case-2",
        recommendation: "x",
        decision: "accepted",
        result: "failure",
        resultBecause: "Still late.",
        humanCorrection: "It was scope, not ownership.",
        recordedBy: "user-1",
        recordedAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "out-b",
        organizationId: ORG,
        patternId: "pipeline.healthy_volume_no_conversion",
        patternVersion: 1,
        caseId: "case-3",
        recommendation: "y",
        decision: "accepted",
        result: "success",
        resultBecause: "Converted.",
        recordedBy: "user-1",
        recordedAt: "2026-01-09T00:00:00.000Z",
      },
    ];

    const ledger = experienceLedger({ cases: [corrected, anecdote], outcomes });
    expect(ledger[0]?.patternId).toBe("delivery.ownership_ambiguity");
    expect(ledger[0]?.corrections.length).toBeGreaterThan(0);
  });
});
