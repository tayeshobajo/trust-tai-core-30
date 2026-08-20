/**
 * Acceptance for the Intelligence Canon.
 *
 * These are the laws, not the implementation: a match is a reading, evidence
 * lanes survive it, absent evidence is asked for rather than assumed, one
 * outcome is never a rule, and nothing here can authorise work.
 */

import { describe, expect, it } from "vitest";

import { DIAGNOSTIC_CHAINS, chainById } from "./chains";
import { activePatterns } from "./patterns";
import { LABEL_THRESHOLD, MATCH_FLOOR, conciseLabel, matchPatterns } from "./match";
import { openCase, patternStanding, proposePatternRevision, recordPatternOutcome } from "./cases";
import { labelSignalsWithPatterns } from "@/data/pulse/patterns";
import type { Observation } from "@/domain/intelligence-engine";
import type { PatternOutcome } from "@/domain/intelligence-canon";
import type { PulseSignal } from "@/domain/pulse";

const NOW = "2026-05-04T09:00:00.000Z";

function observation(partial: Partial<Observation> & { kind: string }): Observation {
  return {
    id: `obs:${partial.kind}:${partial.subject?.id ?? "x"}`,
    kind: partial.kind as Observation["kind"],
    statement: partial.statement ?? `Something about ${partial.kind}.`,
    sourceApps: partial.sourceApps ?? ["projects"],
    tier: partial.tier ?? "observed",
    at: partial.at ?? NOW,
    ...(partial.magnitude !== undefined ? { magnitude: partial.magnitude } : {}),
    ...(partial.subject ? { subject: partial.subject } : {}),
  } as Observation;
}

/** Every required trigger of a pattern, as observations it would match. */
function observationsFor(patternId: string): Observation[] {
  const pattern = activePatterns().find((row) => row.id === patternId);
  if (!pattern) throw new Error(`No pattern ${patternId}`);
  return pattern.triggers
    .filter((trigger) => !trigger.optional)
    .map((trigger) =>
      observation({
        kind: trigger.observationKind,
        magnitude: (trigger.minMagnitude ?? 1) + 2,
        sourceApps: [pattern.possibleNextMoves[0]?.appId ?? "projects"],
      }),
    );
}

describe("the canon is well formed", () => {
  it("gives every pattern a required trigger, a competing explanation and an owning room", () => {
    for (const pattern of activePatterns()) {
      expect(pattern.triggers.some((trigger) => !trigger.optional)).toBe(true);
      expect(pattern.competingExplanations.length).toBeGreaterThan(0);
      expect(pattern.possibleNextMoves.length).toBeGreaterThan(0);
      expect(pattern.verifyOutcomeBy.length).toBeGreaterThan(0);
    }
  });

  it("caps every pattern at moderate confidence or below for v1", () => {
    for (const pattern of activePatterns()) {
      expect(["unknown", "low", "moderate"]).toContain(pattern.confidenceCap);
    }
  });

  it("points every referenced chain at a chain that exists", () => {
    for (const pattern of activePatterns()) {
      if (pattern.chainId) expect(chainById(pattern.chainId)).toBeDefined();
    }
  });

  it("asks each chain step a question and names where to look", () => {
    for (const chain of DIAGNOSTIC_CHAINS) {
      expect(chain.checks.length).toBeGreaterThan(0);
      for (const step of chain.checks) {
        expect(step.question.length).toBeGreaterThan(0);
        expect(step.appId.length).toBeGreaterThan(0);
        expect(step.branches.length).toBeGreaterThan(0);
      }
    }
  });

  it("uses no em dash in canon copy a person reads", () => {
    const copy = [
      ...activePatterns().flatMap((pattern) => [
        pattern.name,
        pattern.description,
        pattern.verifyOutcomeBy,
        ...pattern.possibleNextMoves.map((move) => move.move),
        ...pattern.competingExplanations.flatMap((row) => [row.explanation, row.distinguishedBy]),
        ...pattern.evidenceToInspect.flatMap((row) => [
          row.inspect,
          row.wouldConfirm,
          row.wouldRefute,
        ]),
      ]),
      ...DIAGNOSTIC_CHAINS.flatMap((chain) => [
        chain.question,
        chain.trigger,
        ...chain.checks.map((step) => step.question),
      ]),
    ];
    expect(copy.filter((line) => line.includes("\u2014"))).toEqual([]);
  });
});

