/**
 * The laws of Memory + Learning, made executable.
 *
 * These tests exist because the failure modes here are quiet ones: a
 * correction silently overwriting history, a single enthusiastic meeting
 * hardening into a "pattern", or memory drifting from "how work moves" into a
 * verdict about a colleague. Each of those would be invisible in the UI and
 * corrosive in use, so each has a test.
 */

import { describe, expect, it } from "vitest";

import type { Commitment } from "@/domain/steward";
import type { InterpretedSignal } from "@/domain/steward-semantic";
import {
  MEMORY_FORBIDDEN_TERMS,
  RECURRING_PATTERN_THRESHOLD,
  isPersonSafeStatement,
  type MemoryBelief,
} from "@/domain/steward-memory";
import {
  accumulatePatterns,
  correctionToDraft,
  correctionsFromEdit,
  observationsFromCommitments,
  observationsFromSignals,
  resolveMemory,
  suppressedPatterns,
} from "./learning";
import { proposeStateChanges, statementOverlap } from "./continuity";
import { toMemoryBelief, visibleEvidence } from "./memory-encoding";
import { flagMemoryConflicts, selectRelevantMemory } from "./memory-context";

function signal(overrides: Partial<InterpretedSignal> = {}): InterpretedSignal {
  return {
    id: "candidate-1",
    candidateId: "candidate-1",
    disposition: "commitment",
    normalizedMeaning: "Henry sends the onboarding template to Bioptrics.",
    ownerName: "Henry",
    ownerConfidence: "high",
    beneficiary: null,
    dueText: "by Friday",
    dueAt: null,
    projectId: null,
    projectLabel: null,
    confidence: "high",
    truthTier: "observed",
    rationale: "Henry accepted the action in the following turn.",
    dependencyOn: null,
    blockedBy: null,
    duplicateOfId: null,
    ambiguity: "",
    quote: "Yeah I'll get that template over to them.",
    at: "00:12:04",
    evidence: [{ kind: "provider", label: "Fathom 00:12:04" }],
    ...overrides,
  };
}

function commitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: "commitment-1",
    organizationId: "org-1",
    conversationId: "conversation-1",
    ownerName: "Henry",
    what: "Send the onboarding template to Bioptrics",
    status: "open",
    sourceKey: "candidate-1",
    evidence: [],
    createdAt: "2026-01-01T09:00:00.000Z",
    updatedAt: "2026-01-01T09:00:00.000Z",
    ...overrides,
  };
}

function belief(overrides: Partial<MemoryBelief> = {}): MemoryBelief {
  return {
    id: "belief-1",
    organizationId: "org-1",
    subjectKey: "person:henry",
    subjectLabel: "Henry",
    statement: "Henry carries onboarding templates.",
    tier: "inferred",
    authority: "source",
    evidence: [],
    recordedBy: "Steward",
    recordedAt: "2026-01-02T09:00:00.000Z",
    meta: { kind: "responsibility", facet: "responsibility", personKey: "henry" },
    ...overrides,
  };
}

describe("corrections", () => {
  it("records only the fields a person actually changed", () => {
    const drafts = correctionsFromEdit({
      signal: signal(),
      edit: {
        normalizedMeaning: "Henry sends Bioptrics the clinical onboarding pack.",
        ownerName: "Henry",
        beneficiary: "Emmanuel",
      },
      conversationId: "conversation-1",
    });

    expect(drafts.map((draft) => draft.facet).sort()).toEqual(["beneficiary", "meaning"]);
    const meaning = drafts.find((draft) => draft.facet === "meaning");
    expect(meaning?.original).toBe("Henry sends the onboarding template to Bioptrics.");
    expect(meaning?.corrected).toBe("Henry sends Bioptrics the clinical onboarding pack.");
  });

  it("treats a cleared field as no instruction, never as a deletion", () => {
    const drafts = correctionsFromEdit({
      signal: signal(),
      edit: { ownerName: "", dueText: "   " },
    });
    expect(drafts).toEqual([]);
  });

  it("writes a correction as decided, human-authored, superseding the old belief", () => {
    const [correction] = correctionsFromEdit({
      signal: signal(),
      edit: { ownerName: "Emmanuel" },
    });
    const draft = correctionToDraft(correction!, "belief-1");

    expect(draft.tier).toBe("decided");
    expect(draft.authority).toBe("human");
    expect(draft.supersedesId).toBe("belief-1");
    expect(draft.meta.original).toBe("Henry");
    expect(draft.meta.corrected).toBe("Emmanuel");
  });
});

