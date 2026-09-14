/**
 * What would actually leave, built once, in one place.
 *
 * Approval, the send gate and every dispatch path have to agree to the
 * character on what the outbound message is, or an approval means nothing.
 * They all build it here, from the draft on record, so none of them can
 * quietly normalise a subject, drop a cc or describe an attachment
 * differently from the others.
 *
 * Attachments are identified by their immutable storage path, not by name and
 * length: a replacement file of the same size lands at a different path and
 * therefore invalidates the approval, which is the point. Where the bytes are
 * already in hand (Gmail dispatch downloads them to build the MIME message),
 * the real content digest is used and is compared against the path identity
 * the approval carried.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DeliveryChannel, OutboundAttachment, OutboundPayload } from "@/domain/comms-delivery";
import { readOutgoingAttachments, readOutgoingExtras } from "@/domain/comms-outgoing";
import { sha256, sha256Bytes } from "@/domain/sha256";

export interface DraftForSend {
  id: string;
  subject: string | null;
  body: string;
  relationshipId: string;
  rationale: Record<string, unknown> | null;
}

/** The identity of one staged file, as approval and dispatch both read it. */
export function attachmentIdentity(file: {
  filename: string;
  mimeType: string;
  size: number;
  path: string;
}): OutboundAttachment {
  return {
    name: file.filename,
    mimeType: file.mimeType,
    bytes: file.size,
    digest: `path:${sha256(file.path)}`,
  };
}

/** The identity of one file whose bytes are in hand. */
export function attachmentContentIdentity(file: {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}): OutboundAttachment {
  return {
    name: file.filename,
    mimeType: file.mimeType,
    bytes: file.bytes.length,
    digest: `sha256:${sha256Bytes(file.bytes)}`,
  };
}

export class OutboundPayloadUnavailable extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OutboundPayloadUnavailable";
  }
}

/** Read the draft the caller is allowed to read. Never a service client. */
export async function loadDraftForSend(
  client: SupabaseClient,
  organizationId: string,
  draftId: string,
): Promise<DraftForSend> {
  const { data, error } = await client
    .from("comms_drafts")
    .select("id, subject, body, relationship_id, rationale")
    .eq("id", draftId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    throw new OutboundPayloadUnavailable("unreadable", "That draft could not be read.");
  }
  const row = (data ?? null) as Record<string, unknown> | null;
  if (!row) throw new OutboundPayloadUnavailable("not_found", "That draft is not on record.");
  return {
    id: String(row["id"]),
    subject: typeof row["subject"] === "string" ? row["subject"] : null,
    body: typeof row["body"] === "string" ? row["body"] : "",
    relationshipId: String(row["relationship_id"] ?? ""),
    rationale: (row["rationale"] as Record<string, unknown> | null) ?? null,
  };
}

/** The recipient of record for a draft, or an honest refusal. */
export async function recipientForDraft(
  client: SupabaseClient,
  organizationId: string,
  relationshipId: string,
): Promise<string> {
  const { data, error } = await client
    .from("comms_relationships")
    .select("id, email")
    .eq("id", relationshipId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    throw new OutboundPayloadUnavailable(
      "unreadable",
      "The person this message is for could not be read, so nothing was sent.",
    );
  }
  const email = (data as { email?: string | null } | null)?.email ?? null;
  if (!email) {
    throw new OutboundPayloadUnavailable(
      "no_recipient",
      "This person has no email address on record, so nothing was sent.",
    );
  }
  return email;
}

/**
 * The whole outbound message for a draft, as it would be handed to a
 * provider. Approval calls this; so does every dispatch path.
 */
export async function outboundPayloadForDraft(
  client: SupabaseClient,
  input: {
    organizationId: string;
    draft: DraftForSend;
    channel: DeliveryChannel;
    senderIdentity: string | null;
    /** Gmail resolves the real subject from the thread; pass it when known. */
    subject?: string | null;
    recipient?: string;
    /** Supplied when the bytes are already in hand. */
    attachments?: OutboundAttachment[];
  },
): Promise<OutboundPayload> {
  const recipient =
    input.recipient ??
    (await recipientForDraft(client, input.organizationId, input.draft.relationshipId));
  const extras = readOutgoingExtras(input.draft.rationale);
  const attachments =
    input.attachments ?? readOutgoingAttachments(input.draft.rationale).map(attachmentIdentity);
  return {
    channel: input.channel,
    subject: input.subject === undefined ? input.draft.subject : input.subject,
    body: input.draft.body,
    recipient,
    senderIdentity: input.senderIdentity,
    attachments,
    cc: extras.cc,
    bcc: extras.bcc,
  };
}
