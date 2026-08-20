/**
 * The decision to case to outcome loop, as laws rather than implementation.
 *
 * Viewing learns nothing, a decision learns once, a retry learns nothing new,
 * a person's correction outranks inference, time alone never means success,
 * one result is never a rule, and nothing here touches a pattern definition.
 */

import { describe, expect, it } from "vitest";

import { activePatterns, patternById } from "./patterns";
import { openCase, recordPatternOutcome } from "./cases";
import { experienceForMatches, openCases, priorExperience, resolvedCases } from "./experience";
import { canReconcile, reconcileCase, outcomeFromReconciliation, FAILURE_AFTER_HOURS } from "./outcome-checks";
import { matchPatterns } from "./match";
import {
  caseFingerprint,
  outcomeFingerprint,
} from "@/data/supabase/intelligence-canon-service";
import type { Observation } from "@/domain/intelligence-engine";
import type { IntelligenceCase, PatternMatch, PatternOutcome } from "@/domain/intelligence-canon";

const ORG = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const NOW = "2026-05-04T09:00:00.000Z";

function observation(kind: string, magnitude = 5): Observation {
  return {
    id: `obs:${kind}`,
    kind,
    statement: `Something about ${kind}.`,
    sourceApps: ["projects"],
    tier: "observed",
    at: NOW,
    magnitude,
  } as Observation;
}

/** A pattern whose required triggers are all deterministically checkable. */
function reconcilablePattern() {
  return activePatterns().find((pattern) => canReconcile(pattern.id))!;
}

function matchFor(patternId: string): PatternMatch {
  const pattern = patternById(patternId)!;
  const observations = pattern.triggers
    .filter((trigger) => !trigger.optional)
    .map((trigger) => observation(trigger.observationKind, (trigger.minMagnitude ?? 1) + 3));
  const match = matchPatterns({ observations, domains: [pattern.domain] }).find(
    (row) => row.patternId === patternId,
  );
  return match!;
}

function caseFrom(match: PatternMatch, decision: string, correction?: string): IntelligenceCase {
  const entry = openCase({
    organizationId: ORG,
    match,
    entities: [],
    hypothesis: "This resembles the shape above.",
    humanDecision: decision,
    decidedBy: USER,
    now: NOW,
  });
  return correction ? { ...entry, correction } : entry;
}

describe("a case only exists when a person decided something", () => {
  it("carries references and the decision, never room state", () => {
    const match = matchFor(reconcilablePattern().id);
    const entry = caseFrom(match, "Named an owner and asked for a date.");
    expect(entry.evidenceRefs.every((ref) => ref.kind === "observation")).toBe(true);
    expect(entry.humanDecision).toContain("Named an owner");
    expect(Object.keys(entry)).not.toContain("project");
  });

  it("treats a retry of the same decision as the same case", () => {
    const match = matchFor(reconcilablePattern().id);
    const first = caseFrom(match, "Named an owner and asked for a date.");
    const retry = { ...caseFrom(match, "Named an owner and asked for a date."), id: "other" };
    expect(caseFingerprint(retry)).toBe(caseFingerprint(first));
  });

  it("treats a different decision on the same reading as a different case", () => {
    const match = matchFor(reconcilablePattern().id);
    expect(caseFingerprint(caseFrom(match, "Held it for a week."))).not.toBe(
      caseFingerprint(caseFrom(match, "Named an owner.")),
    );
  });
});

