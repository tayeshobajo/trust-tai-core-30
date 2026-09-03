/**
 * Read-only acceptance for Steward's semantic reading and its memory layer.
 *
 * Reads one real meeting (Fathom 779145597), interprets it, and then exercises
 * the memory layer against that reading: continuity with work already carried,
 * conflict with a decided correction, and what repeated evidence would teach.
 *
 * Writes nothing. No conversation, commitment or belief is persisted.
 */

import { fetchFathomConversation } from "@/lib/steward-fathom.server";
import { parseConversationLink } from "@/lib/conversation-source";
import { detectCandidates } from "@/data/steward/candidates";
import { interpretConversation } from "@/lib/steward-interpret.server";
import { dispositionCounts } from "@/domain/steward-semantic";
import { reviewableSignals } from "@/data/steward/interpretation";
import { proposeStateChanges } from "@/data/steward/continuity";
import { accumulatePatterns, observationsFromSignals } from "@/data/steward/learning";
import { RECURRING_PATTERN_THRESHOLD } from "@/domain/steward-memory";
import type { Commitment } from "@/domain/steward";

const ref = parseConversationLink("https://fathom.video/calls/779145597")!;
const conversation = await fetchFathomConversation(ref);
const candidates = detectCandidates(conversation);
console.log(
  "meeting:",
  conversation.title,
  "| segments:",
  conversation.segments.length,
  "| candidates:",
  candidates.length,
);

const run = await interpretConversation({
  conversation,
  memory: {
    available: false,
    because: "No workspace session in this environment.",
    openCommitments: [],
    people: [],
    projects: [],
  },
  commitments: [],
  candidates,
});
console.log("model:", run.provider, run.model);
console.log(dispositionCounts(run.signals));

const reviewable = reviewableSignals(run.signals);
for (const s of reviewable) {
  console.log(
    `\n[${s.disposition}|${s.confidence}|${s.truthTier}] ${s.at} owner=${s.ownerName ?? ", "} due="${s.dueText ?? ", "}"`,
  );
  console.log("  meaning:", s.normalizedMeaning);
  console.log("  why:", s.rationale);
  if (s.ambiguity) console.log("  unclear:", s.ambiguity);
  console.log("  said:", s.quote.slice(0, 140));
}

/* ------------------------------------------------- memory layer, read only */

/** A stand-in for work the workspace already carries. Never persisted. */
const prior: Commitment[] = reviewable.slice(0, 3).map((signal, index) => ({
  id: `rehearsal-${index}`,
  organizationId: "rehearsal",
  conversationId: `rehearsal-conversation-${index}`,
  ownerName: signal.ownerName ?? "Unnamed",
  what: signal.normalizedMeaning,
  status: "open",
  sourceKey: signal.id,
  evidence: [],
  createdAt: conversation.occurredAt,
  updatedAt: conversation.occurredAt,
}));

const stateChanges = proposeStateChanges({ signals: run.signals, commitments: prior });
console.log("\ncontinuity proposals:", stateChanges.length);
for (const proposal of stateChanges) {
  console.log(`  ${proposal.kind} → ${proposal.proposedStatus ?? "no state change"}`);
  console.log("   ", proposal.because);
}

const observations = observationsFromSignals({
  signals: run.signals,
  conversationId: "rehearsal-conversation-a",
  conversationTitle: conversation.title,
});
console.log("\nobservations from this one meeting:", observations.length);
console.log(
  "patterns learned from one meeting (must be 0):",
  accumulatePatterns({ observations, existing: [] }).length,
);

/* The same shape of work, seen in the required number of distinct conversations. */
const repeated = Array.from({ length: RECURRING_PATTERN_THRESHOLD }, (_, index) =>
  observations.map((observation) => ({
...observation,
    conversationId: `rehearsal-conversation-${index}`,
  })),
).flat();
console.log(
  `patterns learned after ${RECURRING_PATTERN_THRESHOLD} distinct conversations:`,
  accumulatePatterns({ observations: repeated, existing: [] }).length,
);
console.log("\nnothing was written.");
