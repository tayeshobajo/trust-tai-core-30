/**
 * Synced mailbox messages, read for the relationship timeline.
 *
 * `comms_messages` is written only by the server-side sync and the send path
 * (member token or the scheduled service pass) and read here under the
 * member's own session, so RLS keeps the organization boundary. A workspace
 * whose integration tables are not applied yet reads as an empty timeline,
 * never an error dressed up as data — and a schema that predates the
 * attachments column degrades to metadata-free reading, the same tolerance
 * the sync write path keeps.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type { AttachmentMeta, StoredMailboxMessage } from "@/domain/comms-integrations";

const COLUMNS =
  "id, organization_id, relationship_id, thread_id, provider_message_id, provider_thread_id, direction, from_email, from_name, subject, snippet, occurred_at, provenance, attachments";
const COLUMNS_WITHOUT_ATTACHMENTS =
  "id, organization_id, relationship_id, thread_id, provider_message_id, provider_thread_id, direction, from_email, from_name, subject, snippet, occurred_at, provenance";

interface MessageRow {
  id: string;
  organization_id: string;
  relationship_id: string;
  thread_id: string | null;
  provider_message_id: string | null;
  provider_thread_id: string | null;
  direction: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  occurred_at: string;
  provenance?: unknown;
  attachments?: unknown;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function attachments(value: unknown): AttachmentMeta[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: AttachmentMeta[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const filename = text(raw["filename"]);
    if (!filename) continue;
    out.push({
      filename,
      mimeType: text(raw["mime_type"]) ?? "application/octet-stream",
      size: typeof raw["size"] === "number" ? raw["size"] : 0,
      ...(text(raw["attachment_id"]) ? { attachmentId: text(raw["attachment_id"])! } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

function toMessage(row: MessageRow): StoredMailboxMessage {
  const files = attachments(row.attachments);
  const provenance =
    row.provenance && typeof row.provenance === "object"
      ? (row.provenance as Record<string, unknown>)
      : null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    relationshipId: row.relationship_id,
    ...(row.thread_id ? { threadId: row.thread_id } : {}),
    ...(text(row.provider_message_id) ? { providerMessageId: text(row.provider_message_id)! } : {}),
    ...(text(row.provider_thread_id) ? { providerThreadId: text(row.provider_thread_id)! } : {}),
    direction: row.direction === "outbound" ? "outbound" : "inbound",
    ...(text(row.from_email) ? { fromEmail: text(row.from_email)! } : {}),
    ...(text(row.from_name) ? { fromName: text(row.from_name)! } : {}),
    ...(text(row.subject) ? { subject: text(row.subject)! } : {}),
    ...(text(row.snippet) ? { snippet: text(row.snippet)! } : {}),
    occurredAt: row.occurred_at,
    ...(files ? { attachments: files } : {}),
    ...(provenance?.["source"] === "gmail-send" ? { sentViaComms: true } : {}),
  };
}

function notProvisioned(message: string): boolean {
  return /relation .*comms_messages.* does not exist|could not find the table|schema cache/i.test(
    message,
  );
}

/** Every synced message for one relationship, oldest first. */
export async function listRelationshipMessages(
  organizationId: ID,
  relationshipId: ID,
  limit = 200,
): Promise<StoredMailboxMessage[]> {
  let { data, error } = await supabase
    .from("comms_messages")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .eq("relationship_id", relationshipId)
    .order("occurred_at", { ascending: true })
    .limit(limit);

  // A schema that predates the attachments column still reads, minus files.
  if (error && /attachments/i.test(error.message)) {
    const fallback = await supabase
      .from("comms_messages")
      .select(COLUMNS_WITHOUT_ATTACHMENTS)
      .eq("organization_id", organizationId)
      .eq("relationship_id", relationshipId)
      .order("occurred_at", { ascending: true })
      .limit(limit));
    data = fallback.data as typeof data;
    error = fallback.error;
  }

  if (error) {
    if (notProvisioned(error.message)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as unknown as MessageRow[]).map(toMessage);
}
