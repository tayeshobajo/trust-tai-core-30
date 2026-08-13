/**
 * Scout → Comms handoff.
 *
 * A handoff is a brief, not a message. It says who to contact, what the
 * conversation is for, and the context Comms cannot work without — every line
 * traceable to stored evidence or a human decision.
 *
 * Nothing here sends anything, drafts no copy, and invents no claim. A handoff
 * that is not ready says so and names what is missing.
 */

import type { ConfidenceRead, EvidenceRef } from "./confidence";
import type { ID, ISODateTime } from "./entities";
import type { EmailStatus } from "./people";

export type HandoffIntent = "introduce" | "diagnose" | "propose" | "reconnect";

export const HANDOFF_INTENT_LABEL: Record<HandoffIntent, string> = {
  introduce: "Open a conversation",
  diagnose: "Offer a diagnostic read",
  propose: "Propose specific work",
  reconnect: "Reconnect on an earlier thread",
};

export interface HandoffContact {
  personId?: ID;
  fullName: string;
  roleTitle?: string;
  email?: string;
  emailStatus: EmailStatus;
  emailCheckedAt?: ISODateTime;
  /** True only for a verified address. Never inferred. */
  reachable: boolean;
}

/** A person Comms could open with, and why they are on the list. */
export interface HandoffTarget extends HandoffContact {
  /** The one Comms should open with, or a named fallback. */
  rank: "primary" | "alternate";
  /** Why this person, in plain language. */
  why: string;
  /** What would have to be true for them to be contactable, if anything. */
  blocker?: string;
}

/** One thing Comms must know before writing a word. */
export interface HandoffContextItem {
  label: string;
  value: string;
  /** Kept strictly apart: read, inferred, or decided by a person. */
  tier: "fact" | "inference" | "decision";
  evidence: EvidenceRef[];
}

export interface HandoffDraft {
  prospectId: ID;
  companyName: string;
  websiteUrl?: string;
  contact: HandoffContact | null;
  /** Ranked outreach targets: verified decision-makers and founders first. */
  targets: HandoffTarget[];
  intent: HandoffIntent;
  /** Why this intent and not another. */
  intentBecause: string;
  requiredContext: HandoffContextItem[];
  confidence: ConfidenceRead;
  /** What stops this from being handed over. Empty means ready. */
  blockers: string[];
  ready: boolean;
  generatedAt: ISODateTime;
}

/** What is written to the prospect when a member routes it to Comms. */
export interface HandoffRecord {
  draft: HandoffDraft;
  routedAt: ISODateTime;
  routedBy: ID;
}
