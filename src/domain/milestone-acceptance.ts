/**
 * Trust Tai OS, delivery acceptance on a milestone.
 *
 * Roadmap approval and delivery acceptance are different facts. A milestone at
 * `approved` / `decided` was chosen into the roadmap; nothing about the work
 * was accepted by that. Acceptance is its own explicit human fact, recorded on
 * the milestone itself as `accepted_at`, `accepted_by`, an optional actor
 * label and an optional note.
 *
 * Three laws hold here and are enforced by tests:
 *   1. Complete is derived from the presence of `acceptedAt`, never from a
 *      roadmap status.
 *   2. Only an explicit person action accepts. Nothing here accepts, and a
 *      full checklist is readiness, not a decision.
 *   3. Reopening is explicit, clears acceptance truth only, and never touches
 *      conditions or their evidence.
 */

import type { ID, ISODateTime } from "./entities";

export interface MilestoneAcceptance {
  acceptedAt: ISODateTime;
  acceptedBy: ID;
  /** The person as displayed, when the actor label pattern gave us one. */
  acceptedByLabel?: string;
  /** Why, in the accepting person's own words. Optional. */
  note?: string;
}

/** The one definition of complete. */
export function isAccepted(milestone: { acceptance?: MilestoneAcceptance | null }): boolean {
  return Boolean(milestone.acceptance?.acceptedAt);
}

/**
 * One acceptance per milestone. A retried request carries the same key, so the
 * activity stream keeps one receipt and `accepted_at` is written once.
 */
export function acceptanceEventKey(milestoneId: ID): string {
  return `milestone-accepted:${milestoneId}`;
}

export function reopenEventKey(milestoneId: ID, acceptedAt: ISODateTime): string {
  return `milestone-reopened:${milestoneId}:${acceptedAt}`;
}

export const ALREADY_ACCEPTED = "That milestone has already been accepted.";
export const NOT_ACCEPTED = "That milestone has not been accepted, so there is nothing to reopen.";
export const NOT_READY =
  "That milestone is not ready for acceptance yet: describe the outcome and check every condition first.";

/** How the accepted state reads on the card, in plain language. */
export function acceptanceSummary(acceptance: MilestoneAcceptance): string {
  const who = acceptance.acceptedByLabel?.trim();
  const day = acceptance.acceptedAt.slice(0, 10);
  return who ? `Accepted by ${who} on ${day}.` : `Accepted on ${day}.`;
}
