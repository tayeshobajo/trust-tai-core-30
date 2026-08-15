/**
 * Comms service — the one place relationship state is written.
 *
 * Every write is organization-scoped, passes RLS as the signed-in user, and is
 * mirrored into the shared `activities` stream so Comms history reads like
 * everything else in Trust Tai.
 *
 * Nothing here sends a message. Drafts are created, reviewed, approved, and
 * marked as sent by a person.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type {
  CommsDraft,
  MemoryItem,
  Reminder,
  Relationship,
  RelationshipSource,
  RelationshipStage,
  ThreadChannel,
  Touch,
} from "@/domain/comms";
import { STAGE_LABEL } from "@/domain/comms";
import type { EvidenceRef } from "@/domain/confidence";
import type { VoiceRegister } from "@/domain/voice";

import { supabaseActivity } from "./activities";
import { emitSuiteEvent } from "@/data/events/suite-events";
import { findOrCreateContact } from "./contacts";
import {
  assertOk,
  DRAFT_COLUMNS,
  memoryPayload,
  REMINDER_COLUMNS,
  RELATIONSHIP_COLUMNS,
  TOUCH_COLUMNS,
  toDraft,
  toReminder,
  toRelationship,
  toTouch,
  type DraftRow,
  type ReminderRow,
  type RelationshipRow,
  type Row,
  type TouchRow,
} from "./comms-schema";

export interface CommsContext {
  organizationId: ID;
  userId: ID;
}

async function record(
  context: CommsContext,
  name: Parameters<typeof supabaseActivity.record>[0]["name"],
  subject: { id: ID; label: string },
  summary: string,
  payload: Record<string, unknown> = {},
) {
  const at = new Date().toISOString();
  await supabaseActivity.record({
    organizationId: context.organizationId,
    name,
    subject: { type: "conversation", id: subject.id, label: subject.label },
    summary,
    payload,
    provenance: {
      appId: "comms",
      actor: { type: "user", id: context.userId },
      observedAt: at,
      confidence: "observed",
    },
    occurredAt: at,
  });
}

/**
 * Cross-app moments go out in the shared suite vocabulary with a dedupe key.
 * Comms owns the relationship; other rooms only read this event.
 */
async function suite(
  context: CommsContext,
  key: "RELATIONSHIP_CREATED" | "RELATIONSHIP_STAGE_CHANGED" | "RELATIONSHIP_MESSAGE_RECEIVED",
  subject: { id: ID; label: string },
  sourceEventKey: string,
  summary: string,
  metadata: Record<string, unknown> = {},
) {
  await emitSuiteEvent({
    key,
    organizationId: context.organizationId,
    actor: { type: "user", id: context.userId },
    subject: { type: "relationship", id: subject.id, label: subject.label },
    summary,
    sourceEventKey,
    metadata,
  });
}

export interface RelationshipInput {
  fullName: string;
  companyName?: string | undefined;
  email?: string | undefined;
  metWhere?: string | undefined;
  metAt?: string | undefined;
  note?: string | undefined;
  source: RelationshipSource;
  stage?: RelationshipStage;
  nextAction?: string | undefined;
  contactId?: ID | undefined;
  prospectId?: ID | undefined;
  observed?: MemoryItem[];
  inferred?: MemoryItem[];
  decided?: MemoryItem[];
  metadata?: Record<string, unknown>;
}

export interface RelationshipPatch {
  stage?: RelationshipStage;
  ownerUserId?: ID | null;
  nextAction?: string | null;
  responseDueAt?: string | null;
  followUpDueAt?: string | null;
  email?: string | null;
  companyName?: string | null;
}