describe("outcome reconciliation is deterministic and never generous", () => {
  it("says nothing while the shape is still there and little time has passed", () => {
    const pattern = reconcilablePattern();
    const entry = caseFrom(matchFor(pattern.id), "Acted on it.");
    const observations = pattern.triggers
      .filter((trigger) => !trigger.optional)
      .map((trigger) => observation(trigger.observationKind, 9));
    const later = new Date(Date.parse(NOW) + 24 * 3_600_000).toISOString();
    expect(reconcileCase({ entry, observations, now: later })).toBeNull();
  });

  it("calls it a success only when the shape has cleared", () => {
    const entry = caseFrom(matchFor(reconcilablePattern().id), "Acted on it.");
    const later = new Date(Date.parse(NOW) + 48 * 3_600_000).toISOString();
    const result = reconcileCase({ entry, observations: [], now: later });
    expect(result?.result).toBe("success");
    expect(result?.hoursToOutcome).toBe(48);
  });

  it("calls it a failure only while the same shape is still observed", () => {
    const pattern = reconcilablePattern();
    const entry = caseFrom(matchFor(pattern.id), "Acted on it.");
    const observations = pattern.triggers
      .filter((trigger) => !trigger.optional)
      .map((trigger) => observation(trigger.observationKind, 9));
    const later = new Date(
      Date.parse(NOW) + (FAILURE_AFTER_HOURS + 1) * 3_600_000,
    ).toISOString();
    expect(reconcileCase({ entry, observations, now: later })?.result).toBe("failure");
  });

  it("carries a person's correction onto the outcome it writes", () => {
    const entry = caseFrom(
      matchFor(reconcilablePattern().id),
      "Acted on it.",
      "This was not a capacity problem. We were waiting on the client.",
    );
    const later = new Date(Date.parse(NOW) + 48 * 3_600_000).toISOString();
    const reconciliation = reconcileCase({ entry, observations: [], now: later })!;
    const outcome = outcomeFromReconciliation({
      entry,
      reconciliation,
      recordedBy: USER,
      now: later,
    });
    expect(outcome.humanCorrection).toContain("waiting on the client");
  });

  it("treats the same result on the same case as already recorded", () => {
    const entry = caseFrom(matchFor(reconcilablePattern().id), "Acted on it.");
    const later = new Date(Date.parse(NOW) + 48 * 3_600_000).toISOString();
    const reconciliation = reconcileCase({ entry, observations: [], now: later })!;
    const build = (): PatternOutcome => ({
      id: "x",
      ...outcomeFromReconciliation({ entry, reconciliation, recordedBy: USER, now: later }),
    });
    expect(outcomeFingerprint(build())).toBe(outcomeFingerprint({ ...build(), id: "y" }));
  });
});

describe("prior experience is memory, not evidence", () => {
  const match = matchFor(reconcilablePattern().id);

  function outcome(result: "success" | "failure", index: number): PatternOutcome {
    return recordPatternOutcome({
      organizationId: ORG,
      match,
      recommendation: "Do the bounded thing.",
      decision: "accepted",
      result,
      resultBecause: `Reading ${index}.`,
      decidedAt: NOW,
      recordedBy: USER,
      now: new Date(Date.parse(NOW) + index * 3_600_000).toISOString(),
    });
  }

  it("offers no guidance from one result", () => {
    const experience = priorExperience({
      patternId: match.patternId,
      cases: [],
      outcomes: [outcome("failure", 1)],
    });
    expect(experience.note).toBeNull();
    expect(experience.proposal).toBeNull();
  });

  it("offers guidance and a proposal after three consistent results", () => {
    const experience = priorExperience({
      patternId: match.patternId,
      cases: [],
      outcomes: [outcome("failure", 1), outcome("failure", 2), outcome("failure", 3)],
    });
    expect(experience.note).toContain("has not held up");
    expect(experience.proposal?.requiresApproval).toBe(true);
  });

  it("puts a person's correction ahead of anything inferred", () => {
    const corrected = {
      ...outcome("success", 4),
      humanCorrection: "This was not founder held context. The acceptance criteria were unclear.",
    };
    const experience = priorExperience({
      patternId: match.patternId,
      cases: [],
      outcomes: [outcome("success", 1), outcome("success", 2), outcome("success", 3), corrected],
    });
    expect(experience.note).toContain("acceptance criteria were unclear");
  });

  it("stays silent for a pattern with no record at all", () => {
    expect(
      Object.keys(experienceForMatches({ matches: [match], cases: [], outcomes: [] })),
    ).toHaveLength(0);
  });

  it("never changes the base pattern", () => {
    const before = JSON.stringify(patternById(match.patternId));
    priorExperience({
      patternId: match.patternId,
      cases: [],
      outcomes: [outcome("failure", 1), outcome("failure", 2), outcome("failure", 3)],
    });
    expect(JSON.stringify(patternById(match.patternId))).toBe(before);
  });
});

describe("open and resolved cases are read from the ledger, not stored twice", () => {
  it("treats a case with an outcome as resolved and the rest as open", () => {
    const match = matchFor(reconcilablePattern().id);
    const one = caseFrom(match, "Acted on it.");
    const two = { ...caseFrom(match, "Held it."), id: "case:two" };
    const outcomes: PatternOutcome[] = [
      {
        id: "outcome:one",
        organizationId: ORG,
        patternId: match.patternId,
        patternVersion: 1,
        caseId: one.id,
        recommendation: "x",
        decision: "accepted",
        result: "success",
        resultBecause: "The shape cleared.",
        recordedBy: USER,
        recordedAt: NOW,
      },
    ];
    expect(openCases([one, two], outcomes).map((row) => row.id)).toEqual([two.id]);
    expect(resolvedCases([one, two], outcomes).map((row) => row.entry.id)).toEqual([one.id]);
  });
});
