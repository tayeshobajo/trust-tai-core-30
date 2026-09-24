/**
 * Outcome recording, server only.
 *
 * Applies the pure rules in src/domain/outcome-fill.ts to the tables: this
 * is where DECIDE -> ACT -> HUMAN RESPONDS closes into OUTCOME. Two
 * writers, both observational, neither ever sends or schedules anything:
 *
 *  - `recordInboundReply` runs when an inbound message lands on a
 *    relationship (Gmail sync, LinkedIn reply ingest). It appends one
 *    relationship_replied event to the relationship's metadata, always,
 *    and at most ONE touch-level reply_observed event onto a sent draft's
 *    dimensional record: direct_reply when thread metadata ties the
 *    inbound to that send, likely_influenced for the single most recent
 *    plausible send, nothing when the tie would be a guess.
 *  - `recordSilenceObservations` runs from the already-scheduled daily
 *    mailbox pass. A sent draft thirty days old with nothing inbound after
 *    it gets a no_response_observed_30d event. An observation, not a
 *    verdict: a later reply appends after it and the derived state moves.
 *
 * Both write additively into existing jsonb, the draft's rationale and the
 * relationship's metadata. Events are append-only and deduped by message
 * ref, so a re-run of the same sync pass writes nothing. No new tables, no
 * new columns, no new cron. Failures are logged and never break the
 * caller's pass: a missed event is retried naturally on the next inbound
 * or the next daily run.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { readDraftSend } from "@/domain/comms-send";
import {
  appendOutcomeEvent,
  planReplyOutcome,
  planSilenceObservation,
  readOutcomeEvents,
  silenceObservation,
  type SendCandidate,
} from "@/domain/outcome-fill";

/** One pass never chews through more than this many sent drafts. */
const FILL_BATCH_LIMIT = 200;

interface SentDraftRow {
  id: string;
  relationship_id: string | null;
  rationale: Record<string, unknown> | null;
}

/** The draft rows that could carry an outcome event, newest first. */
async function loadSentDrafts(
  client: SupabaseClient,
  organizationId: string,
  relationshipId?: string,
): Promise<SentDraftRow[]> {
  let query = client
    .from("comms_drafts")
    .select("id, relationship_id, rationale")
    .eq("organization_id", organizationId)
    .eq("review_state", "sent");
  if (relationshipId) query = query.eq("relationship_id", relationshipId);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(FILL_BATCH_LIMIT);
  if (error) {
    console.warn(`[comms-outcome] sent-draft read failed: ${error.message}`);
    return [];
  }
  return (data ?? []) as SentDraftRow[];
}

/** Write one draft's grown event history back, additively. */
async function storeDraftDimensional(
  client: SupabaseClient,
  organizationId: string,
  draft: SentDraftRow,
  dimensional: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await client
    .from("comms_drafts")
    .update({
      rationale: { ...(draft.rationale ?? {}), dimensional },
      updated_at: new Date().toISOString(),
    })
    .eq("id", draft.id)
    .eq("organization_id", organizationId);
  if (error) {
    console.warn(`[comms-outcome] outcome write failed for draft ${draft.id}: ${error.message}`);
    return false;
  }
  return true;
}

/** The relationship's metadata jsonb, the relationship event's home. */
async function loadRelationshipMetadata(
  client: SupabaseClient,
  organizationId: string,
  relationshipId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client
    .from("comms_relationships")
    .select("id, metadata")
    .eq("organization_id", organizationId)
    .eq("id", relationshipId)
    .limit(1);
  if (error) {
    console.warn(`[comms-outcome] relationship read failed: ${error.message}`);
    return null;
  }
  const row = ((data ?? []) as { metadata?: unknown }[])[0];
  if (!row) return null;
  return row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? (row.metadata as Record<string, unknown>)
    : {};
}

export interface InboundReplyContext {
  organizationId: string;
  relationshipId: string;
  /** Which channel carried the reply: "email" or "linkedin". */
  channel: string;
  /** Pointer to the inbound row: provider message id or touch id. */
  messageRef: string;
  /** When the inbound message was observed. */
  repliedAt: string;
  /** The provider thread the inbound arrived on, when the transport said. */
  threadRef?: string | null;
}

/**
 * An inbound message landed: record the relationship-level fact, and the
 * touch-level tie only where the evidence supports one. Returns how many
 * events were written (relationship plus touch, 0 to 2).
 */
