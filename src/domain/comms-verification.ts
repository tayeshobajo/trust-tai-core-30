/**
 * Proof that a human-sent draft actually reached the mailbox.
 *
 * Comms never sends email. A person marks an approved draft as sent — that is
 * a claim. The mailbox, read back later, is the evidence. This module is the
 * deterministic rule that reconciles the two, and it is deliberately strict:
 *
 *   attempted != executed != verified != human accepted
 *
 * A draft is mailbox-verified only when an outbound message is observed that
 *  - was sent after the draft was marked sent (small clock-skew allowance),
 *  - went to the person the draft was written for, and
 *  - carries the draft's subject or the fingerprint of its opening words.
 *
 * When the evidence is insufficient the answer is "no match", never a guess.
 * Pure and I/O-free so the sync worker and the timeline read the same rules.
 */

import type { ISODateTime } from "./entities";

/* ------------------------------------------------------------------ types */

/** Written onto `comms_drafts.rationale.verification` when the mailbox agrees. */
export interface DraftVerification {
  state: "mailbox_verified";
  /** The Gmail message that proves the send. */
  providerMessageId: string;
  verifiedAt: ISODateTime;
  /** Which signals carried the match, e.g. ["subject", "recipient"]. */
  matchedBy: string[];
}

/** The slice of a draft the matcher needs. */
export interface SentDraftLike {
  id: string;
  subject?: string;
  body: string;
  /** When the person marked it sent (`comms_drafts.updated_at`). */
  markedSentAt: ISODateTime;
  /** The relationship's email address, when known. */
  recipientEmail?: string;
}

/** The slice of an observed mailbox message the matcher needs. */
export interface ObservedMessageLike {
  providerMessageId: string;
  direction: "inbound" | "outbound";
  occurredAt: ISODateTime;
  subject?: string;
  snippet?: string;
  toEmails: string[];
  ccEmails: string[];
}

export interface DraftVerificationPlan {
  draftId: string;
  providerMessageId: string;
  matchedBy: string[];
}

/* ------------------------------------------------------------- primitives */

/** Clock skew and "marked sent just after hitting send" allowance. */
const SKEW_BEFORE_MS = 2 * 60 * 60 * 1000;
/** A send claim older than this is no longer worth reconciling. */
const WINDOW_AFTER_MS = 21 * 24 * 60 * 60 * 1000;
/** Below this, a body fingerprint is too weak to stand alone. */
const MIN_FINGERPRINT = 24;
const FINGERPRINT_LENGTH = 48;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'");
}

/** Subjects compare without reply prefixes, case, or punctuation. */
export function normalizeSubject(value: string | undefined): string {
  if (!value) return "";
  let text = decodeEntities(value).toLowerCase();
  for (let guard = 0; guard < 8; guard += 1) {
    const stripped = text.replace(/^\s*(re|fwd?|aw|wg)\s*:\s*/i, "");
    if (stripped === text) break;
    text = stripped;
  }
  return text.replace(/[^a-z0-9]+/g, " ").trim();
}

/** Opening words of a body, reduced to letters and digits. */
export function bodyFingerprint(body: string): string {
  return decodeEntities(body)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, FINGERPRINT_LENGTH);
}

function normalizedHaystack(message: ObservedMessageLike): string {
  return decodeEntities(`${message.subject ?? ""} ${message.snippet ?? ""}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/* --------------------------------------------------------------- matching */

/**
 * Whether one observed message credibly proves one sent draft.
 * Returns the signals that carried it, or null when evidence is insufficient.
 */
export function matchSentDraft(
  draft: SentDraftLike,
  message: ObservedMessageLike,
): string[] | null {
  if (message.direction !== "outbound") return null;

  const marked = new Date(draft.markedSentAt).getTime();
  const sent = new Date(message.occurredAt).getTime();
  if (Number.isNaN(marked) || Number.isNaN(sent)) return null;
  if (sent < marked - SKEW_BEFORE_MS || sent > marked + WINDOW_AFTER_MS) return null;

  const matchedBy: string[] = [];

  if (draft.recipientEmail) {
    const recipient = draft.recipientEmail.toLowerCase();
    const addressed = [...message.toEmails, ...message.ccEmails].map((entry) =>
      entry.toLowerCase(),
    );
    if (!addressed.includes(recipient)) return null;
    matchedBy.push("recipient");
  }

  const draftSubject = normalizeSubject(draft.subject);
  const messageSubject = normalizeSubject(message.subject);
  if (draftSubject && messageSubject) {
    if (draftSubject !== messageSubject) return null;
    matchedBy.push("subject");
  }

  const fingerprint = bodyFingerprint(draft.body);
  if (fingerprint.length >= MIN_FINGERPRINT && normalizedHaystack(message).includes(fingerprint)) {
    matchedBy.push("body");
  }

  // A recipient match alone only narrows the field; something about the
  // content itself — subject line or opening words — must agree.
  if (!matchedBy.includes("subject") && !matchedBy.includes("body")) return null;
  return matchedBy;
}

/**
 * Reconcile a set of sent-but-unverified drafts against observed outbound
 * messages. Deterministic: drafts are considered in the order they were
 * marked sent, each takes the earliest qualifying message, and one message
 * can only ever verify one draft. Anything ambiguous is simply not matched.
 */
export function planDraftVerifications(
  drafts: SentDraftLike[],
  messages: ObservedMessageLike[],
): DraftVerificationPlan[] {
  const outbound = messages
    .filter((message) => message.direction === "outbound")
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const ordered = [...drafts].sort((left, right) =>
    left.markedSentAt.localeCompare(right.markedSentAt),
  );

  const claimed = new Set<string>();
  const plan: DraftVerificationPlan[] = [];
  for (const draft of ordered) {
    for (const message of outbound) {
      if (claimed.has(message.providerMessageId)) continue;
      const matchedBy = matchSentDraft(draft, message);
      if (!matchedBy) continue;
      claimed.add(message.providerMessageId);
      plan.push({ draftId: draft.id, providerMessageId: message.providerMessageId, matchedBy });
      break;
    }
  }
  return plan;
}

/* ---------------------------------------------------------------- reading */

/** Read the verification stamp off a draft's rationale, if one is there. */
export function readDraftVerification(
  rationale: Record<string, unknown> | null | undefined,
): DraftVerification | null {
  const raw = rationale?.["verification"];
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value["state"] !== "mailbox_verified") return null;
  if (typeof value["provider_message_id"] !== "string" || !value["provider_message_id"]) {
    return null;
  }
  return {
    state: "mailbox_verified",
    providerMessageId: value["provider_message_id"],
    verifiedAt:
      typeof value["verified_at"] === "string" ? value["verified_at"] : new Date().toISOString(),
    matchedBy: Array.isArray(value["matched_by"]) ? value["matched_by"].map(String) : [],
  };
}

/** What the timeline says about a draft, in plain words. */
export function draftProvenanceLabel(
  reviewState: string,
  verification: DraftVerification | null,
): string {
  if (verification) return "Sent — seen in the mailbox";
  switch (reviewState) {
    case "sent":
      return "Marked as sent — not yet seen in the mailbox";
    case "approved":
      return "Approved, waiting to be sent";
    default:
      return "Prepared in Comms, not sent";
  }
}
