/**
 * Steward's contribution to shared intelligence.
 *
 * Steward reads its own commitments and conversations and hands the rest of
 * the suite context blocks and signals in the shared shape. It never changes
 * another room's state: every signal routes back to where the work happens.
 */

import type { ContextBlock, Signal } from "@/domain/signals";
import type { Commitment, NormalizedConversation } from "@/domain/steward";

import { readCommitment } from "./today";

const DAY = 86_400_000;

export interface StewardSnapshot {
  commitments: Commitment[];
  /** Conversation headers only. Transcripts stay inside Steward. */
  conversations: { id: string; title: string; occurredAt: string; url?: string }[];
}

export function emptyStewardSnapshot(): StewardSnapshot {
  return { commitments: [], conversations: [] };
}

function staleness(at: string, now: string): number {
  const a = new Date(at).getTime();
  const b = new Date(now).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / DAY));
}

/** What Steward knows, in the shared context shape. */
export function stewardContextBlocks(snapshot: StewardSnapshot, now: string): ContextBlock[] {
  return snapshot.commitments
    .filter((commitment) => commitment.status === "open" || commitment.status === "waiting")
    .map((commitment) => ({
      id: `steward-commitment-${commitment.id}`,
      appId: "steward" as const,
      entity: { type: "task" as const, id: commitment.id, label: commitment.what },
      fact: `${commitment.ownerName} committed to ${commitment.what}${
        commitment.dueAt ? `, due ${commitment.dueAt.slice(0, 10)}` : ""
      }.`,
      tier: "decided" as const,
      evidence: commitment.evidence,
      at: commitment.updatedAt,
      stalenessDays: staleness(commitment.updatedAt, now),
      confidence: "high" as const,
    }));
}

/**
 * Follow-through signals. One per commitment at most, so the room never
 * repeats itself, and each carries the block it rests on.
 */
export function deriveStewardSignals(snapshot: StewardSnapshot, now: string): Signal[] {
  const signals: Signal[] = [];

  for (const commitment of snapshot.commitments) {
    const read = readCommitment(commitment, now);
    if (!read || read.state === "needs_movement") continue;

    signals.push({
      id: `steward-${commitment.id}`,
      category: "stewardship",
      title:
        read.state === "at_risk"
          ? `${commitment.ownerName}'s promise is slipping`
          : `${commitment.ownerName} is waiting to move`,
      why: `${commitment.what}. ${read.why}`,
      subject: { type: "task", id: commitment.id, label: commitment.what },
      evidence: read.evidence,
      contextRefs: [`steward-commitment-${commitment.id}`],
      confidence: "high",
      recommendedNextMove:
        read.state === "at_risk"
          ? "Confirm whether this still stands, then set a date or release it."
          : "Name who is being waited on, and what unblocks it.",
      destination: { appId: "steward", label: "Open in Steward", route: "/modules/steward" },
      status: "new",
      urgency: read.urgency,
      at: commitment.updatedAt,
    });
  }

  /* A promise made by nobody is the one thing Steward always raises. */
  const unowned = snapshot.commitments.filter(
    (commitment) => commitment.status === "open" && !commitment.ownerName.trim(),
  );
  if (unowned.length > 0) {
    const first = unowned[0]!;
    signals.push({
      id: "steward-unowned",
      category: "stewardship",
      title: `${unowned.length} commitment${unowned.length === 1 ? "" : "s"} without an owner`,
      why: "A promise with no owner will not be kept by anyone.",
      evidence: first.evidence,
      contextRefs: [`steward-commitment-${first.id}`],
      confidence: "high",
      recommendedNextMove: "Assign an owner, or release the commitment.",
      destination: { appId: "steward", label: "Open in Steward", route: "/modules/steward" },
      status: "new",
      urgency: 85,
      at: first.updatedAt,
    });
  }

  return signals.sort((a, b) => b.urgency - a.urgency);
}

/** Header shape used for context, so transcripts never leave Steward. */
export function conversationHeader(conversation: NormalizedConversation, id: string) {
  return {
    id,
    title: conversation.title,
    occurredAt: conversation.occurredAt,
    ...(conversation.sourceRef.url ? { url: conversation.sourceRef.url } : {}),
  };
}