export async function recordInboundReply(
  client: SupabaseClient,
  context: InboundReplyContext,
): Promise<number> {
  const metadata = await loadRelationshipMetadata(
    client,
    context.organizationId,
    context.relationshipId,
  );
  if (metadata === null) return 0;

  const drafts = await loadSentDrafts(client, context.organizationId, context.relationshipId);
  const byId = new Map(drafts.map((draft) => [draft.id, draft]));
  const sends: SendCandidate[] = [];
  for (const draft of drafts) {
    const send = readDraftSend(draft.rationale);
    if (!send?.sentAt) continue;
    sends.push({
      draftId: draft.id,
      sentAt: send.sentAt,
      threadRef: send.providerThreadId ?? null,
      dimensional: draft.rationale?.["dimensional"],
    });
  }

  const plan = planReplyOutcome({
    relationshipRecord: metadata,
    sends,
    reply: {
      messageRef: context.messageRef,
      occurredAt: context.repliedAt,
      channel: context.channel,
      threadRef: context.threadRef ?? null,
    },
  });

  let written = 0;
  if (plan.relationshipEvent) {
    const grown = appendOutcomeEvent(metadata, plan.relationshipEvent);
    if (grown) {
      const { error } = await client
        .from("comms_relationships")
        .update({ metadata: grown, updated_at: new Date().toISOString() })
        .eq("id", context.relationshipId)
        .eq("organization_id", context.organizationId);
      if (error) {
        console.warn(`[comms-outcome] relationship event write failed: ${error.message}`);
      } else {
        written += 1;
      }
    }
  }
  if (plan.touchUpdate) {
    const draft = byId.get(plan.touchUpdate.draftId);
    if (
      draft &&
      (await storeDraftDimensional(
        client,
        context.organizationId,
        draft,
        plan.touchUpdate.dimensional,
      ))
    ) {
      written += 1;
    }
  }
  return written;
}

/** True when anything inbound reached this relationship after the send. */
async function hasInboundAfter(
  client: SupabaseClient,
  organizationId: string,
  relationshipId: string,
  sentAt: string,
): Promise<boolean> {
  const { data: messages, error: messageError } = await client
    .from("comms_messages")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("relationship_id", relationshipId)
    .eq("direction", "inbound")
    .gt("occurred_at", sentAt)
    .limit(1);
  if (messageError) {
    console.warn(`[comms-outcome] inbound message read failed: ${messageError.message}`);
    return true; // Unreadable is not silence. Record nothing rather than lie.
  }
  if ((messages ?? []).length > 0) return true;

  const { data: touches, error: touchError } = await client
    .from("comms_touches")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("relationship_id", relationshipId)
    .eq("direction", "inbound")
    .gt("occurred_at", sentAt)
    .limit(1);
  if (touchError) {
    console.warn(`[comms-outcome] inbound touch read failed: ${touchError.message}`);
    return true;
  }
  return (touches ?? []).length > 0;
}

/**
 * The daily silence pass for one workspace. Every sent draft carrying a
 * dimensional record with no reply event and no silence event yet, whose
 * send is thirty days old and whose relationship heard nothing inbound
 * since, gets a no_response_observed_30d event appended. Returns how many
 * were recorded.
 */
export async function recordSilenceObservations(
  client: SupabaseClient,
  organizationId: string,
  now: string = new Date().toISOString(),
): Promise<number> {
  const drafts = await loadSentDrafts(client, organizationId);
  let recorded = 0;
  for (const draft of drafts) {
    if (!draft.relationship_id) continue;
    const send = readDraftSend(draft.rationale);
    const sentAt = send?.sentAt;
    if (!sentAt || !silenceObservation(sentAt, now)) continue;
    /* Cheap plan check before any inbound query is spent: a record with any
       touch-level history already is not silent. */
    const stored = draft.rationale?.["dimensional"];
    if (!stored || typeof stored !== "object") continue;
    if (readOutcomeEvents(stored).length > 0) continue;
    if (await hasInboundAfter(client, organizationId, draft.relationship_id, sentAt)) continue;
    const dimensional = planSilenceObservation(stored, { sentAt, now, channel: null });
    if (!dimensional) continue;
    if (await storeDraftDimensional(client, organizationId, draft, dimensional)) {
      recorded += 1;
    }
  }
  return recorded;
}
