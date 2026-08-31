/**
 * The Person card on a Scout company, and what saving it prepares.
 *
 * Saving a person is a human decision, so it outranks every derivation: the
 * name, title and company land on the shared people record. Because a named,
 * confirmed person is the only reason a first message can exist, saving also
 * prepares that draft in Comms with exactly those three facts.
 *
 * Nothing is sent. The draft is a starting point a person edits and approves.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import { commsService } from "@/data/supabase/comms-service";
import { updateContact } from "@/data/supabase/contacts";
import type { CommsDraft, Relationship } from "@/domain/comms";
import type { HandoffDevelopment } from "@/domain/comms-handoff";
import type { ID } from "@/domain/entities";
import {
  composeFirstMessage,
  FIRST_MESSAGE_KIND,
  type FirstMessageDevelopmentRead,
} from "@/domain/first-message";
import type { Person } from "@/domain/people";
import { RELATIONSHIP_COLUMNS, toRelationship, type RelationshipRow } from "@/data/supabase/comms-schema";

export interface ProspectPersonIdentity {
  fullName: string;
  roleTitle?: string | undefined;
  companyName?: string | undefined;
}

export interface PreparedFirstMessage {
  relationshipId: ID;
  draft: CommsDraft;
  /** False when a prepared draft already existed and was left untouched. */
  created: boolean;
}

export interface SavedProspectPerson {
  person: Person;
  prepared: PreparedFirstMessage | null;
  /** Why no draft was prepared, when none was. */
  because?: string;
}

/** The development read, reduced to what the opening draft may use. */
export function developmentRead(
  development?: HandoffDevelopment | undefined,
): FirstMessageDevelopmentRead | undefined {
  if (!development) return undefined;
  const bridge = development.bridgeIdeas[0];
  return {
    ...(development.whyNow ? { whyNow: development.whyNow } : {}),
    ...(bridge ? { bridge: { label: bridge.label, idea: bridge.idea } } : {}),
    ...(development.firstMovePosture ? { firstMovePosture: development.firstMovePosture } : {}),
  };
}

/** The Comms relationship already open for this person, if there is one. */
async function findRelationship(input: {
  organizationId: ID;
  prospectId: ID;
  contactId: ID;
  email?: string | undefined;
}): Promise<Relationship | null> {
  const byContact = await supabase
    .from("comms_relationships")
    .select(RELATIONSHIP_COLUMNS)
    .eq("organization_id", input.organizationId)
    .eq("contact_id", input.contactId)
    .limit(1)
    .maybeSingle();
  if (byContact.error) throw new Error(byContact.error.message);
  if (byContact.data) return toRelationship(byContact.data as unknown as RelationshipRow);

  if (input.email) {
    const byEmail = await supabase
      .from("comms_relationships")
      .select(RELATIONSHIP_COLUMNS)
      .eq("organization_id", input.organizationId)
      .eq("email", input.email.toLowerCase())
      .limit(1)
      .maybeSingle();
    if (byEmail.error) throw new Error(byEmail.error.message);
    if (byEmail.data) return toRelationship(byEmail.data as unknown as RelationshipRow);
  }
  return null;
}

/**
 * Prepare (or find) the opening draft for one person, idempotently. A draft
 * already prepared for this person is returned as-is: re-saving the card never
 * multiplies drafts or overwrites edited words.
 */
export async function prepareFirstMessageDraft(input: {
  organizationId: ID;
  userId: ID;
  prospectId: ID;
  companyName: string;
  person: Person;
  identity: ProspectPersonIdentity;
  development?: HandoffDevelopment | undefined;
}): Promise<PreparedFirstMessage> {
  const existing = await findRelationship({
    organizationId: input.organizationId,
    prospectId: input.prospectId,
    contactId: input.person.id,
    ...(input.person.email ? { email: input.person.email } : {}),
  });

  const relationship =
    existing ??
    (await commsService.create(
      {
        fullName: input.identity.fullName,
        companyName: input.identity.companyName ?? input.companyName,
        ...(input.person.email ? { email: input.person.email } : {}),
        source: "scout_handoff",
        stage: "researching",
        contactId: input.person.id,
        prospectId: input.prospectId,
        nextAction: `Review the prepared first message to ${input.identity.fullName}.`,
      },
      { organizationId: input.organizationId, userId: input.userId },
    ));

  // Keep the conversation's company in step with what the card now says.
  if (
    input.identity.companyName &&
    relationship.companyName !== input.identity.companyName
  ) {
    await commsService.update(
      relationship.id,
      { companyName: input.identity.companyName },
      { organizationId: input.organizationId, userId: input.userId },
    );
  }

  const drafts = await commsService.listDrafts(relationship.id);
  const prepared = drafts.find((draft) => draft.rationale["kind"] === FIRST_MESSAGE_KIND);
  if (prepared) return { relationshipId: relationship.id, draft: prepared, created: false };

  const content = composeFirstMessage({
    person: input.identity,
    companyName: input.companyName,
    ...(developmentRead(input.development)
      ? { development: developmentRead(input.development)! }
      : {}),
  });

  const draft = await commsService.saveDraft(
    {
      relationship,
      register: "warm_intro",
      intent: "open_conversation",
      subject: content.subject,
      body: content.body,
      reviewState: "draft",
      rationale: {
        kind: FIRST_MESSAGE_KIND,
        prospect_id: input.prospectId,
        person_id: input.person.id,
        full_name: input.identity.fullName,
        role_title: input.identity.roleTitle ?? null,
        company_name: input.identity.companyName ?? input.companyName,
      },
      evidence: [{ label: "Person confirmed by a Trust Tai member in Scout", kind: "human" }],
    },
    { organizationId: input.organizationId, userId: input.userId },
  );

  return { relationshipId: relationship.id, draft, created: true };
}

/**
 * Save the Person card, then auto-prepare the first message with that name,
 * title and company. A save always lands; a draft that cannot be prepared
 * never loses the save.
 */
export async function saveProspectPerson(input: {
  organizationId: ID;
  userId: ID;
  prospectId: ID;
  companyName: string;
  person: Person;
  identity: ProspectPersonIdentity;
  development?: HandoffDevelopment | undefined;
}): Promise<SavedProspectPerson> {
  const fullName = input.identity.fullName.trim();
  if (!fullName) throw new Error("A person needs a name before their card can be saved.");

  const person = await updateContact(
    input.person.id,
    {
      fullName,
      roleTitle: input.identity.roleTitle?.trim() ?? "",
      companyName: input.identity.companyName?.trim() ?? "",
      confidence: "human_confirmed",
      prospectId: input.prospectId,
    },
    input.userId,
  );

  const identity: ProspectPersonIdentity = {
    fullName,
    ...(input.identity.roleTitle?.trim() ? { roleTitle: input.identity.roleTitle.trim() } : {}),
    ...(input.identity.companyName?.trim()
      ? { companyName: input.identity.companyName.trim() }
      : {}),
  };

  try {
    const prepared = await prepareFirstMessageDraft({ ...input, person, identity });
    return { person, prepared };
  } catch (error) {
    return {
      person,
      prepared: null,
      because:
        error instanceof Error
          ? error.message
          : "Their record was saved. The first message could not be prepared yet.",
    };
  }
}