describe("matching is honest", () => {
  it("returns nothing when the suite observed nothing", () => {
    expect(matchPatterns({ observations: [] })).toEqual([]);
  });

  it("does not match a pattern whose required trigger never fired", () => {
    const pattern = activePatterns()[0]!;
    const matches = matchPatterns({
      observations: [observation({ kind: "nothing_of_the_sort" })],
    });
    expect(matches.some((match) => match.patternId === pattern.id)).toBe(false);
  });

  it("keeps every match at or above the floor and ordered by score", () => {
    const pattern = activePatterns()[0]!;
    const matches = matchPatterns({ observations: observationsFor(pattern.id) });
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) expect(match.score).toBeGreaterThanOrEqual(MATCH_FLOOR);
    const scores = matches.map((match) => match.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("never exceeds the pattern's own confidence cap", () => {
    const rank = { unknown: 0, low: 1, moderate: 2, high: 3 } as const;
    for (const pattern of activePatterns()) {
      for (const match of matchPatterns({ observations: observationsFor(pattern.id) })) {
        const source = activePatterns().find((row) => row.id === match.patternId)!;
        expect(rank[match.confidence]).toBeLessThanOrEqual(rank[source.confidenceCap]);
      }
    }
  });

  it("never promotes testimony into something the suite observed", () => {
    const pattern = activePatterns()[0]!;
    const stated = observationsFor(pattern.id).map((row) => ({ ...row, tier: "stated" as const }));
    for (const match of matchPatterns({ observations: stated })) {
      for (const fact of match.matched) expect(fact.tier).toBe("stated");
    }
  });

  it("asks for the evidence it did not find instead of assuming it", () => {
    const pattern = activePatterns().find(
      (row) => row.triggers.filter((t) => !t.optional).length > 1,
    );
    if (!pattern) return;
    const partial = observationsFor(pattern.id).slice(0, 1);
    const match = matchPatterns({ observations: partial }).find(
      (row) => row.patternId === pattern.id,
    );
    if (!match) return;
    expect(match.missingEvidence.length + match.unmetConditions.length).toBeGreaterThan(0);
  });

  it("always carries the other thing it could be", () => {
    const pattern = activePatterns()[0]!;
    for (const match of matchPatterns({ observations: observationsFor(pattern.id) })) {
      expect(match.competingExplanations.length).toBeGreaterThan(0);
    }
  });

  it("raises nothing a person suppressed", () => {
    const pattern = activePatterns()[0]!;
    const matches = matchPatterns({
      observations: observationsFor(pattern.id),
      suppressed: [pattern.id],
    });
    expect(matches.some((match) => match.patternId === pattern.id)).toBe(false);
  });

  it("withholds a short label below the label threshold", () => {
    const pattern = activePatterns()[0]!;
    for (const match of matchPatterns({ observations: observationsFor(pattern.id) })) {
      if (match.score < LABEL_THRESHOLD) expect(conciseLabel(match)).toBeNull();
    }
  });

  it("is deterministic for the same evidence", () => {
    const pattern = activePatterns()[0]!;
    const observations = observationsFor(pattern.id);
    expect(matchPatterns({ observations })).toEqual(matchPatterns({ observations }));
  });
});

describe("Pulse enrichment stays enrichment", () => {
  const signal: PulseSignal = {
    id: "signal:1",
    organizationId: "org",
    category: "delivery_risk",
    area: "delivery",
    impact: "medium",
    ageDays: 11,
    actionRoute: "/modules/projects",
    title: "A project has gone quiet",
    summary: "Nothing moved for eleven days.",
    reason: "Last activity was eleven days ago.",
    severity: "evaluate",
    sourceApp: "projects",
    sourceAppLabel: "Projects",
    entityPath: "Acme rebuild",
    actionLabel: "Open Projects",
    evidence: [],
    confidence: "moderate",
    at: NOW,
  };

  it("adds no signal and removes none", () => {
    const pattern = activePatterns()[0]!;
    const matches = matchPatterns({ observations: observationsFor(pattern.id) });
    const out = labelSignalsWithPatterns([signal], matches);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(signal.id);
  });

  it("leaves signals untouched when nothing matched", () => {
    expect(labelSignalsWithPatterns([signal], [])).toEqual([signal]);
  });

  it("labels at most one signal per room", () => {
    const pattern = activePatterns()[0]!;
    const matches = matchPatterns({ observations: observationsFor(pattern.id) });
    const out = labelSignalsWithPatterns([signal, { ...signal, id: "signal:2" }], matches);
    expect(out.filter((row) => row.patternLabel).length).toBeLessThanOrEqual(1);
  });
});

describe("learning is governed", () => {
  const patternId = activePatterns()[0]!.id;
  const match = matchPatterns({ observations: observationsFor(patternId) }).find(
    (row) => row.patternId === patternId,
  )!;
  const base = {
    organizationId: "org",
    match,
    recommendation: "Name one owner for the rebuild.",
    decidedAt: NOW,
    recordedBy: "user-1",
    now: NOW,
  };

  function outcome(result: PatternOutcome["result"], index: number): PatternOutcome {
    return recordPatternOutcome({
      ...base,
      decision: "accepted",
      result,
      resultBecause: `Checked after the fact, run ${index}.`,
    });
  }

  it("records a case by reference, never by copying a room's truth", () => {
    const entry = openCase({
      organizationId: "org",
      match,
      entities: [{ type: "project", id: "p1", label: "Acme rebuild" }],
      hypothesis: match.because,
      humanDecision: "Named an owner.",
      decidedBy: "user-1",
      now: NOW,
    });
    expect(entry.patternId).toBe(patternId);
    expect(entry.diagnosisVerdict).toBe("unknown");
    expect(JSON.stringify(entry)).not.toContain("transcript");
  });

  it("treats one result as no rule at all", () => {
    const standing = patternStanding(patternId, [outcome("success", 1)]);
    expect(standing.hasLesson).toBe(false);
    expect(proposePatternRevision(patternId, [outcome("failure", 1)])).toBeNull();
  });

  it("proposes a revision only after three consistent results, and never applies it", () => {
    const failures = [outcome("failure", 1), outcome("failure", 2), outcome("failure", 3)];
    const proposal = proposePatternRevision(patternId, failures);
    expect(proposal).not.toBeNull();
    expect(proposal!.requiresApproval).toBe(true);
    const pattern = activePatterns().find((row) => row.id === patternId)!;
    expect(pattern.status).toBe("active");
  });

  it("lets a person's correction outrank the result", () => {
    const corrected = recordPatternOutcome({
      ...base,
      decision: "edited",
      result: "failure",
      resultBecause: "The expected signal never arrived.",
      humanCorrection: "It was a scope change, not an ownership gap.",
    });
    expect(corrected.humanCorrection).toBeTruthy();
    expect(patternStanding(patternId, [corrected]).corrections).toHaveLength(1);
  });
});
