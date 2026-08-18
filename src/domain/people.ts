/**
 * Trust Tai OS, People contracts.
 *
 * People are the layer between a company and a conversation: who decides, how
 * they can be reached, and how confident we are in either claim.
 *
 * Two rules hold everywhere:
 *  1. Nothing is invented. Every person carries a source and a confidence, and
 *     an unverified email is never presented as reachable.
 *  2. A human decision outranks any provider. Once a member confirms a person
 *     or an email, no later provider run overwrites it.
 *
 * Only APPROVED sources may be ingested. Scraping LinkedIn (or any site that
 * forbids it) is out of scope: LinkedIn URLs are stored as links a provider
 * returned or a human pasted, never as a crawl target.
 */

import type { Provenance } from "./activity";
import type { ID, ISODateTime } from "./entities";

/** How reachable an email address actually is. Never assume better. */
export type EmailStatus =
  | "unknown"
  | "found"
  | "verified"
  | "risky"
  | "invalid"
  | "bounced";

export const EMAIL_STATUS_LABEL: Record<EmailStatus, string> = {
  unknown: "No email",
  found: "Found, unverified",
  verified: "Verified",
  risky: "Risky",
  invalid: "Invalid",
  bounced: "Bounced",
};

/** How much to trust the claim that this person holds this role. */
export type PersonConfidence =
  | "observed"
  | "inferred"
  | "asserted_by_provider"
  | "human_confirmed";

export const CONFIDENCE_LABEL: Record<PersonConfidence, string> = {
  observed: "Read from a public page",
  inferred: "Inferred by Scout",
  asserted_by_provider: "Asserted by a provider",
  human_confirmed: "Confirmed by a person",
};

export type Seniority =
  | "founder"
  | "owner"
  | "exec"
  | "marketing"
  | "operations"
  | "other";

export const SENIORITY_LABEL: Record<Seniority, string> = {
  founder: "Founder",
  owner: "Owner",
  exec: "Executive",
  marketing: "Marketing",
  operations: "Operations",
  other: "Other",
};

/** Seniorities that plausibly decide on a website or growth engagement. */
export const DECIDING_SENIORITIES: Seniority[] = ["founder", "owner", "exec"];

/** A person on record for a company. Backed by the shared `contacts` table. */
export interface Person {
  id: ID;
  organizationId: ID;
  /** The Scout prospect this person belongs to, when they came from Scout. */
  prospectId?: ID;
  clientId?: ID;
  fullName: string;
  roleTitle?: string;
  seniority: Seniority;
  email?: string;
  emailStatus: EmailStatus;
  /** When the address was last checked or confirmed. Never assumed. */
  emailCheckedAt?: ISODateTime;
  /** Who or what performed that last check. */
  emailCheckedBy?: string;
  confidence: PersonConfidence;
  linkedinUrl?: string;
  phone?: string;
  /** Id of the provider that produced this record, or "manual". */
  sourceId: string;
  /** Public page or provider record this person was read from. */
  sourceUrl?: string;
  /** Anything worth saying out loud about how this record was formed. */
  note?: string;
  provenance: Provenance;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** What a provider (or a person filling the form) proposes. Not yet stored. */
export interface PersonDraft {
  fullName: string;
  roleTitle?: string;
  seniority?: Seniority;
  email?: string;
  emailStatus?: EmailStatus;
  confidence?: PersonConfidence;
  linkedinUrl?: string;
  phone?: string;
  /** Public page or provider record the claim came from. */
  sourceUrl?: string;
  note?: string;
}

export type PeopleSourceKind = "manual" | "public_website" | "enrichment";

/** Anything ingestible must declare itself here first. Nothing else is read. */
export interface PeopleProviderInfo {
  id: string;
  label: string;
  description: string;
  kind: PeopleSourceKind;
  /** Explicitly approved for Trust Tai use (terms allow programmatic access). */
  approved: boolean;
  /** Confidence every record from this source starts at. */
  baseConfidence: PersonConfidence;
}

export interface PeopleDiscoveryInput {
  organizationId: ID;
  prospectId: ID;
  companyName: string;
  websiteUrl?: string;
  domain?: string;
  /** Raw observation keys already read for this company, when available. */
  facts?: Record<string, unknown>;
  /** Human-readable statements already read for this company. */
  statements?: string[];
}

export interface EmailLookupInput {
  organizationId: ID;
  fullName: string;
  domain: string;
  companyName?: string;
}

export interface EmailVerification {
  email: string;
  status: EmailStatus;
  note?: string;
}

/**
 * The one shape every people source implements. Adding a compliant provider
 * later means writing this interface, no caller changes.
 */
export interface PeopleProvider extends PeopleProviderInfo {
  /** Whether this source can run right now (keys present, function deployed). */
  available(): Promise<boolean>;
  discover(input: PeopleDiscoveryInput): Promise<PersonDraft[]>;
  findEmail?(input: EmailLookupInput): Promise<EmailVerification | null>;
  verifyEmail?(email: string): Promise<EmailVerification>;
}

/** Email states that are safe to send to. Nothing else is reachable. */
export function isReachable(person: Person): boolean {
  return person.emailStatus === "verified";
}

/** A contact is ready for Comms only when all of this is true. */
export function isCommsReady(person: Person): boolean {
  return Boolean(person.fullName && person.roleTitle && person.emailStatus === "verified");
}

export function isDecisionMaker(person: Person): boolean {
  return DECIDING_SENIORITIES.includes(person.seniority);
}

/** Human confirmation is immutable to automation. */
export function isHumanOwned(person: Person): boolean {
  return person.confidence === "human_confirmed" || person.sourceId === "manual";
}

export function guessSeniority(roleTitle: string | undefined): Seniority {
  const value = (roleTitle ?? "").toLowerCase();
  if (!value) return "other";
  if (/\bfounder|co-?founder\b/.test(value)) return "founder";
  if (/\bowner|principal|partner|proprietor\b/.test(value)) return "owner";
  if (/\bceo|cto|coo|cmo|cfo|chief|president|managing director|director\b/.test(value)) {
    return "exec";
  }
  if (/\bmarketing|brand|growth|content\b/.test(value)) return "marketing";
  if (/\boperations|ops|office manager|admin\b/.test(value)) return "operations";
  return "other";
}
