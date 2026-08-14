/**
 * Continuity: one story across many conversations.
 *
 * A commitment made in March, chased in April and finished in May is one
 * story, not three. This module looks at what a new conversation says against
 * the commitments the workspace already carries and proposes, in plain
 * language, that the same story just moved.
 *
 * It proposes. It never writes and never changes a status. A person decides,
 * because only a person knows whether "I sent that over" meant the thing they
 * promised or something adjacent that sounds like it.
 *
 * Pure functions only.
 */

import { personKeyOf } from "@/domain/steward";
import type { Commitment } from "@/domain/steward";
import type { InterpretedSignal } from "@/domain/steward-semantic";
import { STATE_CHANGE_LABEL, type StateChangeKind, type StateChangeProposal } from "@/domain/steward-memory";

/** Below this the two sentences are simply about different work. */
const MATCH_FLOOR = 0.45;

const STOPWORDS = new Set([
  "the","a","an","to","of","and","or","for","with","on","in","at","by","is","are","be","will",
  "that","this","it","we","i","you","he","she","they","them","our","your","their","from","as",
  "have","has","had","do","does","did","get","got","need","needs","going","gonna","just","so",
]);

function terms(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
  );
}

/** Overlap of meaningful words, weighted to the shorter sentence. */
export function statementOverlap(left: string, right: string): number {
  const a = terms(left);
  const b = terms(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

const COMPLETED =
  /\b(sent|shared|delivered|finished|completed|done|wrapped|handed (?:it )?over|already (?:sent|did|done)|went out)\b/i;
const WAITING =
  /\b(waiting (?:on|for)|still waiting|blocked (?:on|by)|pending|held up|hasn'?t (?:come|come back|replied)|once .* (?:confirms|comes back))\b/i;
const RELEASED =
  /\b(no longer|not doing|dropped|cancelled|canceled|scrapped|parked|shelved|don'?t need|not needed)\b/i;

function readKind(signal: InterpretedSignal): StateChangeKind | null {
  const text = `${signal.normalizedMeaning} ${signal.quote}`;
  if (signal.disposition === "already_completed" || COMPLETED.test(text)) return "already_completed";
  if (RELEASED.test(text)) return "released";
  if (signal.disposition === "dependency" || WAITING.test(text)) return "waiting";
  if (signal.disposition === "duplicate") return "restated";
  return null;
}

const PROPOSED_STATUS: Record<StateChangeKind, StateChangeProposal["proposedStatus"]> = {
  already_completed: "kept",
  waiting: "waiting",
  released: "released",
  restated: null,
};

/** Statuses that are still live. A kept or released promise is not re-opened here. */
const LIVE_STATUSES = new Set(["open", "waiting"]);

/**
 * Propose that a new reading continues work the workspace already tracks.
 *
 * Owner agreement is required when both sides name someone: two people can
 * easily promise similar-sounding things, and quietly closing the wrong one is
 * worse than proposing nothing.
 */
export function proposeStateChanges(input: {
  signals: InterpretedSignal[];
  commitments: Commitment[];
  floor?: number;
}): StateChangeProposal[] {
  const floor = input.floor ?? MATCH_FLOOR;
  const live = input.commitments.filter((commitment) => LIVE_STATUSES.has(commitment.status));
  const proposals: StateChangeProposal[] = [];
  const claimed = new Set<string>();

  for (const signal of input.signals) {
    const kind = readKind(signal);
    if (!kind) continue;

    let best: { commitment: Commitment; score: number } | null = null;
    for (const commitment of live) {
      if (claimed.has(commitment.id)) continue;
      const score = statementOverlap(signal.normalizedMeaning, commitment.what);
      if (score < floor) continue;

      const signalOwner = (signal.ownerName ?? "").trim();
      if (signalOwner && commitment.ownerName) {
        const same =
          personKeyOf({ name: signalOwner }) === personKeyOf({ name: commitment.ownerName });
        if (!same) continue;
      }
      if (!best || score > best.score) best = { commitment, score };
    }
    if (!best) continue;
    claimed.add(best.commitment.id);

    proposals.push({
      commitmentId: best.commitment.id,
      commitmentStatement: best.commitment.what,
      currentStatus: best.commitment.status,
      proposedStatus: PROPOSED_STATUS[kind],
      kind,
      signalId: signal.id,
      signalMeaning: signal.normalizedMeaning,
      because: `${STATE_CHANGE_LABEL[kind]} Steward matched it to “${best.commitment.what}”, carried by ${best.commitment.ownerName}.`,
      evidence: [
        ...signal.evidence,
        {
          kind: "computed" as const,
          label: `Matched an existing commitment on ${Math.round(best.score * 100)}% of its wording.`,
        },
      ],
    });
  }

  return proposals;
}

/**
 * The living history of one commitment, oldest first: where it was first
 * promised, and every later conversation that moved it.
 */
export interface CommitmentThread {
  commitmentId: string;
  what: string;
  ownerName: string;
  status: string;
  entries: { at: string; label: string; conversationId?: string }[];
}

export function buildCommitmentThread(input: {
  commitment: Commitment;
  proposals: StateChangeProposal[];
  conversationTitleById?: Record<string, string>;
}): CommitmentThread {
  const entries: CommitmentThread["entries"] = [
    {
      at: input.commitment.createdAt,
      label: `Promised by ${input.commitment.ownerName}${
        input.commitment.dueText ? ` — ${input.commitment.dueText}` : ""
      }`,
      ...(input.commitment.conversationId ? { conversationId: input.commitment.conversationId } : {}),
    },
  ];

  for (const proposal of input.proposals) {
    if (proposal.commitmentId !== input.commitment.id) continue;
    entries.push({ at: input.commitment.updatedAt, label: STATE_CHANGE_LABEL[proposal.kind] });
  }

  return {
    commitmentId: input.commitment.id,
    what: input.commitment.what,
    ownerName: input.commitment.ownerName,
    status: input.commitment.status,
    entries,
  };
}
