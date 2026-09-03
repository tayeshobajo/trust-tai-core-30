/**
 * Bringing a labeled correspondent into Comms (server only).
 *
 * The Gmail label is the approval; this is what the approval does. One
 * canonical person in the shared `contacts` table, one Comms relationship for
 * that person, many conversations underneath. There is no Gmail-specific
 * people table and never will be.
 *
 * Idempotent by construction: the relationship is looked up by normalized
 * email before anything is written, the contact likewise, and the creation
 * event carries a dedupe key naming the person. A repeated sync therefore
 * finds what already exists and writes nothing.
 *
 * Every call goes through the caller-supplied Supabase client, so the
 * member-invoked path stays under RLS and the scheduled path stays
 * service-role, the same governed shape either way.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { SUITE_EVENTS } from "@/domain/events";

export interface IntakeInput {
  organizationId: string;
  /** Normalized, lowercased counterpart address. */
  email: string;
  /** Display name from the labeled mail, when Gmail carried one. */
  name?: string;
  /** The mailbox that observed the label, transport provenance. */
  mailbox: string;
  providerThreadId: string;
  providerMessageId: string;
  occurredAt: string;
}

export interface IntakeOutcome {
  relationshipId: string;
  fullName: string;
  email: string;
  created: boolean;
}

/** A readable person name when Gmail gave none: the local part, humanized. */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const words = local
.split(/[._\-+]+/)
.filter(Boolean)
.map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length > 0 ? words.join(" "): email;
}

/** The canonical person row, reused when the workspace already knows them. */
async function findOrCreateCanonicalContact(
  client: SupabaseClient,
  input: IntakeInput,
  fullName: string,
): Promise<string | null> {
  const { data: existing, error } = await client
.from("contacts")
.select("id, email")
.eq("organization_id", input.organizationId)
.ilike("email", input.email)
.limit(1);
  if (error) {
    console.warn(`[comms-intake] contact read failed: ${error.message}`);
    return null;
  }
  const match = ((existing ?? []) as { id: string }[])[0];
  if (match) return match.id;

  const at = new Date().toISOString();
  const { data: created, error: insertError } = await client
.from("contacts")
.insert({
      organization_id: input.organizationId,
      full_name: fullName,
      email: input.email,
      metadata: {
        email_status: "found",
        confidence: "observed",
        source_id: "comms_gmail_label",
        provenance: {
          appId: "comms",
          actor: { type: "system", id: "comms-gmail-sync", label: "Gmail label intake" },
          observedAt: at,
          externalRef: `gmail:${input.providerThreadId}`,
          confidence: "observed",
        },
      },
    })
.select("id")
.single();
  if (insertError) {
    console.warn(`[comms-intake] contact write failed: ${insertError.message}`);
    return null;
  }
  return (created as { id: string }).id;
}

/** The one suite event a label-driven intake produces, keyed on the person. */
function createdEventKey(organizationId: string, email: string): string {
  return `gmail:relationship_created:${organizationId}:${email}`;
}

async function recordCreation(
  client: SupabaseClient,
  input: IntakeInput,
  relationshipId: string,
  fullName: string,
): Promise<void> {
  const definition = SUITE_EVENTS.RELATIONSHIP_CREATED;
  const key = createdEventKey(input.organizationId, input.email);
  const { error } = await client.from("activities").insert({
    organization_id: input.organizationId,
    app_key: definition.emittedBy,
    event_type: definition.name,
    actor_user_id: null,
    entity_type: "relationship",
    entity_id: relationshipId,
    summary: `${fullName} was labeled Trust Tai/Comms in ${input.mailbox} and added to Comms.`,
    occurred_at: input.occurredAt,
    source_event_key: key,
    payload: {
      label: fullName,
      event: definition.name,
      source: "gmail_label",
      mailbox: input.mailbox,
      provider_thread_id: input.providerThreadId,
      source_event_key: key,
      provenance: {
        appId: definition.emittedBy,
        actor: { type: "system", id: "comms-gmail-sync", label: "Gmail label intake" },
        observedAt: new Date().toISOString(),
        externalRef: key,
        confidence: "observed",
        dedupe_key: key,
      },
    },
  });
  // 23505 means the unique index already recorded this intake. Anything else
  // is history, not the intake itself: never fail the relationship for it.
  if (error && error.code !== "23505") {
    console.warn(`[comms-intake] creation event failed for ${key}: ${error.message}`);
  }
}

/**
 * Resolve, or create once, the Comms relationship for a labeled
 * correspondent. Throws only when the relationship itself cannot be
 * established; the caller turns that into a visible, retryable exception
 * rather than dropping the person silently.
 */
export async function ensureLabeledRelationship(
  client: SupabaseClient,
  input: IntakeInput,
): Promise<IntakeOutcome> {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error("A labeled correspondent needs an address.");

  const { data: existing, error: existingError } = await client
.from("comms_relationships")
.select("id, full_name, email")
.eq("organization_id", input.organizationId)
.eq("email", email)
.limit(1);
  if (existingError) throw new Error(existingError.message);
  const found = ((existing ?? []) as { id: string; full_name: string }[])[0];
  if (found) {
    return { relationshipId: found.id, fullName: found.full_name, email, created: false };
  }

  const fullName = input.name?.trim() || nameFromEmail(email);
  const contactId = await findOrCreateCanonicalContact(client, {...input, email }, fullName);

  const at = new Date().toISOString();
  const { data: created, error } = await client
.from("comms_relationships")
.insert({
      organization_id: input.organizationId,
      full_name: fullName,
      email,
      // Lifecycle stays where governed rules put a new person. Nothing here
      // infers a client, a company, or an organization.
      stage: "new",
      source: "inbound",
      contact_id: contactId,
      metadata: {
        gmail_intake: {
          approved_by: "gmail_label",
          label: "Trust Tai/Comms",
          mailbox: input.mailbox,
          first_provider_thread_id: input.providerThreadId,
          first_provider_message_id: input.providerMessageId,
          first_observed_at: input.occurredAt,
          created_at: at,
        },
      },
    })
.select("id, full_name")
.single();
  if (error) throw new Error(error.message);
  const row = created as { id: string; full_name: string };

  await recordCreation(client, {...input, email }, row.id, row.full_name);
  return { relationshipId: row.id, fullName: row.full_name, email, created: true };
}
