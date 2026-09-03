/**
 * Synced mailbox messages, read for the relationship timeline.
 *
 * `comms_messages` is written only by the server-side sync and the send path
 * (member token or the scheduled service pass) and read here under the
 * member's own session, so RLS keeps the organization boundary. A workspace
 * whose integration tables are not applied yet reads as an empty timeline,
 * never an error dressed up as data, and a schema that predates the newer
 * columns degrades one variant at a time (body_html, body_text,
 * attachments), the same tolerance the sync write path keeps.
 *
 * The body columns are what the timeline actually shows: `body_text` /
 * `body_html` hold the meaningful email, `snippet` stays Gmail's short
 * preview for lists. Inline MIME images live in `attachments` marked
 * `inline` with a `content_id`; ordinary files are chips and downloads.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import {
  attachmentMetaFromJson,
  mailboxFromProvenance,
  type AttachmentMeta,
  type StoredMailboxMessage,
} from "@/domain/comms-integrations";

const BASE_COLUMNS =
  "id, organization_id, relationship_id, thread_id, provider_message_id, provider_thread_id, direction, from_email, from_name, subject, snippet, occurred_at, provenance";

/**
 * Column variants, richest first. Each fallback answers one missing column
 * from an older schema; a workspace midway through migrations still reads.
 */
const COLUMN_VARIANTS = [
  `${BASE_COLUMNS}, body_text, body_html, attachments`,
  `${BASE_COLUMNS}, body_text, attachments`,
  `${BASE_COLUMNS}, attachments`,
  BASE_COLUMNS,
] as const;

/** Exported for the focused provenance-mapping test. */
export interface MessageRow {
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
  body_text?: string | null;
  body_html?: string | null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function attachments(value: unknown): AttachmentMeta[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((entry) => attachmentMetaFromJson(entry))
    .filter((entry): entry is AttachmentMeta => entry !== null);
  return out.length > 0 ? out : undefined;
}

/** Exported for the focused provenance-mapping test. */
export function toMessage(row: MessageRow): StoredMailboxMessage {
  const files = attachments(row.attachments);
  const provenance =
    row.provenance && typeof row.provenance === "object"
      ? (row.provenance as Record<string, unknown>)
      : null;
  // Transport identity is carried in provenance and only in provenance.
  // Synced Gmail mail and Comms-sent rows both stamp it server-side; a row
  // without it gets no mailbox, we never infer one.
  const mailbox = mailboxFromProvenance(row.provenance);
  const blockedRemoteImages =
    typeof provenance?.["blocked_remote_images"] === "number"
      ? (provenance["blocked_remote_images"] as number)
      : undefined;
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
    ...(text(row.body_text) ? { bodyText: text(row.body_text)! } : {}),
    ...(text(row.body_html) ? { bodyHtml: row.body_html! } : {}),
    occurredAt: row.occurred_at,
    ...(files ? { attachments: files } : {}),
    ...(blockedRemoteImages !== undefined ? { blockedRemoteImages } : {}),
    ...(provenance?.["source"] === "gmail-send" ? { sentViaComms: true } : {}),
    ...(mailbox ? { mailbox } : {}),
  };
}

function notProvisioned(message: string): boolean {
  return /relation.*comms_messages.* does not exist|could not find the table|schema cache/i.test(
    message,
  );
}

/** Which newer column a schema error names, so the retry can shed exactly it. */
function missingColumn(message: string): string | null {
  for (const column of ["body_html", "body_text", "attachments"]) {
    if (new RegExp(column, "i").test(message)) return column;
  }
  return null;
}

/** Every synced message for one relationship, oldest first. */
export async function listRelationshipMessages(
  organizationId: ID,
  relationshipId: ID,
  limit = 200,
): Promise<StoredMailboxMessage[]> {
  let data: MessageRow[] | null = null;
  let index = 0;

  for (; index < COLUMN_VARIANTS.length; index += 1) {
    const result = await supabase
      .from("comms_messages")
      .select(COLUMN_VARIANTS[index]!)
      .eq("organization_id", organizationId)
      .eq("relationship_id", relationshipId)
      .order("occurred_at", { ascending: true })
      .limit(limit);

    if (!result.error) {
      data = result.data as unknown as MessageRow[];
      break;
    }
    if (notProvisioned(result.error.message)) return [];
    // A schema error naming a newer column sheds exactly that column and
    // retries; anything else is a real failure.
    const missing = missingColumn(result.error.message);
    if (missing && COLUMN_VARIANTS[index]!.includes(missing)) continue;
    throw new Error(result.error.message);
  }

  return ((data ?? []) as MessageRow[]).map(toMessage);
}
