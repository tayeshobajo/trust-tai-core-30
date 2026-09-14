/**
 * One decision, for every way a message can leave this building.
 *
 * Comms can dispatch through four doors: Gmail, the Resend path behind the
 * queue and Scout outreach, a LinkedIn message a person sends by hand, and
 * anything scheduled later. Before this module each door had its own idea of
 * what "approved" meant, and the weakest one won: a browser could write
 * `review_state = 'approved'` on a draft and a provider call followed.
 *
 * So the rule is stated once, here, in one function, and every door asks it:
 *
 *   a message may go out only when a completed review of exactly these words
 *   was approved by somebody allowed to approve, the context and voice behind
 *   that review have not moved, the payload about to be handed to the
 *   provider is byte-for-byte the payload that was approved, and nothing is
 *   left blocking.
 *
 * Nothing here reads a database and nothing here calls a provider. It decides,
 * and it explains itself in words the person pressing Send can act on.
 */

import { sourceChecksum } from "@/domain/comms-sources";

/* ------------------------------------------------------------- the payload */

export type DeliveryChannel = "email_gmail" | "email_resend" | "linkedin_manual";

/**
 * Exactly what would leave. Every field is part of the approval: changing the
 * recipient, the channel, the sending identity or a single attachment makes
 * this a different message from the one a person said yes to.
 */
export interface OutboundPayload {
  channel: DeliveryChannel;
  subject: string | null;
  body: string;
  recipient: string;
  /** The identity it goes out as — a mailbox, a profile, never an assumption. */
  senderIdentity: string | null;
  /** Names and sizes of anything attached, order-independent. */
  attachments: { name: string; bytes: number }[];
}

/** A stable stand-in for "this exact message, out of this exact door". */
export function outboundFingerprint(payload: OutboundPayload): string {
  const attachments = payload.attachments
    .map((file) => `${file.name.trim()}:${file.bytes}`)
    .sort()
    .join("|");
  return sourceChecksum(
    [
      payload.channel,
      (payload.subject ?? "").trim(),
      payload.body.trim(),
      payload.recipient.trim().toLowerCase(),
      (payload.senderIdentity ?? "").trim().toLowerCase(),
      attachments,
    ].join("\u0000"),
  );
}

/* ------------------------------------------------------------ the decision */

export type SendRefusal =
  | "capability_missing"
  | "no_review"
  | "review_incomplete"
  | "not_approved"
  | "payload_changed"
  | "stale_context"
  | "blocked"
  | "not_authorised";

export type SendDecision =
  | { allowed: true; approvalId: string; runId: string; versionId: string; fingerprint: string }
  | { allowed: false; code: SendRefusal; message: string; blockers: string[] };

export interface SendDecisionInput {
  /** Empty when the database can answer every question this rule asks. */
  missingCapability: string[];
  /** The approval on record for this draft, if any. */
  approval: {
    id: string;
    runId: string;
    versionId: string;
    approvedPayloadFingerprint: string;
    contextRevision: number | null;
    contextFingerprint: string;
  } | null;
  /** The run that approval was given against. */
  run: { id: string; status: string; contextRevision: number | null } | null;
  /** What the review says is still outstanding, in the reviewer's words. */
  blockers: string[];
  /** The situation as it stands right now. */
  currentContextRevision: number | null;
  currentContextFingerprint: string;
  /** The payload the caller is actually about to hand the provider. */
  payloadFingerprint: string;
  /** Whether the person pressing Send may send in this workspace. */
  callerMaySend: boolean;
}

const MIGRATION = "docs/migrations/proposed/20260914170000_comms_review_delivery.sql";

/**
 * The whole rule. Every refusal says what is wrong and what would fix it; no
 * refusal is ever a silent `false`, because a person is standing there waiting
 * to send something they believe is ready.
 */
