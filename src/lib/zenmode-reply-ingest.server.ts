/**
 * ZenMode reply ingestion + webhook signature — server only.
 *
 * ZenMode (transport) posts a `lead.replied` webhook. This module holds the
 * two pure, testable pieces the `zenmode-webhook` edge function ports:
 *
 *   1. `verifyZenModeSignature` — constant-time HMAC-SHA256 verification of
 *      the RAW request body against the ZenMode-issued webhook secret
 *      (header X-ZenMode-Signature, hex-encoded). A bad signature is a 401 at
 *      the edge; nothing downstream runs.
 *   2. `ingestZenModeReply` — maps a `lead.replied` payload onto the SAME
 *      `LinkedInReplyObserved` landing contract Linki uses and hands it to the
 *      one lawful ingest seam (`ingestLinkedInReply`, channel='linkedin').
 *      ZenMode's ids (lead_id, campaign_id) ride as provenance only, never
 *      identity — the seam still resolves onto a human-confirmed contact or
 *      queues for a person. Nothing here auto-creates a contact.
 *
 * Idempotency: ZenMode may deliver the same webhook twice (no transition
 * guard). The dedupe key is `lead_id + replied_at`, carried as the landing
 * row's `external_message_ref`; redelivery is absorbed by the unique
 * (source, external_message_ref) constraint as a no-op `duplicate`.
 *
 * Feature-gated OFF behind `ZENMODE_REPLY_INGESTION_ENABLED` (default false),
 * exactly like `LINKI_REPLY_INGESTION_ENABLED`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ingestLinkedInReply,
  type LinkedInReplyObserved,
  type LinkiReplyIngestResult,
} from "@/lib/linki-reply-ingest.server";

export const ZENMODE_REPLY_SOURCE = "zenmode" as const;

/**
 * The `lead.replied` webhook payload, as ZenMode delivers it.
 *
 * NOTE ON WIRE TYPES: ZenMode sends `lead_id` and `campaign_id` as JSON
 * NUMBERS (`"lead_id": 37110, "campaign_id": 42`), not strings. Treating them
 * as strings rejects every real reply, so both are accepted as `string |
 * number` and normalized through `refOf` before use.
 */
export interface ZenModeLeadRepliedPayload {
  lead_id: string | number;
  campaign_id?: string | number | null;
  name?: string | null;
  linkedin_url?: string | null;
  replied_at: string;
  /** Both reply fields are nullable on the wire. */
  reply_text?: string | null;
  reply_subject?: string | null;
}

/**
 * The ZenMode webhook envelope: the event fields live under `data`, NOT at the
 * top level. Reading the envelope as the payload silently loses every field.
 */
export interface ZenModeWebhookEnvelope<T = unknown> {
  event?: string;
  data?: T;
  timestamp?: string;
}

/**
 * Normalize a transport id to its string form. Numeric ids stringify; blank,
 * null and non-finite values become "" so callers fail closed on a missing id.
 */
export function refOf(value: string | number | null | undefined): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return value.trim();
  return "";
}

/**
 * Unwrap the webhook envelope. Accepts the enveloped form and a bare payload
 * (older deliveries / hand-made test posts) so neither shape is silently lost.
 */
export function unwrapZenModeEnvelope<T>(body: ZenModeWebhookEnvelope<T> | T): T {
  const envelope = body as ZenModeWebhookEnvelope<T>;
  if (envelope && typeof envelope === "object" && "data" in envelope) {
    const inner = envelope.data;
    if (inner && typeof inner === "object") return inner;
  }
  return body as T;
}

export interface ZenModeReplyIngestEnv {
  ZENMODE_REPLY_INGESTION_ENABLED?: string | undefined;
  /** Passed through to the shared Linki ingest seam's own gate. */
  LINKI_REPLY_INGESTION_ENABLED?: string | undefined;
}

/**
 * Verify an X-ZenMode-Signature header: hex HMAC-SHA256 of the RAW body with
 * the webhook secret. Constant-time. Any missing/malformed input is a
 * rejection (fail closed) rather than a throw, so the caller answers 401.
 */
export function verifyZenModeSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  if (!secret || !signatureHeader) return false;
  const provided = signatureHeader.trim().toLowerCase().replace(/^sha256=/, "");
  if (!/^[0-9a-f]+$/.test(provided)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The idempotency key for a reply: `lead_id + replied_at`. */
export function zenModeReplyDedupeRef(payload: {
  lead_id: string | number;
  replied_at: string;
}): string {
  return `${refOf(payload.lead_id)}:${payload.replied_at.trim()}`;
}

/**
 * Map a `lead.replied` payload onto the shared landing contract. Body falls
 * back through reply_text → reply_subject → an explicit "no text" sentinel so
 * a text-less reply is still recorded as a reply (the seam requires a body);
 * the full payload is kept verbatim under `payload` for audit.
 */
export function mapLeadReplied(
  payload: ZenModeLeadRepliedPayload,
  organizationId: string,
): LinkedInReplyObserved {
  const body =
    (typeof payload.reply_text === "string" && payload.reply_text.trim()) ||
    (typeof payload.reply_subject === "string" && payload.reply_subject.trim()) ||
    "(reply received; ZenMode provided no text)";
  const dedupeRef = zenModeReplyDedupeRef(payload);
  return {
    organizationId,
    source: ZENMODE_REPLY_SOURCE,
    // ZenMode has no separate thread id; the lead IS the conversation.
    externalThreadRef: refOf(payload.lead_id),
    externalMessageRef: dedupeRef,
    senderLinkedinUrl: payload.linkedin_url?.trim() || undefined,
    senderName: payload.name?.trim() || undefined,
    body,
    // campaign_id is transport provenance, carried into the audit payload.
    observedAt: payload.replied_at,
    payload: {
      transport: "zenmode",
      lead_id: refOf(payload.lead_id),
      campaign_id: payload.campaign_id == null ? null : refOf(payload.campaign_id),
      replied_at: payload.replied_at,
      reply_text: payload.reply_text ?? null,
      reply_subject: payload.reply_subject ?? null,
    },
  };
}

/**
 * Ingest one `lead.replied` webhook. Validates the payload, then hands the
 * mapped observation to the SAME lawful ingest seam Linki uses. Idempotent,
 * fail-closed, inert until the flag says otherwise.
 */
export async function ingestZenModeReply(
  client: SupabaseClient,
  payload: ZenModeLeadRepliedPayload,
  organizationId: string,
  env: ZenModeReplyIngestEnv = process.env,
): Promise<LinkiReplyIngestResult> {
  if (env["ZENMODE_REPLY_INGESTION_ENABLED"] !== "true") return { status: "disabled" };
  if (!refOf(payload.lead_id)) throw new Error("A ZenMode reply needs a lead_id.");
  if (!payload.replied_at?.trim()) throw new Error("A ZenMode reply needs replied_at.");

  const observed = mapLeadReplied(payload, organizationId);
  // The shared seam has its own LINKI_REPLY_INGESTION_ENABLED gate; force it
  // on for the delegated call, having already cleared the ZenMode gate above.
  return ingestLinkedInReply(client, observed, {
    LINKI_REPLY_INGESTION_ENABLED: "true",
  });
}
