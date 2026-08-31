/**
 * Comms → Scout.
 *
 * A conversation can be the first time we learn a company exists. This is how
 * a member turns that person into a Scout company profile: they name the
 * company, the person's title and the role they play in it, and Scout gets a
 * prospect whose provenance says plainly that a human entered it.
 *
 * One person, one memory: the same contact row carries across, and the
 * conversation keeps its history — nothing is duplicated or moved.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import { updateContact } from "@/data/supabase/contacts";
import { insertRelationshipProspect } from "@/data/supabase/prospects";
import { ensureRelationshipPerson } from "@/data/comms-people";
import type { ID, Prospect } from "@/domain/entities";

export interface RelationshipToProspectInput {
  organizationId: ID;
  userId: ID;
  relationshipId: ID;
  companyName: string;
  websiteUrl?: string | undefined;
  roleTitle?: string | undefined;
  /** What this person does for the company, in the member's words. */
  role?: string | undefined;
}

export interface RelationshipToProspectResult {
  prospect: Prospect;
  contactId: ID;
}

/** Save a Comms relationship as a Scout company profile of its own. */
export async function saveRelationshipAsProspect(
  input: RelationshipToProspectInput,
): Promise<RelationshipToProspectResult> {
  const companyName = input.companyName.trim();
  if (!companyName) throw new Error("A company needs a name before Scout can hold it.");

  const linked = await ensureRelationshipPerson({
    organizationId: input.organizationId,
    userId: input.userId,
    relationshipId: input.relationshipId,
  });

  const prospect = await insertRelationshipProspect({
    organizationId: input.organizationId,
    userId: input.userId,
    companyName,
    ...(input.websiteUrl?.trim() ? { websiteUrl: input.websiteUrl.trim() } : {}),
    relationshipId: input.relationshipId,
    personName: linked.identity.fullName,
    ...(input.roleTitle?.trim() ? { roleTitle: input.roleTitle.trim() } : {}),
    ...(input.role?.trim() ? { role: input.role.trim() } : {}),
  });

  // The person belongs to the company now, on the one shared record.
  await updateContact(
    linked.contactId,
    {
      prospectId: prospect.id,
      companyName,
      ...(input.roleTitle?.trim() ? { roleTitle: input.roleTitle.trim() } : {}),
    },
    input.userId,
  );

  const { error } = await supabase
    .from("comms_relationships")
    .update({
      prospect_id: prospect.id,
      company_name: companyName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.relationshipId)
    .eq("organization_id", input.organizationId);
  if (error) throw new Error(error.message);

  return { prospect, contactId: linked.contactId };
}