export function decideSend(input: SendDecisionInput): SendDecision {
  if (input.missingCapability.length > 0) {
    return {
      allowed: false,
      code: "capability_missing",
      message:
        "Sending is held because this workspace cannot yet prove which review approved which message. Nothing was sent and nothing was changed. Applying the pending database change (" +
        MIGRATION +
        ") turns this back on.",
      blockers: input.missingCapability,
    };
  }
  if (!input.callerMaySend) {
    return {
      allowed: false,
      code: "not_authorised",
      message: "You are not able to send from this workspace. Nothing was sent.",
      blockers: ["The person sending must be an owner or an admin here."],
    };
  }
  if (!input.approval) {
    return {
      allowed: false,
      code: "no_review",
      message:
        "This message has not been reviewed and approved, so nothing was sent. Run the review, clear what it raises, then approve it.",
      blockers: ["No approval is on record for this draft."],
    };
  }
  if (!input.run || input.run.id !== input.approval.runId) {
    return {
      allowed: false,
      code: "review_incomplete",
      message:
        "The review this approval was given against is no longer on record, so nothing was sent. Review it again.",
      blockers: ["The approved review run could not be found."],
    };
  }
  if (input.run.status !== "complete") {
    return {
      allowed: false,
      code: "review_incomplete",
      message:
        "The review behind this approval never finished, so nothing was sent. Run it again and approve the result.",
      blockers: [`The review is recorded as ${input.run.status}, not complete.`],
    };
  }
  if (input.approval.approvedPayloadFingerprint !== input.payloadFingerprint) {
    return {
      allowed: false,
      code: "payload_changed",
      message:
        "What would go out is not what was approved — the words, the recipient, the sending identity, the attachments or the channel have changed. Nothing was sent. Review and approve it as it now stands.",
      blockers: ["The message about to be sent differs from the approved one."],
    };
  }
  if (input.approval.contextFingerprint !== input.currentContextFingerprint) {
    return {
      allowed: false,
      code: "stale_context",
      message:
        "Something behind this message moved after it was approved — the goal, the situation, the material or the voice rules. Nothing was sent. Review it again.",
      blockers: ["The approval covers an earlier version of the situation."],
    };
  }
  if (
    input.currentContextRevision !== null &&
    input.approval.contextRevision !== null &&
    input.approval.contextRevision !== input.currentContextRevision
  ) {
    return {
      allowed: false,
      code: "stale_context",
      message:
        "This message was approved before its latest edit. Nothing was sent. Review it again.",
      blockers: ["The approval covers an earlier revision of this conversation."],
    };
  }
  if (input.blockers.length > 0) {
    return {
      allowed: false,
      code: "blocked",
      message: "The review still has something standing, so nothing was sent.",
      blockers: input.blockers,
    };
  }
  return {
    allowed: true,
    approvalId: input.approval.id,
    runId: input.approval.runId,
    versionId: input.approval.versionId,
    fingerprint: input.payloadFingerprint,
  };
}

/* ------------------------------------------------------------- the attempt */

export type DeliveryState = "attempting" | "sent" | "failed" | "unknown";

/** One key per approved payload, so a retry is the same attempt, not a second one. */
export function deliveryKey(draftId: string, fingerprint: string): string {
  return `delivery:${draftId}:${fingerprint}`;
}

/**
 * What to say after a provider call, including the case everyone forgets: the
 * provider may have accepted the message while the answer was lost on the way
 * back. That is not a failure and must never be retried automatically — a
 * person has to look.
 */
export function describeDelivery(state: DeliveryState, channel: DeliveryChannel): string {
  if (state === "sent") {
    return channel === "linkedin_manual"
      ? "Recorded as sent by hand on LinkedIn. This is your word that you sent it, not a confirmation from LinkedIn."
      : "Sent, and the provider confirmed it.";
  }
  if (state === "failed") return "Not sent. The provider refused it, and nothing went out.";
  if (state === "unknown") {
    return "This may have gone out. The provider was asked and the answer never came back, so it cannot be confirmed either way. Check the recipient's thread before trying again — it will not be retried on its own.";
  }
  return "In progress.";
}
