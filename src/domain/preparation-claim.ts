/**
 * Who may take the next attempt at a piece of prepared work.
 *
 * Claiming is the only way a run starts. This module holds the rule, with no
 * clock, no storage and no network, so the same decision can be made by the
 * in-memory sandbox and by the real database adapter and be the same decision.
 *
 * The rule exists because two copies of the same event can arrive at once. A
 * lease makes the winner visible and bounded: whoever holds an unexpired lease
 * is preparing it, and nobody else starts. A crashed worker leaves an expired
 * lease, which is recoverable, not a row that says "Preparing" for ever.
 */

import type { ISODateTime } from "./entities";
import type { PreparationStatus } from "./preparation-jobs";

/** How long one attempt may hold a subject before it is recoverable. */
export const PREPARATION_LEASE_MS = 5 * 60_000;

/** The little that claiming needs to know about an existing record. */
export interface ClaimCandidate {
  status: PreparationStatus;
  attempts: number;
  /** Until when the current attempt holds it. Absent means nobody holds it. */
  leaseUntil?: ISODateTime | null;
  attemptId?: string | null;
  supersededBecause?: string | null;
}

export type ClaimDecision =
  /** Already answered for this exact revision. Do the work zero times. */
  | { act: "return_existing"; because: string }
  /** Somebody else holds it, or it must not run again. Write nothing. */
  | { act: "refuse"; status: PreparationStatus; because: string }
  /** Take it, as this attempt number. */
  | { act: "claim"; attempts: number; because: string };

export function leaseExpired(leaseUntil: ISODateTime | null | undefined, nowIso: string): boolean {
  if (!leaseUntil) return true;
  return leaseUntil <= nowIso;
}

/**
 * Decide the next attempt. Never hopeful: an unknown outcome and a stopped run
 * are both for a person, and a record that has run out of attempts stays put.
 */
export function claimDecision(input: {
  existing: ClaimCandidate | null;
  nowIso: string;
  maxAttempts: number;
}): ClaimDecision {
  const { existing, nowIso, maxAttempts } = input;
  if (!existing) {
    return { act: "claim", attempts: 1, because: "Nothing has been prepared for this yet." };
  }
  if (existing.supersededBecause) {
    return { act: "refuse", status: existing.status, because: existing.supersededBecause };
  }
  if (existing.status === "prepared" || existing.status === "needs_decision") {
    return { act: "return_existing", because: "This was already prepared from this version." };
  }
  if (existing.status === "uncertain") {
    return {
      act: "refuse",
      status: "uncertain",
      because:
        "We cannot tell whether the last attempt finished. A person needs to check before it runs again.",
    };
  }
  if (existing.status === "cancelled") {
    return { act: "refuse", status: "cancelled", because: "Someone stopped this run." };
  }
  if (existing.status === "running" && !leaseExpired(existing.leaseUntil, nowIso)) {
    return { act: "refuse", status: "running", because: "This is being prepared right now." };
  }
  if (existing.attempts >= maxAttempts) {
    return {
      act: "refuse",
      status: "could_not_finish",
      because: `Tried ${existing.attempts} times. Someone needs to look at it.`,
    };
  }
  const attempts = existing.attempts + 1;
  return {
    act: "claim",
    attempts,
    because:
      existing.status === "running"
        ? "The last attempt stopped without finishing, so this one picks it up."
        : "Trying again after a failure.",
  };
}

/** When the claim this attempt is taking runs out. */
export function leaseUntil(nowIso: string, leaseMs: number = PREPARATION_LEASE_MS): string {
  return new Date(new Date(nowIso).getTime() + leaseMs).toISOString();
}