export const commsService = {
  /** Every relationship in the organization. The queue does its own grouping. */
  async list(organizationId: ID): Promise<Relationship[]> {
    const { data, error } = await supabase
      .from("comms_relationships")
      .select(RELATIONSHIP_COLUMNS)
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false });
    assertOk(error);
    return ((data ?? []) as unknown as RelationshipRow[]).map(toRelationship);
  },

  /**
   * Create a relationship. Minimal input is the point: a name, where you met,
   * and one thing worth remembering is enough to make a person real.
   *
   * Importing the same person twice is not an error and never doubles them:
   * an email already tracked in this organization returns the relationship
   * that exists, so messages keep mapping to one person.
   */
  async create(input: RelationshipInput, context: CommsContext): Promise<Relationship> {
    const fullName = input.fullName.trim();
    if (!fullName) throw new Error("A relationship needs a name before it can be saved.");

    const email = input.email?.trim().toLowerCase() || null;
    if (email) {
      const { data: existing, error: existingError } = await supabase
        .from("comms_relationships")
        .select(RELATIONSHIP_COLUMNS)
        .eq("organization_id", context.organizationId)
        .eq("email", email)
        .limit(1)
        .maybeSingle();
      assertOk(existingError);
      if (existing) return toRelationship(existing as unknown as RelationshipRow);
    }



    const at = new Date().toISOString();
    const decided: MemoryItem[] = [...(input.decided ?? [])];
    if (input.note?.trim()) {
      decided.push({
        label: "Worth remembering",
        value: input.note.trim(),
        tier: "decided",
        evidence: [{ label: "Entered by a person", kind: "human" }],
        at,
      });
    }

    // People live once, in the shared `contacts` table. A capture matches the
    // person already on record before it ever writes a new one.
    let contactId = input.contactId ?? null;
    let contactCreated = false;
    if (!contactId) {
      const { person, created } = await findOrCreateContact({
        organizationId: context.organizationId,
        userId: context.userId,
        fullName,
        email: input.email,
        note: input.note,
        metWhere: input.metWhere,
      });
      contactId = person.id;
      contactCreated = created;
    }

    const payload: Row = {
      organization_id: context.organizationId,
      full_name: fullName,
      company_name: input.companyName?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      stage: input.stage ?? "new",
      source: input.source,
      owner_user_id: context.userId,
      met_at: input.metAt ?? (input.source === "in_person" ? at : null),
      met_where: input.metWhere?.trim() || null,
      next_action: input.nextAction?.trim() || null,
      contact_id: contactId,
      prospect_id: input.prospectId ?? null,
      observed: memoryPayload(input.observed ?? []),
      inferred: memoryPayload(input.inferred ?? []),
      decided: memoryPayload(decided),
      metadata: input.metadata ?? {},
      created_by: context.userId,
    };

    const { data, error } = await supabase
      .from("comms_relationships")
      .insert(payload)
      .select(RELATIONSHIP_COLUMNS)
      .single();
    assertOk(error);
    if (!data) throw new Error("That relationship could not be saved.");

    const relationship = toRelationship(data as unknown as RelationshipRow);
    await suite(
      context,
      "RELATIONSHIP_CREATED",
      { id: relationship.id, label: relationship.fullName },
      `relationship.created:${relationship.id}`,
      `${relationship.fullName}${relationship.companyName ? ` (${relationship.companyName})` : ""} was added to Comms${relationship.metWhere ? `, met at ${relationship.metWhere}` : ""}.`,
      {
        source: relationship.source,
        contact_id: contactId,
        contact_created: contactCreated,
        met_where: relationship.metWhere ?? null,
      },
    );
    return relationship;
  },

  /** A stage only changes because a person changed it. */
  async update(
    id: ID,
    patch: RelationshipPatch,
    context: CommsContext,
  ): Promise<Relationship> {
    const payload: Row = {};
    if (patch.stage) payload["stage"] = patch.stage;
    if (patch.ownerUserId !== undefined) payload["owner_user_id"] = patch.ownerUserId;
    if (patch.nextAction !== undefined) payload["next_action"] = patch.nextAction;
    if (patch.responseDueAt !== undefined) payload["response_due_at"] = patch.responseDueAt;
    if (patch.followUpDueAt !== undefined) payload["follow_up_due_at"] = patch.followUpDueAt;
    if (patch.email !== undefined) payload["email"] = patch.email;
    if (patch.companyName !== undefined) payload["company_name"] = patch.companyName;
    payload["updated_at"] = new Date().toISOString();

    const { data, error } = await supabase
      .from("comms_relationships")
      .update(payload)
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .select(RELATIONSHIP_COLUMNS)
      .single();
    assertOk(error);
    if (!data) throw new Error("That relationship could not be updated.");

    const relationship = toRelationship(data as unknown as RelationshipRow);
    if (patch.stage) {
      await suite(
        context,
        "RELATIONSHIP_STAGE_CHANGED",
        { id: relationship.id, label: relationship.fullName },
        // A stage can legitimately be revisited, so this is keyed per move.
        `relationship.stage_changed:${relationship.id}:${relationship.stage}:${relationship.updatedAt}`,
        `${relationship.fullName} moved to ${STAGE_LABEL[relationship.stage]}.`,
        { stage: relationship.stage },
      );
    }
    return relationship;
  },

  /** Add one remembered thing, in its own tier, with its evidence. */
  async remember(
    relationship: Relationship,
    item: Omit<MemoryItem, "at">,
    context: CommsContext,
  ): Promise<Relationship> {
    const at = new Date().toISOString();
    const next: MemoryItem = { ...item, at };
    const column =
      item.tier === "observed" ? "observed" : item.tier === "inferred" ? "inferred" : "decided";
    const existing =
      item.tier === "observed"
        ? relationship.observed
        : item.tier === "inferred"
          ? relationship.inferred
          : relationship.decided;

    const { data, error } = await supabase
      .from("comms_relationships")
      .update({ [column]: memoryPayload([...existing, next]), updated_at: at })
      .eq("id", relationship.id)
      .eq("organization_id", context.organizationId)
      .select(RELATIONSHIP_COLUMNS)
      .single();
    assertOk(error);
    if (!data) throw new Error("That note could not be saved.");
    return toRelationship(data as unknown as RelationshipRow);
  },

  /* ------------------------------------------------------------- touches */

  async listTouches(relationshipId: ID): Promise<Touch[]> {
    const { data, error } = await supabase
      .from("comms_touches")
      .select(TOUCH_COLUMNS)
      .eq("relationship_id", relationshipId)
      .order("occurred_at", { ascending: false });
    assertOk(error);
    return ((data ?? []) as unknown as TouchRow[]).map(toTouch);
  },

  /**
   * Log something that actually happened. This is the only way `last_touch_at`
   * moves, so the queue can never claim contact that did not occur.
   */
  async logTouch(
    input: {
      relationship: Relationship;
      channel: ThreadChannel;
      direction: "inbound" | "outbound";
      summary: string;
      body?: string | undefined;
      occurredAt?: string;
      followUpDueAt?: string | null;
    },
    context: CommsContext,
  ): Promise<Touch> {
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const { data, error } = await supabase
      .from("comms_touches")
      .insert({
        organization_id: context.organizationId,
        relationship_id: input.relationship.id,
        channel: input.channel,
        direction: input.direction,
        occurred_at: occurredAt,
        summary: input.summary.trim(),
        body: input.body?.trim() || null,
        provenance: { app_key: "comms", actor: context.userId, logged_at: occurredAt },
        logged_by: context.userId,
      })
      .select(TOUCH_COLUMNS)
      .single();
    assertOk(error);
    if (!data) throw new Error("That touch could not be logged.");

    const patch: Row = { last_touch_at: occurredAt, updated_at: occurredAt };
    if (input.direction === "inbound") {
      patch["response_due_at"] = new Date(Date.parse(occurredAt) + 2 * 86_400_000).toISOString();
    } else {
      patch["response_due_at"] = null;
      if (input.followUpDueAt !== undefined) patch["follow_up_due_at"] = input.followUpDueAt;
    }
    await supabase
      .from("comms_relationships")
      .update(patch)
      .eq("id", input.relationship.id)
      .eq("organization_id", context.organizationId);

    await record(
      context,
      "conversation.updated",
      { id: input.relationship.id, label: input.relationship.fullName },
      `${input.direction === "inbound" ? "Heard from" : "Wrote to"} ${input.relationship.fullName}: ${input.summary.trim()}`,
      { channel: input.channel, direction: input.direction },
    );

    return toTouch(data as unknown as TouchRow);
  },

  /* -------------------------------------------------------------- drafts */

  async listDrafts(relationshipId: ID): Promise<CommsDraft[]> {
    const { data, error } = await supabase
      .from("comms_drafts")
      .select(DRAFT_COLUMNS)
      .eq("relationship_id", relationshipId)
      .order("created_at", { ascending: false });
    assertOk(error);
    return ((data ?? []) as unknown as DraftRow[]).map(toDraft);
  },

  async saveDraft(
    input: {
      relationship: Relationship;
      register: VoiceRegister;
      intent: string;
      subject?: string | undefined;
      body: string;
      reviewState: CommsDraft["reviewState"];
      rationale: Record<string, unknown>;
      evidence: EvidenceRef[];
    },
    context: CommsContext,
  ): Promise<CommsDraft> {
    const { data, error } = await supabase
      .from("comms_drafts")
      .insert({
        organization_id: context.organizationId,
        relationship_id: input.relationship.id,
        intent: input.intent,
        register: input.register,
        subject: input.subject?.trim() || null,
        body: input.body,
        review_state: input.reviewState,
        rationale: input.rationale,
        evidence: input.evidence,
        created_by: context.userId,
      })
      .select(DRAFT_COLUMNS)
      .single();
    assertOk(error);
    if (!data) throw new Error("That draft could not be saved.");
    return toDraft(data as unknown as DraftRow);
  },

  async setDraftState(
    draft: CommsDraft,
    reviewState: CommsDraft["reviewState"],
    relationship: Relationship,
    context: CommsContext,
  ): Promise<CommsDraft> {
    const { data, error } = await supabase
      .from("comms_drafts")
      .update({ review_state: reviewState, updated_at: new Date().toISOString() })
      .eq("id", draft.id)
      .eq("organization_id", context.organizationId)
      .select(DRAFT_COLUMNS)
      .single();
    assertOk(error);
    if (!data) throw new Error("That draft could not be updated.");

    await record(
      context,
      "conversation.decided",
      { id: relationship.id, label: relationship.fullName },
      `A draft for ${relationship.fullName} was marked ${reviewState.replace(/_/g, " ")}.`,
      { review_state: reviewState, register: draft.register },
    );
    return toDraft(data as unknown as DraftRow);
  },

  /* ------------------------------------------------------------ reminders */

  async listReminders(organizationId: ID): Promise<Reminder[]> {
    const { data, error } = await supabase
      .from("comms_reminders")
      .select(REMINDER_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("state", "pending")
      .order("due_at", { ascending: true });
    assertOk(error);
    return ((data ?? []) as unknown as ReminderRow[]).map(toReminder);
  },

  async saveReminder(
    input: {
      relationship: Relationship;
      reasonCode: Reminder["reasonCode"];
      reasonText: string;
      evidence: EvidenceRef[];
      dueAt?: string | undefined;
    },
    context: CommsContext,
  ): Promise<Reminder> {
    const { data, error } = await supabase
      .from("comms_reminders")
      .insert({
        organization_id: context.organizationId,
        relationship_id: input.relationship.id,
        reason_code: input.reasonCode,
        reason_text: input.reasonText,
        evidence: input.evidence,
        due_at: input.dueAt ?? null,
        state: "pending",
        created_by: context.userId,
      })
      .select(REMINDER_COLUMNS)
      .single();
    assertOk(error);
    if (!data) throw new Error("That reminder could not be saved.");
    return toReminder(data as unknown as ReminderRow);
  },

  async setReminderState(
    reminder: Reminder,
    state: Reminder["state"],
    context: CommsContext,
  ): Promise<void> {
    const { error } = await supabase
      .from("comms_reminders")
      .update({ state, updated_at: new Date().toISOString() })
      .eq("id", reminder.id)
      .eq("organization_id", context.organizationId);
    assertOk(error);
  },
};
