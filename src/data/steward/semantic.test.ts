/**
 * Semantic interpretation laws.
 *
 * These tests hold the line between hearing words and understanding work:
 * candidates carry context, meaning that cannot be stated clearly is withheld,
 * a date is never manufactured, nothing is decided before a person decides,
 * and a promise saved as raw speech is flagged rather than worked.
 */

import { describe, expect, it } from "vitest";

import { detectCandidates } from "@/data/steward/candidates";
import {
  findDuplicate,
  isCleanMeaning,
  reviewableSignals,
  signalToProposal,
  toSignal,
  withheldSignals,
  type RawInterpretation,
} from "@/data/steward/interpretation";
import { rehearsalConversation } from "@/data/steward/fixture";
import { buildToday } from "@/data/steward/today";
import type { Commitment } from "@/domain/steward";
import type { CandidatePassage } from "@/domain/steward-semantic";

function candidate(overrides: Partial<CandidatePassage> = {}): CandidatePassage {
  return {
    id: "cand-1",
    speaker: "Dana",
    at: "00:02:38",
    text: "I'll email the IT lead about DNS access before Friday.",
    context: [{ speaker: "Dana", at: "00:02:38", text: "I'll email the IT lead." }],
    segments: [],
    cue: "promise",
    evidence: [{ label: "Rollout call, 00:02:38", kind: "human" }],
    ...overrides,
  };
}

function raw(overrides: Partial<RawInterpretation> = {}): RawInterpretation {
  return {
    candidate_id: "cand-1",
    disposition: "commitment",
    normalized_meaning: "Dana will email the client's IT lead to request DNS access.",
    owner: "Dana",
    owner_confidence: "high",
    due_text: "before Friday",
    confidence: "high",
    truth_tier: "observed",
    rationale: "Dana accepted the action in her own words.",
    ...overrides,
  } as RawInterpretation;
}

describe("Candidate passages carry their conversation", () => {
  it("gives each candidate surrounding turns, not an isolated line", () => {
    const candidates = detectCandidates(rehearsalConversation());
    expect(candidates.length).toBeGreaterThan(0);
    for (const entry of candidates) {
      expect(entry.context.length).toBeGreaterThan(0);
      expect(entry.context.some((turn) => turn.text === entry.text)).toBe(true);
    }
  });

  it("is stable across repeated reads of the same conversation", () => {
    const first = detectCandidates(rehearsalConversation()).map((entry) => entry.id);
    const second = detectCandidates(rehearsalConversation()).map((entry) => entry.id);
    expect(second).toEqual(first);
  });
});

describe("Meaning quality", () => {
  it("accepts a clear operational sentence", () => {
    expect(isCleanMeaning("Dana will send the revised outline to the client.")).toBe(true);
  });

  it("rejects raw speech, filler, fragments and ASR wreckage", () => {
    for (const text of [
      "And so I mean we'll kind of send it over you know",
      "So that's the thing about it...",
      "And I'll see That That was the plan",
      "Yeah",
      "Because it depends",
    ]) {
      expect(isCleanMeaning(text)).toBe(false);
    }
  });
});

describe("Interpretation laws", () => {
  it("never marks pre-confirmation truth as decided", () => {
    const signal = toSignal(raw({ truth_tier: "observed" }), candidate(), []);
    expect(signal.truthTier).toBe("observed");
    expect(["observed", "inferred"]).toContain(signal.truthTier);
  });

  it("keeps spoken timing as words and never manufactures a date", () => {
    const signal = toSignal(raw(), candidate(), []);
    expect(signal.dueText).toBe("before Friday");
    expect(signal.dueAt).toBeNull();
  });

  it("demotes a commitment it cannot state clearly, and says why", () => {
    const signal = toSignal(
      raw({ normalized_meaning: "And so you know we'll kind of look at it" }),
      candidate(),
      [],
    );
    expect(signal.disposition).toBe("insufficient_evidence");
    expect(signal.ambiguity.length).toBeGreaterThan(0);
  });

  it("marks a repeat of an existing open commitment as already tracked", () => {
    const existing: Commitment = {
      id: "commit-1",
      organizationId: "org-1",
      conversationId: "conv-0",
      ownerName: "Dana",
      what: "Dana will email the client's IT lead to request DNS access.",
      status: "open",
      sourceKey: "conv-0:dns",
      evidence: [],
      createdAt: "2026-03-01T12:00:00.000Z",
      updatedAt: "2026-03-01T12:00:00.000Z",
    };
    const signal = toSignal(raw(), candidate(), [existing]);
    expect(signal.disposition).toBe("duplicate");
    expect(signal.duplicateOfId).toBe("commit-1");
    expect(findDuplicate("Something entirely unrelated about invoices", [existing])).toBeNull();
  });

  it("keeps context, doubt and repetition out of what a person reviews", () => {
    const signals = [
      toSignal(raw(), candidate(), []),
      toSignal(
        raw({ candidate_id: "c2", disposition: "context_only" }),
        candidate({ id: "c2" }),
        [],
      ),
      toSignal(
        raw({ candidate_id: "c3", disposition: "already_completed" }),
        candidate({ id: "c3" }),
        [],
      ),
    ];
    expect(reviewableSignals(signals)).toHaveLength(1);
    expect(withheldSignals(signals)).toHaveLength(2);
  });

  it("confirms the normalized meaning, keeping the transcript as evidence only", () => {
    const signal = toSignal(raw(), candidate(), []);
    const proposal = signalToProposal(signal);
    expect(proposal.statement).toBe(signal.normalizedMeaning);
    expect(proposal.quote).toBe(candidate().text);
    /* Same stable key, so confirming twice cannot create it twice. */
    expect(proposal.id).toBe("cand-1");
  });
});

describe("Today refuses to present raw speech as work", () => {
  const base: Commitment = {
    id: "commit-1",
    organizationId: "org-1",
    conversationId: "conv-1",
    ownerName: "Dana",
    what: "Dana will send the revised outline to the client.",
    status: "open",
    sourceKey: "conv-1:a",
    evidence: [],
    createdAt: "2026-03-09T12:00:00.000Z",
    updatedAt: "2026-03-09T12:00:00.000Z",
  };
  const now = "2026-03-10T12:00:00.000Z";

  it("leaves a clear promise alone", () => {
    const [move] = buildToday({ commitments: [base], now });
    expect(move?.needsCorrection).toBeUndefined();
  });

  it("flags a promise saved as raw speech and asks for it to be restated", () => {
    const [move] = buildToday({
      commitments: [{ ...base, what: "And so you know that's the thing we kind of talked about" }],
      now,
    });
    expect(move?.needsCorrection).toBe(true);
    expect(move?.why).toContain("Restate it");
  });
});
