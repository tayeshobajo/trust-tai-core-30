/**
 * Today, derived.
 *
 * Pure ordering over real commitment state. Nothing here invents urgency: a
 * move is at risk only because a date a person set has passed, or because the
 * promise has not moved for long enough to be worth saying out loud.
 */

import type { EvidenceRef } from "@/domain/confidence";
import type { Commitment, MoveState, TodayMove } from "@/domain/steward";

const DAY = 86_400_000;

/** Days with no movement before a promise is worth raising. */
export const STALE_DAYS = 5;

function daysBetween(from: string, to: string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / DAY);
}

function computed(label: string): EvidenceRef {
  return { label, kind: "computed" };
}

export interface MoveRead {
  state: MoveState;
  why: string;
  urgency: number;
  evidence: EvidenceRef[];
}

/** Why this promise is where it is. Derived from dates and movement only. */
export function readCommitment(commitment: Commitment, now: string): MoveRead | null {
  if (commitment.status === "kept" || commitment.status === "released") return null;

  const idle = daysBetween(commitment.updatedAt, now);
  const evidence: EvidenceRef[] = [...commitment.evidence];

  if (commitment.dueAt) {
    const overdue = daysBetween(commitment.dueAt, now);
    if (overdue > 0) {
      return {
        state: "at_risk",
        why: `Due date passed ${overdue} day${overdue === 1 ? "" : "s"} ago and the promise is still open.`,
        urgency: 90 + Math.min(9, overdue),
        evidence: [...evidence, computed(`Due ${commitment.dueAt.slice(0, 10)}, still open`)],
      };
    }
    if (overdue === 0) {
      return {
        state: "needs_movement",
        why: "Due today.",
        urgency: 80,
        evidence: [...evidence, computed("Due today")],
      };
    }
  }

  if (commitment.status === "waiting") {
    return {
      state: "waiting",
      why: idle > 0 ? `Waiting on someone else for ${idle} day${idle === 1 ? "" : "s"}.` : "Waiting on someone else.",
      urgency: 40 + Math.min(20, idle),
      evidence: [...evidence, computed("Marked waiting by a person")],
    };
  }

  if (idle >= STALE_DAYS) {
    return {
      state: "at_risk",
      why: `No movement for ${idle} days since it was made.`,
      urgency: 70 + Math.min(15, idle - STALE_DAYS),
      evidence: [...evidence, computed(`Last movement ${idle} days ago`)],
    };
  }

  if (!commitment.dueAt) {
    return {
      state: "needs_movement",
      why: commitment.dueText
        ? `Timing was said out loud as "${commitment.dueText}", but no date has been set.`
        : "Open promise with no date set.",
      urgency: commitment.dueText ? 60 : 50,
      evidence: [
        ...evidence,
        computed(commitment.dueText ? "Timing spoken, date not set" : "No date set"),
      ],
    };
  }

  return {
    state: "needs_movement",
    why: `Due ${commitment.dueAt.slice(0, 10)}.`,
    urgency: 55,
    evidence,
  };
}

export interface TodayInput {
  commitments: Commitment[];
  now: string;
  /** When given, Today leads with this person's promises. */
  viewerKey?: string;
}

function ownerKey(commitment: Commitment): string {
  return (commitment.ownerEmail ?? commitment.ownerName).trim().toLowerCase();
}

/** The ordered Today list. Mine first, then at risk, then oldest. */
export function buildToday(input: TodayInput): TodayMove[] {
  const viewer = (input.viewerKey ?? "").trim().toLowerCase();
  const moves: TodayMove[] = [];

  for (const commitment of input.commitments) {
    const read = readCommitment(commitment, input.now);
    if (!read) continue;
    const mine = viewer.length > 0 && ownerKey(commitment) === viewer;
    moves.push({
      id: commitment.id,
      title: commitment.what,
      why: read.why,
      ownerName: commitment.ownerName,
      state: read.state,
      tier: "decided",
      sourceLabel: commitment.beneficiary
        ? `Promised to ${commitment.beneficiary}`
        : "Confirmed from a conversation",
      evidence: read.evidence,
      destination: {
        appId: "steward",
        label: "Open in Steward",
        route: "/modules/steward",
      },
      urgency: read.urgency + (mine ? 100 : 0),
      at: commitment.updatedAt,
    });
  }

  return moves.sort(
    (a, b) => b.urgency - a.urgency || new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
}

/** How a person is standing, from their open promises alone. */
export function standingFor(
  commitments: Commitment[],
  now: string,
): "on_track" | "needs_attention" | "waiting" {
  const reads = commitments.map((c) => readCommitment(c, now)).filter(Boolean) as MoveRead[];
  if (reads.some((read) => read.state === "at_risk")) return "needs_attention";
  if (reads.length > 0 && reads.every((read) => read.state === "waiting")) return "waiting";
  return "on_track";
}
