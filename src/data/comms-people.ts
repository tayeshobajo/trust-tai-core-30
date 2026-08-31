/**
 * Comms ↔ People wiring.
 *
 * Every Comms relationship is backed by a real person row in the shared
 * `contacts` table: name, title, company. This module is the only place that
 * link is established, reconciled, and edited, so a conversation, a Scout
 * prospect profile, and the shared people record can never drift apart.
 *
 * Fail-quiet, never fail-loud: reconciliation fills blanks and clears mailbox
 * noise; it never overwrites something a person typed. Everything runs through
 * the signed-in client, so RLS and the organization boundary still hold.
 */

import type { ID } from "@/domain/entities";
import type { Person } from "@/domain/people";
import {
  identityPatches,
  resolveIdentity,
  type PersonIdentity,
} from "@/domain/comms-people";
import { supabase } from "@/integrations/trust-tai/supabase";

import {
  findOrCreateContact,
  toPerson,
  updateContact,
  type ContactRow,
} from "./supabase/contacts";

const CONTACT_COLUMNS =
  "id, organization_id, client_id, full_name, title, email, phone, metadata, created_by, created_at, updated_at";

export interface RelationshipPersonRow {
  id: string;
  organization_id: string;
  contact_id: string | null;
  prospect_id: string | null;
  full_name: string;
  company_name: string | null;
  email: string | null;
}

export interface RelationshipPerson {
  relationshipId: ID;
  contactId: ID;
  /** The canonical person record behind this conversation. */
  person: Person;
  /** What Comms should display: name, title, company. */
  identity: PersonIdentity;
  /** The Scout prospect this person also belongs to, when there is one. */
  prospectId?: ID;
}

function companyOf(row: ContactRow): string | undefined {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const nested = metadata["people"];
  const scope =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : metadata;
  const value = scope["company_name"];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readRelationship(
  organizationId: ID,
  relationshipId: ID,
): Promise<RelationshipPersonRow> {
  const { data, error } = await supabase
    .from("comms_relationships")
    .select("id, organization_id, contact_id, prospect_id, full_name, company_name, email")
    .eq("organization_id", organizationId)
    .eq("id", relationshipId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "That relationship is no longer on record.");
  return data as unknown as RelationshipPersonRow;
}

async function readContact(contactId: ID): Promise<ContactRow | null> {
  const { data } = await supabase
    .from("contacts")
    .select(CONTACT_COLUMNS)
    .eq("id", contactId)
    .maybeSingle();
  return (data as unknown as ContactRow | null) ?? null;
}

/**
 * Resolve the person behind a conversation, creating the link when Comms is
 * missing one, and quietly reconciling what both sides say about them.
 */
export async function ensureRelationshipPerson(input: {
  organizationId: ID;
  userId: ID;
  relationshipId: ID;
}): Promise<RelationshipPerson> {
  const relationship = await readRelationship(input.organizationId, input.relationshipId);

  let contact = relationship.contact_id ? await readContact(relationship.contact_id) : null;
  if (!contact) {
    // One person, one memory: match before creating.
    const { person } = await findOrCreateContact({
      organizationId: input.organizationId,
      userId: input.userId,
      fullName: relationship.full_name,
      ...(relationship.email ? { email: relationship.email } : {}),
    });
    contact = await readContact(person.id);
    if (!contact) throw new Error("That person could not be linked.");
    await supabase
      .from("comms_relationships")
      .update({ contact_id: contact.id, updated_at: new Date().toISOString() })
      .eq("id", relationship.id);
    relationship.contact_id = contact.id;
  }

  const sides = {
    relationship: {
      fullName: relationship.full_name,
      ...(relationship.company_name ? { companyName: relationship.company_name } : {}),
      ...(relationship.email ? { email: relationship.email } : {}),
    },
    contact: {
      fullName: contact.full_name,
      ...(contact.title ? { roleTitle: contact.title } : {}),
      ...(companyOf(contact) ? { companyName: companyOf(contact) } : {}),
    },
  };
  const identity = resolveIdentity(sides);
  const patches = identityPatches(sides, identity);

  if (Object.keys(patches.relationship).length > 0) {
    await supabase
      .from("comms_relationships")
      .update({
        ...(patches.relationship.fullName ? { full_name: patches.relationship.fullName } : {}),
        ...(patches.relationship.companyName !== undefined
          ? { company_name: patches.relationship.companyName }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", relationship.id);
  }

  // Scout keeps the same person: the prospect link lives on the contact, so a
  // person met in Comms shows up on the Scout company profile too.
  const contactPatch = {
    ...patches.contact,
    ...(relationship.prospect_id && toPerson(contact).prospectId !== relationship.prospect_id
      ? { prospectId: relationship.prospect_id }
      : {}),
  };

  let person = toPerson(contact);
  if (Object.keys(contactPatch).length > 0) {
    person = await updateContact(contact.id, contactPatch, input.userId);
  }

  return {
    relationshipId: relationship.id,
    contactId: contact.id,
    person,
    identity,
    ...(relationship.prospect_id ? { prospectId: relationship.prospect_id } : {}),
  };
}

/**
 * A human edit. It outranks every derivation, lands on both the conversation
 * and the shared person record, and carries into the Scout prospect profile
 * when this person belongs to one.
 */
export async function saveRelationshipPerson(input: {
  organizationId: ID;
  userId: ID;
  relationshipId: ID;
  identity: PersonIdentity;
}): Promise<RelationshipPerson> {
  const current = await ensureRelationshipPerson(input);
  const contact = await readContact(current.contactId);
  if (!contact) throw new Error("That person is no longer on record.");

  const sides = {
    relationship: {
      fullName: current.identity.fullName,
      ...(current.identity.companyName ? { companyName: current.identity.companyName } : {}),
      ...(contact.email ? { email: contact.email } : {}),
    },
    contact: {
      fullName: contact.full_name,
      ...(contact.title ? { roleTitle: contact.title } : {}),
      ...(companyOf(contact) ? { companyName: companyOf(contact) } : {}),
    },
  };
  const patches = identityPatches(sides, input.identity);
  if (!patches.changed) return current;

  if (Object.keys(patches.relationship).length > 0) {
    const { error } = await supabase
      .from("comms_relationships")
      .update({
        ...(patches.relationship.fullName ? { full_name: patches.relationship.fullName } : {}),
        ...(patches.relationship.companyName !== undefined
          ? { company_name: patches.relationship.companyName }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", current.relationshipId);
    if (error) throw new Error(error.message);
  }

  const person =
    Object.keys(patches.contact).length > 0
      ? await updateContact(
          current.contactId,
          { ...patches.contact, confidence: "human_confirmed" },
          input.userId,
        )
      : current.person;

  return {
    ...current,
    person,
    identity: {
      fullName: input.identity.fullName.trim(),
      ...(input.identity.roleTitle?.trim() ? { roleTitle: input.identity.roleTitle.trim() } : {}),
      ...(input.identity.companyName?.trim()
        ? { companyName: input.identity.companyName.trim() }
        : {}),
    },
  };
}
