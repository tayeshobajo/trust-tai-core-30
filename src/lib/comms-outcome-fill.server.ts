/**
 * Outcome fill, server only.
 *
 * Applies the pure rules in src/domain/outcome-fill.ts to the drafts table:
 * this is where DECIDE → ACT → HUMAN RESPONDS closes into OUTCOME. Two
 * writers, both observational, neither ever sends or schedules anything:
 *
 *  - `fillRepliedOutcomes` runs when an inbound message lands on a
 *    relationship (Gmail sync, LinkedIn reply ingest). Every sent draft on
 *    that relationship carrying a dimensional record with an open outcome,
 *    and a send that predates the reply, gets `outcome: "replied"` with the
 *    latency and a pointer to the message. Semantic classification stays
 *    null for the judgment layer.
 *  - `fillSilenceOutcomes` runs from the already-scheduled daily mailbox
 *    pass. A sent draft thirty days old with nothing inbound after it gets
 *    `outcome: "no_response_30d"`.
 *
 * Both write additively into the draft's existing rationale jsonb, the same
 * home the dimensional record was captured into. No new tables, no new
 * columns, no new cron. Failures are logged and never break the caller's
 * pass: a missed fill is retried naturally on the next inbound or the next
 * daily run, because the outcome stays honestly null until written.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { readDraftSend } from "@/domain/comms-send";
import {
  withRepliedOutcome,
  withSilenceOutcome,
  silenceOutcome,
} from "@/domain/outcome-fill";

/** One pass never chews through more than this many sent drafts. */
const FILL_BATCH_LIMIT = 200;

interface SentDraftRow {
  id: string;
  relationship_id: string | null;
  rationale: Record<string, unknown> | null;
}

/** The draft rows that could carry a fillable outcome, newest first. */
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

/** Write one filled record back into the draft's rationale, additively. */
async function storeFilledOutcome(
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

export interface RepliedFillContext {
  organizationId: string;
  relationshipId: string;
  /** Which channel carried the reply: "email" or "linkedin". */
  channel: string;
  /** Pointer to the inbound row: provider message id or touch id. */
  messageRef: string;
  /** When the inbound message was observed. */
  repliedAt: string;
}

/**
 * An inbound message landed: close the outcome leg on every sent draft it
 * observationally answers. A relationship-level reply follows every send
 * that came before it, so each open record whose send predates the reply is
 * filled, each with its own latency. Returns how many were filled.
 */
export async function fillRepliedOutcomes(
  client: SupabaseClient,
  context: RepliedFillContext,
): Promise<number> {
  const drafts = await loadSentDrafts(client, context.organizationId, context.relationshipId);
  let filled = 0;
  for (const draft of drafts) {
    const sentAt = readDraftSend(draft.rationale)?.sentAt;
    if (!sentAt) continue;
    const dimensional = withRepliedOutcome(draft.rationale?.["dimensional"], {
      sentAt,
      repliedAt: context.repliedAt,
      channel: context.channel,
      messageRef: context.messageRef,
    });
    if (!dimensional) continue;
    if (await storeFilledOutcome(client, context.organizationId, draft, dimensional)) {
      filled += 1;
    }
  }
  return filled;
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
    return true; // Unreadable is not silence. Fill nothing rather than lie.
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
 * The daily silence pass for one workspace. Every sent draft whose
 * dimensional record still has an open outcome, whose send is thirty days
 * old, and whose relationship heard nothing inbound since, is closed as
 * `no_response_30d`. Returns how many were filled.
 */
export async function fillSilenceOutcomes(
  client: SupabaseClient,
  organizationId: string,
  now: string = new Date().toISOString(),
): Promise<number> {
  const drafts = await loadSentDrafts(client, organizationId);
  let filled = 0;
  for (const draft of drafts) {
    if (!draft.relationship_id) continue;
    const send = readDraftSend(draft.rationale);
    const sentAt = send?.sentAt;
    if (!sentAt || !silenceOutcome(sentAt, now)) continue;
    /* Cheap fillability check before any inbound query is spent. */
    const stored = draft.rationale?.["dimensional"];
    if (!stored || typeof stored !== "object") continue;
    if ((stored as Record<string, unknown>)["outcome"] != null) continue;
    if (await hasInboundAfter(client, organizationId, draft.relationship_id, sentAt)) continue;
    const dimensional = withSilenceOutcome(stored, {
      sentAt,
      now,
      channel: null,
    });
    if (!dimensional) continue;
    if (await storeFilledOutcome(client, organizationId, draft, dimensional)) {
      filled += 1;
    }
  }
  return filled;
}
