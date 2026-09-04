/**
 * How prepared work reaches Approvals without anyone remembering to send it.
 *
 * Product law: an empty queue must mean nothing needs judgment, not that a
 * source room forgot to submit. So the moment a room parks work at a human
 * boundary, that room submits it here, through its own source adapter, on the
 * same idempotent source key. Submitting twice is one request; the queue never
 * doubles, and Approvals never becomes a second copy of the work.
 *
 * Nothing in this module sends, publishes or changes a room's truth.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import {
  DRAFT_COLUMNS,
  RELATIONSHIP_COLUMNS,
  toDraft,
  toRelationship,
} from "@/data/supabase/comms-schema";
import type { DraftRow, RelationshipRow } from "@/data/supabase/comms-schema";
import { approvalsService, type ApprovalsContext } from "@/data/supabase/approvals-service";
import type { ApprovalRequest } from "@/domain/approvals";
import type { CommsDraft, Relationship } from "@/domain/comms";
import type { HandoffDraft } from "@/domain/comms-handoff";

import { commsDraftSubmissionFor, submitScoutHandoffForApproval } from "./sources";

/** The Comms review state that means a person, not the agent, decides next. */
export const COMMS_REVIEW_STATE = "needs_human_review";

export interface IntakeReport {
  /** Rows the room offered for intake. */
  scanned: number;
  /** Requests that now exist in the queue, new or already there. */
  submitted: number;
  /** Rows deliberately not submitted, with the reason kept out of the queue. */
  skipped: number;
  failed: number;
  errors: string[];
}

function emptyReport(): IntakeReport {
  return { scanned: 0, submitted: 0, skipped: 0, failed: 0, errors: [] };
}

/* ------------------------------------------------------------------ Comms */

/**
 * The canonical Comms hook. A draft that needs a person becomes a decision
 * waiting in Approvals; anything else is left alone.
 */
export async function submitCommsDraftIfAwaitingHuman(
  draft: CommsDraft,
  relationship: Relationship,
  context: ApprovalsContext,
): Promise<ApprovalRequest | null> {
  if (draft.reviewState !== COMMS_REVIEW_STATE) return null;
  return approvalsService.submit(context, commsDraftSubmissionFor(draft, relationship));
}

/**
 * The same hook where a failure must not break the room that called it.
 * Comms owns the draft; a queue that is briefly behind is recoverable, a lost
 * draft is not.
 */
export async function submitCommsDraftQuietly(
  draft: CommsDraft,
  relationship: Relationship,
  context: ApprovalsContext,
): Promise<ApprovalRequest | null> {
  try {
    return await submitCommsDraftIfAwaitingHuman(draft, relationship, context);
  } catch (error) {
    console.warn("[approvals] comms draft intake deferred:", (error as Error).message);
    return null;
  }
}

/**
 * One-time catch-up for drafts that were parked before intake existed.
 *
 * Reads only real rows, submits each through the real source adapter, and
 * leans on the source key so a second run changes nothing.
 */
export async function backfillCommsApprovals(
  context: ApprovalsContext,
  options: { limit?: number } = {},
): Promise<IntakeReport> {
  const report = emptyReport();

  const { data, error } = await supabase
    .from("comms_drafts")
    .select(DRAFT_COLUMNS)
    .eq("organization_id", context.organizationId)
    .eq("review_state", COMMS_REVIEW_STATE)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 200);
  if (error) throw new Error(error.message);

  const drafts = ((data ?? []) as unknown as DraftRow[]).map(toDraft);
  report.scanned = drafts.length;
  if (drafts.length === 0) return report;

  const relationshipIds = [...new Set(drafts.map((draft) => draft.relationshipId))];
  const { data: relationshipRows, error: relationshipError } = await supabase
    .from("comms_relationships")
    .select(RELATIONSHIP_COLUMNS)
    .eq("organization_id", context.organizationId)
    .in("id", relationshipIds);
  if (relationshipError) throw new Error(relationshipError.message);

  const byId = new Map<string, Relationship>();
  for (const row of (relationshipRows ?? []) as unknown as RelationshipRow[]) {
    const relationship = toRelationship(row);
    byId.set(relationship.id, relationship);
  }

  for (const draft of drafts) {
    const relationship = byId.get(draft.relationshipId);
    if (!relationship) {
      report.skipped += 1;
      continue;
    }
    try {
      const request = await submitCommsDraftIfAwaitingHuman(draft, relationship, context);
      if (request) report.submitted += 1;
      else report.skipped += 1;
    } catch (failure) {
      report.failed += 1;
      report.errors.push((failure as Error).message);
    }
  }

  return report;
}

/* ------------------------------------------------------------------ Scout */

/**
 * A prospect Scout considers worth a relationship is a judgment, not a task:
 * the brief is ready, nothing has been handed over yet, and a person decides
 * whether this company becomes someone Trust Tai talks to.
 */
export async function submitScoutHandoffQuietly(
  input: { handoff: HandoffDraft; fitScore: number; fitReasons: string[] },
  context: ApprovalsContext,
): Promise<ApprovalRequest | null> {
  if (!input.handoff.ready) return null;
  try {
    return await submitScoutHandoffForApproval(input, context);
  } catch (error) {
    console.warn("[approvals] scout handoff intake deferred:", (error as Error).message);
    return null;
  }
}