describe("repeated evidence", () => {
  it("does not form a belief from a single conversation", () => {
    const observations = observationsFromSignals({
      signals: [signal(), signal({ id: "candidate-2", candidateId: "candidate-2" })],
      conversationId: "conversation-1",
      conversationTitle: "Bioptrics plan update",
    });
    expect(accumulatePatterns({ observations, existing: [] })).toEqual([]);
  });

  it("forms an inferred belief once the threshold of distinct conversations is met", () => {
    const observations = Array.from({ length: RECURRING_PATTERN_THRESHOLD }, (_, index) =>
      observationsFromCommitments({
        commitments: [
          commitment({ id: `commitment-${index}`, conversationId: `conversation-${index}` }),
        ],
      }),
    ).flat();

    const drafts = accumulatePatterns({ observations, existing: [] });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.tier).toBe("inferred");
    expect(drafts[0]!.authority).toBe("source");
    expect(drafts[0]!.meta.sourceConversationIds).toHaveLength(RECURRING_PATTERN_THRESHOLD);
  });

  it("counts one conversation once, however often it repeats itself", () => {
    const observations = [0, 1, 2, 3].map(() =>
      observationsFromCommitments({
        commitments: [commitment({ conversationId: "conversation-1" })],
      }),
    ).flat();
    expect(accumulatePatterns({ observations, existing: [] })).toEqual([]);
  });

  it("never re-proposes a pattern it already holds", () => {
    const observations = ["a", "b", "c"].map((id) =>
      observationsFromCommitments({
        commitments: [commitment({ id: `commitment-${id}`, conversationId: `conversation-${id}` })],
      }),
    ).flat();
    const first = accumulatePatterns({ observations, existing: [] });
    const held = [
      belief({ meta: { ...belief().meta, patternKey: first[0]!.meta.patternKey ?? "" } }),
    ];

    expect(accumulatePatterns({ observations, existing: held })).toEqual([]);
  });
});

describe("resolution", () => {
  it("lets a person's decision outrank Steward's inference", () => {
    const resolved = resolveMemory([
      belief(),
      belief({
        id: "belief-2",
        tier: "decided",
        authority: "human",
        statement: "Henry carries clinical onboarding, not commercial onboarding.",
        meta: { kind: "correction", facet: "responsibility", personKey: "henry" },
      }),
    ]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.tier).toBe("decided");
  });

  it("drops superseded and retired beliefs from the read without deleting them", () => {
    const history = [
      belief(),
      belief({
        id: "belief-2",
        supersedesId: "belief-1",
        tier: "decided",
        authority: "human",
        meta: { kind: "correction", facet: "responsibility", retired: true },
      }),
    ];
    expect(resolveMemory(history)).toEqual([]);
    expect(history).toHaveLength(2);
  });
});

