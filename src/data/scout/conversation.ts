/**
 * The conversation, read from Scout.
 *
 * Comms owns the relationship; Scout only reads it. A company page shows the
 * real thread with the real person so nobody has to guess whether anyone has
 * spoken to them, and every reply lands against the person it came from.
 *
 * Read-only by design: writing, drafting and sending all stay in Comms.
 */

import { listRelationshipMessages } from "@/data/supabase/comms-messages";
import { listProspectContacts } from "@/data/supabase/contacts";
import {
  RELATIONSHIP_COLUMNS,
  toRelationship,
  type RelationshipRow,
} from "@/data/supabase/comms-schema";
import type { Relationship } from "@/domain/comms";
import type { StoredMailboxMessage } from "@/domain/comms-integrations";
import type { ID } from "@/domain/entities";
import { supabase } from "@/integrations/trust-tai/supabase";

export interface ProspectConversation {
  relationship: Relationship;
  /** Oldest first, exactly as Comms stores them. */
  messages: StoredMailboxMessage[];
  lastMessageAt: string | null;
}

function notProvisioned(message: string): boolean {
  return /does not exist|could not find the table|schema cache/i.test(message);
}

/** Every Comms conversation attached to this company, newest activity first. */
export async function listProspectConversations(
  organizationId: ID,
  prospectId: ID,
): Promise<ProspectConversation[]> {
  let rows: RelationshipRow[] = [];
  try {
    const byProspect = await supabase
      .from("comms_relationships")
      .select(RELATIONSHIP_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("prospect_id", prospectId);
    if (byProspect.error) throw new Error(byProspect.error.message);
    rows = (byProspect.data ?? []) as unknown as RelationshipRow[];

    // People carried into Comms before the prospect link existed still belong
    // to this company: the shared contact row is what proves it.
    const people = await listProspectContacts(organizationId, prospectId);
    const contactIds = people.map((person) => person.id);
    if (contactIds.length > 0) {
      const byContact = await supabase
        .from("comms_relationships")
        .select(RELATIONSHIP_COLUMNS)
        .eq("organization_id", organizationId)
        .in("contact_id", contactIds);
      if (byContact.error) throw new Error(byContact.error.message);
      for (const row of (byContact.data ?? []) as unknown as RelationshipRow[]) {
        if (!rows.some((existing) => existing.id === row.id)) rows.push(row);
      }
    }
  } catch (error) {
    // Comms may not be provisioned in this backend. Scout still stands.
    if (error instanceof Error && notProvisioned(error.message)) return [];
    throw error;
  }

  const conversations = await Promise.all(
    rows.map(async (row) => {
      const relationship = toRelationship(row);
      let messages: StoredMailboxMessage[] = [];
      try {
        messages = await listRelationshipMessages(organizationId, relationship.id, 100);
      } catch {
        messages = [];
      }
      const last = messages[messages.length - 1];
      return {
        relationship,
        messages,
        lastMessageAt: last?.occurredAt ?? null,
      };
    }),
  );

  return conversations.sort((a, b) => {
    const left = a.lastMessageAt ?? a.relationship.updatedAt ?? "";
    const right = b.lastMessageAt ?? b.relationship.updatedAt ?? "";
    return right.localeCompare(left);
  });
}
