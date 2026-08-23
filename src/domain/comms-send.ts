/**
 * The send state machine.
 *
 * attempted != executed != verified != human accepted
 *
 * A draft moves draft → sending → sent, and the mailbox still has the last
 * word through verification (`comms-verification`). A refusal lands in
 * `send_failed` with the reason kept — never as sent. Approving and sending
 * are one human act: pressing Send on a draft is the approval.
 *
 * The claim is the idempotency mechanism. Only the first attempt can move a
 * draft out of a sendable state (`sending`), one draft carries one stable
 * idempotency key, and a send that already succeeded replays its recorded
 * result instead of ever sending twice. A claim that sits in `sending`
 * longer than the stale window died mid-flight and may be reclaimed.
 *
 * Pure and I/O-free: the server module applies these rules, tests pin them.
 */

import type { AttachmentMeta } from "./comms-integrations";
import type { DraftReviewState } from "./comms";
import type { ISODateTime } from "./entities";

/** Where a message goes: continue the Gmail thread, or open a new one. */
export type SendThreadTarget = { mode: "reply"; providerThreadId: string } | { mode: "new" };

export type SendPhase = "sending" | "sent" | "failed";

/** The send attempt's record, written onto the draft's rationale. */
export interface DraftSend {
  state: SendPhase;
  idempotencyKey: string;
  attemptedAt: ISODateTime;
  sentAt?: ISODateTime;
  providerMessageId?: string;
  providerThreadId?: string;
  threadTarget?: SendThreadTarget;
  attachments?: AttachmentMeta[];
  error?: string;
  requiredScope?: string;
}

/** Review states a send may claim from. Approving and sending are one act. */
export const SENDABLE_STATES: DraftReviewState[] = [
  "draft",
  "needs_human_review",
  "approved",
  "send_failed",
];

/** A claim this old with no outcome means the attempt died mid-flight. */
export const STALE_SENDING_MS = 10 * 60 * 1000;

/** One stable key per draft: a retried send of the same draft never doubles. */
export function sendIdempotencyKey(draftId: string): string {
  return `send:${draftId}`;
}

/* ---------------------------------------------------------- rationale IO */

function targetToJson(target: SendThreadTarget): Record<string, unknown> {
  return target.mode === "reply"
    ? { mode: "reply", provider_thread_id: target.providerThreadId }
    : { mode: "new" };
}

function targetFromJson(raw: unknown): SendThreadTarget | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  if (value["mode"] === "reply" && typeof value["provider_thread_id"] === "string") {
    return { mode: "reply", providerThreadId: value["provider_thread_id"] };
  }
  if (value["mode"] === "new") return { mode: "new" };
  return undefined;
}

function attachmentsToJson(attachments: AttachmentMeta[]): Record<string, unknown>[] {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    mime_type: attachment.mimeType,
    size: attachment.size,
    ...(attachment.attachmentId ? { attachment_id: attachment.attachmentId } : {}),
  }));
}

function attachmentsFromJson(raw: unknown): AttachmentMeta[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AttachmentMeta[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    const filename = typeof value["filename"] === "string" ? value["filename"] : "";
    if (!filename) continue;
    out.push({
      filename,
      mimeType: typeof value["mime_type"] === "string" ? value["mime_type"] : "application/octet-stream",
      size: typeof value["size"] === "number" ? value["size"] : 0,
      ...(typeof value["attachment_id"] === "string" ? { attachmentId: value["attachment_id"] } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

/** Read the send record off a draft's rationale, if one is there. */
export function readDraftSend(
  rationale: Record<string, unknown> | null | undefined,
): DraftSend | null {
  const raw = rationale?.["send"];
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const state = value["state"];
  if (state !== "sending" && state !== "sent" && state !== "failed") return null;
  if (typeof value["idempotency_key"] !== "string" || !value["idempotency_key"]) return null;
  const attachments = attachmentsFromJson(value["attachments"]);
  const threadTarget = targetFromJson(value["thread_target"]);
  return {
    state,
    idempotencyKey: value["idempotency_key"],
    attemptedAt:
      typeof value["attempted_at"] === "string"
        ? value["attempted_at"]
        : new Date().toISOString(),
    ...(typeof value["sent_at"] === "string" ? { sentAt: value["sent_at"] } : {}),
    ...(typeof value["provider_message_id"] === "string"
      ? { providerMessageId: value["provider_message_id"] }
      : {}),
    ...(typeof value["provider_thread_id"] === "string"
      ? { providerThreadId: value["provider_thread_id"] }
      : {}),
    ...(threadTarget ? { threadTarget } : {}),
    ...(attachments ? { attachments } : {}),
    ...(typeof value["error"] === "string" ? { error: value["error"] } : {}),
    ...(typeof value["required_scope"] === "string"
      ? { requiredScope: value["required_scope"] }
      : {}),
  };
}

/** Merge a send record into a draft's rationale. Nothing else is touched. */
export function writeDraftSend(
  rationale: Record<string, unknown> | null | undefined,
  send: DraftSend,
): Record<string, unknown> {
  return {
    ...(rationale ?? {}),
    send: {
      state: send.state,
      idempotency_key: send.idempotencyKey,
      attempted_at: send.attemptedAt,
      ...(send.sentAt ? { sent_at: send.sentAt } : {}),
      ...(send.providerMessageId ? { provider_message_id: send.providerMessageId } : {}),
      ...(send.providerThreadId ? { provider_thread_id: send.providerThreadId } : {}),
      ...(send.threadTarget ? { thread_target: targetToJson(send.threadTarget) } : {}),
      ...(send.attachments?.length ? { attachments: attachmentsToJson(send.attachments) } : {}),
      ...(send.error ? { error: send.error } : {}),
      ...(send.requiredScope ? { required_scope: send.requiredScope } : {}),
    },
  };
}

/* -------------------------------------------------------------- decisions */

export type SendClaimDecision =
  | { kind: "claim" }
  | { kind: "replay"; send: DraftSend }
  | { kind: "in_flight" }
  | { kind: "not_sendable"; reason: string };

/**
 * What a send attempt should do with this draft. The server still claims with
 * a conditional update — this decides how to read the outcome, and how to
 * answer a retried click without sending twice.
 */
export function decideSendClaim(
  draft: {
    reviewState: string;
    rationale?: Record<string, unknown> | null;
    updatedAt?: string;
  },
  now: Date = new Date(),
): SendClaimDecision {
  const send = readDraftSend(draft.rationale);

  // Gmail already accepted this draft: answer with the recorded result.
  if (draft.reviewState === "sent" && send?.state === "sent" && send.providerMessageId) {
    return { kind: "replay", send };
  }

  if (draft.reviewState === "sending") {
    const stale =
      draft.updatedAt !== undefined &&
      !Number.isNaN(new Date(draft.updatedAt).getTime()) &&
      now.getTime() - new Date(draft.updatedAt).getTime() > STALE_SENDING_MS;
    return stale ? { kind: "claim" } : { kind: "in_flight" };
  }

  if ((SENDABLE_STATES as string[]).includes(draft.reviewState)) return { kind: "claim" };

  if (draft.reviewState === "sent") {
    return {
      kind: "not_sendable",
      reason: "This message was already marked as sent, so Comms will not send it again.",
    };
  }
  return { kind: "not_sendable", reason: "This draft was discarded." };
}
