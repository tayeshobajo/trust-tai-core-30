/**
 * Reconciling a reply a person sent from Gmail, outside Trust Tai.
 *
 * Comms never sends by itself. A person may also decide to answer straight
 * from their mailbox, and when they do, the draft Comms prepared is no longer
 * owed: the work happened, it simply happened somewhere else. This module is
 * the deterministic rule that recognises that, from provider evidence only.
 *
 * It is deliberately stricter than mailbox verification of a draft a person
 * already marked sent. There, someone claimed a send and the mailbox merely
 * confirms it. Here nobody claimed anything, so the evidence has to carry the
 * whole weight:
 *
 *   - the observed message must be outbound and must come after the draft
 *     existed (small clock-skew allowance),
 *   - it must be addressed to the person the draft was written for,
 *   - it must sit on the draft's Gmail thread. Only when the draft carries no
 *     thread of its own may an exact subject match stand in, and only when
 *     nothing else could claim it.
 *
 * Ambiguity fails closed: if one draft could claim two messages, or one
 * message could settle two drafts, nothing is reconciled at all. A wrong
 * match would tell a person a reply was answered when it was not.
 *
 * Verification law is preserved, not collapsed. A reconciled draft is
 * EXECUTED and VERIFIED by provider evidence. It is never HUMAN ACCEPTED:
 * no one approved this text in Comms, and the words that went out were
 * whatever the person typed in Gmail.
 *
 * Pure and I/O-free, so the sync pass, the composer and the tests all read
 * the same rules.
 */

import type { ISODateTime } from "./entities";
import { normalizeSubject } from "./comms-verification";

/* ------------------------------------------------------------------ types */

/** Written onto `comms_drafts.rationale.external_send` when Gmail proves it. */
export interface ExternalSend {
  /** Executed and verified from the provider, never human accepted. */
  state: "sent_externally";
  providerMessageId: string;
  providerThreadId?: string;
  /** When the provider says the message actually went out. */
  sentAt: ISODateTime;
  reconciledAt: ISODateTime;
  /** Which signals carried the match, e.g. ["thread", "recipient"]. */
  matchedBy: string[];
}

/** The slice of an open (unsent) draft the matcher needs. */
export interface OpenDraftLike {
  id: string;
  subject?: string;
  /** When Comms prepared the draft. */
  createdAt: ISODateTime;
  /** The Gmail thread the draft was written for, when it has one. */
  providerThreadId?: string;
  /** The relationship's email address. Without it nothing is reconciled. */
  recipientEmail?: string;
}

/** The slice of an observed mailbox message the matcher needs. */
export interface ObservedOutboundLike {
  providerMessageId: string;
  providerThreadId?: string;
  direction: "inbound" | "outbound";
  occurredAt: ISODateTime;
  subject?: string;
  toEmails: string[];
  ccEmails: string[];
}

export interface ExternalReconciliation {
  draftId: string;
  providerMessageId: string;
  providerThreadId?: string;
  sentAt: ISODateTime;
  matchedBy: string[];
}

/* ------------------------------------------------------------- primitives */

/** A send can look a little older than the draft; clocks and edits differ. */
const SKEW_BEFORE_MS = 5 * 60 * 1000;
/** Beyond this the send is its own conversation, not this draft's answer. */
const WINDOW_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

function addressed(message: ObservedOutboundLike, recipient: string): boolean {
  const wanted = recipient.trim().toLowerCase();
  if (!wanted) return false;
  return [...message.toEmails, ...message.ccEmails].some(
    (entry) => entry.trim().toLowerCase() === wanted,
  );
}

/* --------------------------------------------------------------- matching */

/**
 * Whether one observed outbound message credibly settles one open draft.
 * Returns the signals that carried it, or null when the evidence is not
 * strong enough to say so.
 */
