/**
 * What the Comms dashboard reads and writes.
 *
 * Reads: every relationship in the workspace, and the recent synced messages
 * across all of them, so one screen can honestly say who wrote last.
 *
 * Writes: only two human acts — opening a conversation (which is what "read"
 * means here) and closing or reopening it. Both land on the relationship's
 * metadata, so no new table and no invented state.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import { commsService } from "@/data/supabase/comms-service";
import { toMessage, type MessageRow } from "@/data/supabase/comms-messages";
import type { Relationship } from "@/domain/comms";
import { CLOSED_AT_KEY, READ_AT_KEY } from "@/domain/comms-dashboard";
import type { StoredMailboxMessage } from "@/domain/comms-integrations";
import type { ID } from "@/domain/entities";

const BASE =
  "id, organization_id, relationship_id, thread_id, provider_message_id, provider_thread_id, direction, from_email, from_name, subject, snippet, occurred_at, provenance";

const VARIANTS = [`${BASE}, body_text`, BASE] as const;

function notProvisioned(message: string): boolean {
  return /relation .*comms_messages.* does not exist|could not find the table|schema cache/i.test(
    message,
  );
}

/**
 * The recent messages of the whole workspace, grouped by relationship.
 *
 * A workspace whose integration tables are not applied yet reads as an empty
 * dashboard rather than an error dressed up as data.
 */
export async function listWorkspaceMessages(
  organizationId: ID,
  limit = 1000,
): Promise<Record<string, StoredMailboxMessage[]>> {
  let rows: MessageRow[] | null = null;

  for (const columns of VARIANTS) {
    const result = await supabase
      .from("comms_messages")
      .select(columns)
      .eq("organization_id", organizationId)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (!result.error) {
      rows = result.data as unknown as MessageRow[];
      break;
    }
    if (notProvisioned(result.error.message)) return {};
    if (/body_text/i.test(result.error.message) && columns.includes("body_text")) continue;
    throw new Error(result.error.message);
  }

  const grouped: Record<string, StoredMailboxMessage[]> = {};
  for (const row of rows ?? []) {
    const message = toMessage(row);
    (grouped[message.relationshipId] ??= []).push(message);
  }
  return grouped;
}

/** Opening a conversation is the human act that makes it read. */
export async function markConversationRead(input: {
  relationship: Relationship;
  organizationId: ID;
  userId: ID;
  at?: string;
}): Promise<Relationship> {
  return commsService.update(
    input.relationship.id,
    {
      metadata: {
        ...(input.relationship.metadata ?? {}),
        [READ_AT_KEY]: input.at ?? new Date().toISOString(),
      },
    },
    { organizationId: input.organizationId, userId: input.userId },
  );
}

/** Closing (or reopening) a conversation. Always a person's decision. */
export async function setConversationClosed(input: {
  relationship: Relationship;
  closed: boolean;
  organizationId: ID;
  userId: ID;
}): Promise<Relationship> {
  const metadata = { ...(input.relationship.metadata ?? {}) };
  if (input.closed) metadata[CLOSED_AT_KEY] = new Date().toISOString();
  else delete metadata[CLOSED_AT_KEY];

  return commsService.update(
    input.relationship.id,
    { metadata },
    { organizationId: input.organizationId, userId: input.userId },
  );
}
