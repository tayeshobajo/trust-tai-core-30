/**
 * What the People card shows when a lookup has happened but the answer is not
 * stored yet.
 *
 * Two truths live side by side and must never be confused:
 *
 *   1. The provider answered. That is a result, and the person on screen is
 *      entitled to see the address, the state the provider asserted and when
 *      it was fetched, whether or not a database exists to keep it in.
 *   2. The answer was stored, or it was not. That is persistence, and its
 *      failure is a separate sentence, never dressed up as "not found".
 *
 * A pending answer always overlays an older saved version of the same person,
 * matched on the workspace-scoped identity, never on a name.
 */

import { identityKey } from "./scout-people-persistence";
import type { EnrichmentProviderId, ScoutPerson, StoredEmailStatus } from "./scout-people";

/** One provider answer, held in the page until it is stored. */
export interface PendingEnrichment {
  /** The identity this answer belongs to, scoped to one company. */
  identity: string;
  workEmail?: string | undefined;
  /** Derived from the provider's answer on the server, never from the browser. */
  emailStatus: StoredEmailStatus;
  provider: EnrichmentProviderId;
  emailFetchedAt: string;
  emailVerifiedAt?: string | undefined;
  /** The provider's own words about the answer. Never a failure message. */
  providerNote?: string | undefined;
  /** Details the match knew and the search had withheld. */
  title?: string | undefined;
  providerPersonId?: string | undefined;
  /** The server receipt that lets this exact answer be stored again for free. */
  receiptId?: string | undefined;
  receiptExpiresAt?: string | undefined;
  /** Why it is not stored. Absent while a save is simply in flight. */
  saveError?: string | undefined;
}

/** The identity a person is matched on inside one company. Never a name alone. */
export function personIdentity(
  person: Pick<ScoutPerson, "providerPersonId" | "workEmail" | "profileUrl" | "fullName" | "key">,
): string {
  const key = identityKey(person);
  return `${key.kind}:${key.value}`;
}

function checkedAt(person: Pick<ScoutPerson, "emailFetchedAt" | "emailVerifiedAt">): number {
  const value = person.emailVerifiedAt ?? person.emailFetchedAt;
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function pendingTime(pending: PendingEnrichment): number {
  const time = new Date(pending.emailVerifiedAt ?? pending.emailFetchedAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/** A receipt can still be used to store this answer without paying again. */
export function receiptUsable(pending: PendingEnrichment, now: string): boolean {
  if (!pending.receiptId || !pending.receiptExpiresAt) return false;
  const expires = new Date(pending.receiptExpiresAt).getTime();
  const at = new Date(now).getTime();
  if (Number.isNaN(expires) || Number.isNaN(at)) return false;
  return expires > at;
}

function apply(person: ScoutPerson, pending: PendingEnrichment): ScoutPerson {
  // An older saved answer never hides a newer lookup.
  if (pendingTime(pending) < checkedAt(person)) return person;
  const { workEmail: _old, emailVerifiedAt: _oldVerified, ...rest } = person;
  // Only fills a gap: what the person already has is never overwritten.
  const title = person.title ?? pending.title;
  const providerPersonId = person.providerPersonId ?? pending.providerPersonId;
  return {
    ...rest,
    ...(title ? { title } : {}),
    ...(providerPersonId ? { providerPersonId } : {}),
    ...(pending.workEmail ? { workEmail: pending.workEmail } : {}),
    emailStatus: pending.emailStatus,
    provider: pending.provider,
    emailFetchedAt: pending.emailFetchedAt,
    ...(pending.emailVerifiedAt ? { emailVerifiedAt: pending.emailVerifiedAt } : {}),
    pendingSave: true,
    ...(pending.providerNote ? { pendingNote: pending.providerNote } : {}),
    ...(pending.saveError ? { saveError: pending.saveError } : {}),
    ...(pending.receiptId ? { receiptId: pending.receiptId } : {}),
    ...(pending.receiptExpiresAt ? { receiptExpiresAt: pending.receiptExpiresAt } : {}),
  };
}

/**
 * The people the card shows: what is stored, then what this visit found, with
 * any answer that is not stored yet laid over the top of its own person.
 */
export function mergePeople(input: {
  saved: ScoutPerson[];
  session: ScoutPerson[];
  pending?: Record<string, PendingEnrichment> | undefined;
}): ScoutPerson[] {
  const pending = input.pending ?? {};
  const seen = new Set(input.saved.map(personIdentity));
  const rows = [
    ...input.saved,
    ...input.session.filter((person) => !seen.has(personIdentity(person))),
  ];
  return rows.map((person) => {
    const answer = pending[personIdentity(person)];
    return answer ? apply(person, answer) : person;
  });
}

/**
 * A title this workspace already recorded for the same person is not lost just
 * because the provider withheld one. Matched on the person's own name within
 * the same company, and only ever used to fill a gap.
 */
export interface KnownTitle {
  fullName: string;
  roleTitle?: string | undefined;
  companyName?: string | undefined;
}

const plain = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

export function fillKnownTitles(people: ScoutPerson[], known: KnownTitle[]): ScoutPerson[] {
  const titles = new Map<string, string>();
  for (const entry of known) {
    if (!entry.roleTitle) continue;
    const name = plain(entry.fullName);
    if (!name) continue;
    if (entry.companyName) titles.set(`${plain(entry.companyName)}|${name}`, entry.roleTitle);
    // A name-only key is a last resort and never merges the people themselves.
    if (!titles.has(name)) titles.set(name, entry.roleTitle);
  }
  return people.map((person) => {
    if (person.title) return person;
    const name = plain(person.fullName);
    const title = titles.get(`${plain(person.companyName)}|${name}`) ?? titles.get(name);
    return title ? { ...person, title } : person;
  });
}