export function matchExternalSend(
  draft: OpenDraftLike,
  message: ObservedOutboundLike,
): string[] | null {
  if (message.direction !== "outbound") return null;
  if (!draft.recipientEmail) return null;

  const created = new Date(draft.createdAt).getTime();
  const sent = new Date(message.occurredAt).getTime();
  if (Number.isNaN(created) || Number.isNaN(sent)) return null;
  if (sent < created - SKEW_BEFORE_MS) return null;
  if (sent > created + WINDOW_AFTER_MS) return null;

  if (!addressed(message, draft.recipientEmail)) return null;

  // Strongest evidence: the provider's own thread identity.
  if (draft.providerThreadId) {
    if (!message.providerThreadId) return null;
    return draft.providerThreadId === message.providerThreadId
      ? ["thread", "recipient"]
      : null;
  }

  // Fallback, allowed only when the draft has no thread of its own: an exact
  // normalized subject match to the same person.
  const draftSubject = normalizeSubject(draft.subject);
  const messageSubject = normalizeSubject(message.subject);
  if (!draftSubject || !messageSubject) return null;
  return draftSubject === messageSubject ? ["subject", "recipient"] : null;
}

/**
 * Reconcile open drafts against observed outbound mail.
 *
 * Fail closed on ambiguity, in both directions: a draft that could be settled
 * by more than one message is left alone, and a message that could settle
 * more than one draft settles none of them. What survives is one draft, one
 * message, no other reading available.
 */
export function planExternalReconciliations(
  drafts: OpenDraftLike[],
  messages: ObservedOutboundLike[],
): ExternalReconciliation[] {
  const outbound = messages
    .filter((message) => message.direction === "outbound")
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));

  const candidates = new Map<string, { message: ObservedOutboundLike; matchedBy: string[] }[]>();
  const claimants = new Map<string, number>();

  for (const draft of drafts) {
    const matches: { message: ObservedOutboundLike; matchedBy: string[] }[] = [];
    for (const message of outbound) {
      const matchedBy = matchExternalSend(draft, message);
      if (!matchedBy) continue;
      matches.push({ message, matchedBy });
      claimants.set(
        message.providerMessageId,
        (claimants.get(message.providerMessageId) ?? 0) + 1,
      );
    }
    candidates.set(draft.id, matches);
  }

  const plan: ExternalReconciliation[] = [];
  for (const draft of drafts) {
    const matches = candidates.get(draft.id) ?? [];
    if (matches.length !== 1) continue; // none, or too many to be sure
    const only = matches[0]!;
    if ((claimants.get(only.message.providerMessageId) ?? 0) !== 1) continue;
    plan.push({
      draftId: draft.id,
      providerMessageId: only.message.providerMessageId,
      ...(only.message.providerThreadId ? { providerThreadId: only.message.providerThreadId } : {}),
      sentAt: only.message.occurredAt,
      matchedBy: only.matchedBy,
    });
  }
  return plan;
}

/* ------------------------------------------------------------- rationale IO */

/** Read the external-send stamp off a draft's rationale, if one is there. */
export function readExternalSend(
  rationale: Record<string, unknown> | null | undefined,
): ExternalSend | null {
  const raw = rationale?.["external_send"];
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value["state"] !== "sent_externally") return null;
  const providerMessageId = value["provider_message_id"];
  if (typeof providerMessageId !== "string" || !providerMessageId) return null;
  return {
    state: "sent_externally",
    providerMessageId,
    ...(typeof value["provider_thread_id"] === "string" && value["provider_thread_id"]
      ? { providerThreadId: value["provider_thread_id"] }
      : {}),
    sentAt: typeof value["sent_at"] === "string" ? value["sent_at"] : "",
    reconciledAt:
      typeof value["reconciled_at"] === "string"
        ? value["reconciled_at"]
        : new Date().toISOString(),
    matchedBy: Array.isArray(value["matched_by"]) ? value["matched_by"].map(String) : [],
  };
}

/** Merge an external-send stamp into a rationale. Nothing else is touched. */
export function writeExternalSend(
  rationale: Record<string, unknown> | null | undefined,
  record: ExternalSend,
): Record<string, unknown> {
  return {
    ...(rationale ?? {}),
    external_send: {
      state: record.state,
      provider_message_id: record.providerMessageId,
      ...(record.providerThreadId ? { provider_thread_id: record.providerThreadId } : {}),
      sent_at: record.sentAt,
      reconciled_at: record.reconciledAt,
      matched_by: record.matchedBy,
    },
  };
}

/** What a person reads on a reconciled draft. Plain, and honest about limits. */
export const EXTERNAL_SEND_LABEL = "Replied from Gmail, seen in the mailbox";

/** Why Comms will not send this draft now. */
export const EXTERNAL_SEND_REFUSAL =
  "You already replied to this person from Gmail, and Comms can see that message in the mailbox. This draft is closed so it cannot go out twice.";
