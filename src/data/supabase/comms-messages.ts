/**
 * Synced mailbox messages, read for the relationship timeline.
 *
 * `comms_messages` is written only by the server-side sync (member token or
 * the scheduled service pass) and read here under the member's own session,
 * so RLS keeps the organization boundary. A workspace whose integration
 * tables are not applied yet reads as an empty timeline, never an error
 * dressed up as data.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type { StoredMailboxMessage } from "@/domain/comms-integrations";

const COLUMNS =
  "id, organization_id, relationship_id, direction, from_email, from_name, subject, snippet, occurred_at";

interface MessageRow {
  id: string;
  organization_id: string;
  relationship_id: string;
  direction: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  occurred_at: string;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function toMessage(row: MessageRow): StoredMailboxMessage {
  return {
    id: row.id,
    organizationId: row.organization_id,
    relationshipId: row.relationship_id,
    direction: row.direction === "outbound" ? "outbound" : "inbound",
    ...(text(row.from_email) ? { fromEmail: text(row.from_email)! } : {}),
    ...(text(row.from_name) ? { fromName: text(row.from_name)! } : {}),
    ...(text(row.subject) ? { subject: text(row.subject)! } : {}),
    ...(text(row.snippet) ? { snippet: text(row.snippet)! } : {}),
    occurredAt: row.occurred_at,
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
  const { data, error } = await supabase
    .from("comms_messages")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .eq("relationship_id", relationshipId)
    .order("occurred_at", { ascending: true })
    .limit(limit);

  if (error) {
    if (notProvisioned(error.message)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as unknown as MessageRow[]).map(toMessage);
}
