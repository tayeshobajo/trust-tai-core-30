/**
 * Mailbox onboarding: the Add to Comms decision.
 *
 * A labeled Gmail correspondent becomes a relationship in two steps that a
 * person should experience as one: the governed creation runs exactly as a
 * manual capture, then a bounded labeled backfill brings the existing
 * conversation history in, so the relationship is born with its memory.
 *
 * The laws that hold here:
 * - Creation comes first and is never rolled back. If history import fails,
 *   the relationship stays and the person is asked to sync again.
 * - The backfill is the existing member-authorized sync path: read-only,
 *   label-gated to Trust Tai/Comms, identity-matched, at most 60 messages.
 * - Adding the same person twice is safe: creation dedupes on email and the
 *   backfill upserts on provider message id, so repeats store nothing twice.
 */

import type { Relationship } from "@/domain/comms";
import type { RelationshipInput } from "@/data/supabase/comms-service";

/** Shown when the person exists but their labeled history did not come in. */
export const HISTORY_IMPORT_WARNING =
  "Added to Comms, but Gmail history could not be imported. Try sync again.";

/** The bounded window an onboarding backfill looks back. */
export const ONBOARDING_BACKFILL_DAYS = 30;

/** Client-side mirror of the server clamp: a backfill window is 1–90 days. */
export function clampBackfillDays(value: number): number {
  return Math.min(Math.max(Math.round(value), 1), 90);
}

export interface MailboxOnboardingDeps {
  /** The existing governed creation path; dedupes on email per organization. */
  createRelationship: (input: RelationshipInput) => Promise<Relationship>;
  /** The existing member-authorized bounded sync (syncGmail, backfillDays 30). */
  backfillHistory: () => Promise<unknown>;
}

export interface MailboxOnboardingResult {
  relationship: Relationship;
  /** Null on success; a non-destructive warning when only history failed. */
  historyWarning: string | null;
}

export async function addMailboxCandidateToComms(
  input: RelationshipInput,
  deps: MailboxOnboardingDeps,
): Promise<MailboxOnboardingResult> {
  // Creation failure propagates: no relationship, no backfill, nothing half-made.
  const relationship = await deps.createRelationship(input);
  try {
    await deps.backfillHistory();
    return { relationship, historyWarning: null };
  } catch {
    // History is best-effort once the person exists. Never delete or roll back.
    return { relationship, historyWarning: HISTORY_IMPORT_WARNING };
  }
}
