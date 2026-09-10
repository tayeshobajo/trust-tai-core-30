/**
 * Relationship routes: where a message can actually go.
 *
 * A Comms relationship carries two possible routes, the `email` column and a
 * LinkedIn profile URL kept in relationship metadata. Both follow the same
 * doctrine as Scout's route form: an address a person typed is stored either
 * way, but it is a route only once somebody has explicitly confirmed it is
 * right. Nothing here sends; these are the rules for what may be saved and
 * how the record reads back.
 *
 * Pure and I/O-free, so the validation the UI shows and the tests pin are the
 * same rules.
 */

import type { RelationshipStage } from "./comms";

/** Metadata keys, shared by the route editor and the Scout handoff receiver. */
export const LINKEDIN_URL_KEY = "linkedin_url";
export const LINKEDIN_CONFIRMED_KEY = "linkedin_confirmed";
export const EMAIL_CONFIRMED_KEY = "email_confirmed";

/**
 * Minimal email shape: something before the @, something after, with a dot in
 * the domain. Deliverability is the sender's problem; this only refuses
 * entries that cannot be an address at all.
 */
export function validateRouteEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "That does not read as an email address. Check it and try again.";
  }
  return null;
}

/**
 * A LinkedIn profile URL must actually be on LinkedIn: http(s), with a host
 * that IS linkedin.com or ends in `.linkedin.com`. Lookalikes are refused,
 * `notlinkedin.com` and `evil.com/linkedin.com/in/x` both fail here, because
 * a route stored under the wrong host would send a person somewhere else.
 */
export function validateLinkedinUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That does not read as a web address. Paste the full profile URL.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "A LinkedIn profile URL starts with https://";
  }
  const host = url.hostname.toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) {
    return "That address is not on linkedin.com, so it cannot be saved as a LinkedIn route.";
  }
  return null;
}

/** The LinkedIn route a relationship's metadata holds, if any. */
export function readLinkedinRoute(
  metadata: Record<string, unknown> | null | undefined,
): { url: string; confirmed: boolean } | null {
  const url = metadata?.[LINKEDIN_URL_KEY];
  if (typeof url !== "string" || !url.trim()) return null;
  return { url: url.trim(), confirmed: metadata?.[LINKEDIN_CONFIRMED_KEY] === true };
}

/** Whether the metadata marks the relationship's email as human-confirmed. */
export function readEmailConfirmed(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.[EMAIL_CONFIRMED_KEY] === true;
}

/**
 * Whether the metadata explicitly says the email is NOT confirmed.
 *
 * Deliberately narrower than `!readEmailConfirmed`: only a literal `false`
 * blocks a send. An absent key means the address predates the route editor
 * (capture, handoff, legacy import) and must keep sending exactly as it
 * always has; treating absence as doubt would silently break every existing
 * relationship.
 */
export function readEmailExplicitlyUnconfirmed(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return metadata?.[EMAIL_CONFIRMED_KEY] === false;
}

export interface RouteInput {
  email?: string | undefined;
  emailConfirmed?: boolean | undefined;
  linkedinUrl?: string | undefined;
  linkedinConfirmed?: boolean | undefined;
}

export interface RoutePatch {
  email?: string;
  metadata: Record<string, unknown>;
}

/**
 * The exact patch `commsService.update` should receive for a route change.
 *
 * `commsService.update` replaces the metadata column with whatever the patch
 * carries, so the existing metadata is spread here first: a route edit can
 * never clobber the `scout_handoff` blob or any other key it did not touch.
 * A field the person left blank is left alone.
 */
export function routePatch(
  existing: Record<string, unknown> | null | undefined,
  input: RouteInput,
): RoutePatch {
  const metadata: Record<string, unknown> = { ...(existing ?? {}) };
  const patch: RoutePatch = { metadata };
  if (input.email?.trim()) {
    patch.email = input.email.trim().toLowerCase();
    metadata[EMAIL_CONFIRMED_KEY] = input.emailConfirmed === true;
  }
  if (input.linkedinUrl?.trim()) {
    metadata[LINKEDIN_URL_KEY] = input.linkedinUrl.trim();
    metadata[LINKEDIN_CONFIRMED_KEY] = input.linkedinConfirmed === true;
  }
  return patch;
}

/* -------------------------------------------------- manual LinkedIn send */

/** Provenance source stamped on a message row a member recorded by hand. */
export const MANUAL_LINKEDIN_SOURCE = "manual-linkedin-send";

/** The provider a hand-recorded LinkedIn send is stored under. */
export const MANUAL_LINKEDIN_PROVIDER = "manual_linkedin";

/**
 * One deterministic synthetic id per draft, same pattern as the Gmail path's
 * `deterministicMessageId`: recording the same draft twice can only ever
 * touch the same `comms_messages` row.
 */
export function manualLinkedinMessageId(draftId: string): string {
  return `manual-linkedin-${draftId}`;
}

/**
 * Where the relationship stands after a member records a LinkedIn send.
 * Nothing anywhere else writes `reached_out`, so the rule lives here and is
 * deliberately narrow: only a relationship that has not been reached yet
 * moves forward, and a later stage (in conversation, client, nurture) is
 * never regressed by recording an outreach that fed it.
 */
export function stageAfterManualSend(stage: RelationshipStage): RelationshipStage | null {
  return stage === "new" || stage === "ready_to_reach" ? "reached_out" : null;
}