describe("continuity", () => {
  it("proposes that a later mention completes existing work, and changes nothing", () => {
    const existing = commitment();
    const proposals = proposeStateChanges({
      signals: [
        signal({
          id: "candidate-9",
          normalizedMeaning: "Henry has sent the onboarding template to Bioptrics.",
          disposition: "already_completed",
        }),
      ],
      commitments: [existing],
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.kind).toBe("already_completed");
    expect(proposals[0]!.proposedStatus).toBe("kept");
    expect(existing.status).toBe("open");
  });

  it("will not attach a mention to work carried by someone else", () => {
    const proposals = proposeStateChanges({
      signals: [
        signal({
          ownerName: "Emmanuel",
          normalizedMeaning: "Emmanuel has sent the onboarding template to Bioptrics.",
          disposition: "already_completed",
        }),
      ],
      commitments: [commitment()],
    });
    expect(proposals).toEqual([]);
  });

  it("keeps unrelated work apart", () => {
    expect(statementOverlap("Send the onboarding template", "Book the venue for the retreat")).toBe(
      0,
    );
  });
});

describe("memory offered to a reading", () => {
  it("is bounded and leads with what a person decided", () => {
    const decided = belief({
      id: "belief-3",
      tier: "decided",
      authority: "human",
      statement: "Henry carries clinical onboarding.",
      meta: { kind: "correction", facet: "responsibility", personKey: "henry" },
    });
    const relevant = selectRelevantMemory({
      beliefs: [belief(), decided],
      conversation: {
        sourceRef: { provider: "fixture", url: "https://example.com" },
        title: "Bioptrics",
        occurredAt: "2026-01-03T09:00:00.000Z",
        participants: [{ name: "Henry" }],
        segments: [{ index: 0, speaker: "Henry", at: "00:00:01", text: "Morning all." }],
        sourceActionItems: [],
      },
      people: [{ name: "Henry" }],
      projects: [],
    });

    expect(relevant.decided[0]).toContain("clinical onboarding");
    expect(relevant.inferred.length).toBeLessThanOrEqual(8);
  });

  it("surfaces a disagreement with a decided correction instead of resolving it", () => {
    const conflicts = flagMemoryConflicts({
      signals: [signal({ ownerName: "Emmanuel", normalizedMeaning: "Emmanuel owns bioptrics onboarding." })],
      beliefs: [
        belief({
          tier: "decided",
          authority: "human",
          meta: {
            kind: "correction",
            facet: "owner",
            corrected: "Henry",
            projectLabel: "Bioptrics",
          },
        }),
      ],
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.memorySays).toContain("Henry");
  });
});

describe("person-centred law", () => {
  it("refuses any statement that grades a person", () => {
    for (const term of MEMORY_FORBIDDEN_TERMS) {
      expect(isPersonSafeStatement(`Henry has a good ${term}.`)).toBe(false);
    }
    expect(isPersonSafeStatement("Henry usually prepares the weekly pack for Emmanuel.")).toBe(true);
  });

  it("never learns a pattern phrased as a judgement", () => {
    const observations = observationsFromSignals({
      signals: [signal({ normalizedMeaning: "Henry shows poor reliability on templates." })],
      conversationId: "conversation-1",
      conversationTitle: "Bioptrics",
    });
    expect(observations).toEqual([]);
  });
});

describe("storage", () => {
  it("hides the encoded payload from anything a person reads", () => {
    const decoded = toMemoryBelief({
      id: "belief-1",
      organizationId: "org-1",
      subjectKey: "person:henry",
      subjectLabel: "Henry",
      statement: "Henry carries onboarding.",
      tier: "inferred",
      authority: "source",
      evidence: [
        { kind: "provider", label: "Fathom 00:12:04" },
        { kind: "computed", label: 'steward-memory::{"kind":"responsibility","facet":"responsibility"}' },
      ],
      recordedBy: "Steward",
      recordedAt: "2026-01-02T09:00:00.000Z",
    });

    expect(decoded.meta.kind).toBe("responsibility");
    expect(decoded.evidence).toHaveLength(1);
    expect(visibleEvidence(decoded.evidence)).toHaveLength(1);
  });
});

describe("feedback", () => {
  it("stops raising a reading people keep calling context", () => {
    expect(
      suppressedPatterns([
        { patternKey: "carries|henry||templates", outcome: "dismissed_as_context" },
        { patternKey: "carries|henry||templates", outcome: "dismissed_as_context" },
        { patternKey: "carries|emmanuel||calls", outcome: "confirmed" },
      ]),
    ).toEqual(["carries|henry||templates"]);
  });
});
