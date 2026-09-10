/**
 * Real source adapters: how a live room asks Approvals for a decision.
 *
 * These read the room's own production rows and hand Approvals a governed
 * submission through the real service, so the source key, the revision, the
 * evidence, the boundary and the idempotency path are all exercised exactly as
 * they are in the app. Nothing here fabricates an approval row, copies a
 * message into Approvals, or performs any part of the work being judged.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import { DRAFT_COLUMNS, RELATIONSHIP_COLUMNS, toDraft, toRelationship } from "@/data/supabase/comms-schema";
import type { DraftRow, RelationshipRow } from "@/data/supabase/comms-schema";
import { approvalsService, type ApprovalsContext } from "@/data/supabase/approvals-service";
import type { ApprovalRequest } from "@/domain/approvals";
import type { CommsDraft, Relationship } from "@/domain/comms";
import type { HandoffDraft } from "@/domain/comms-handoff";
import type { ID } from "@/domain/entities";

import { commsDraftSubmission, scoutRelationshipSubmission } from "./submissions";

/* ------------------------------------------------------------------ Comms */

/** The draft and the person it is addressed to, read from Comms itself. */
export async function loadCommsDraft(
  draftId: ID,
  organizationId: ID,
): Promise<{ draft: CommsDraft; relationship: Relationship }> {
  const { data: draftRow, error: draftError } = await supabase
    .from("comms_drafts")
    .select(DRAFT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", draftId)
    .maybeSingle();
  if (draftError) throw new Error(draftError.message);
  if (!draftRow) throw new Error("That draft is not in this workspace.");
  const draft = toDraft(draftRow as unknown as DraftRow);

  const { data: relationshipRow, error: relationshipError } = await supabase
    .from("comms_relationships")
    .select(RELATIONSHIP_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", draft.relationshipId)
    .maybeSingle();
  if (relationshipError) throw new Error(relationshipError.message);
  if (!relationshipRow) throw new Error("That draft has no relationship in this workspace.");

  return { draft, relationship: toRelationship(relationshipRow as unknown as RelationshipRow) };
}

/** The Gmail thread this draft continues, when Comms recorded one. */
function threadIdOf(draft: CommsDraft): string | undefined {
  const raw = draft.rationale?.["thread_id"] ?? draft.rationale?.["provider_thread_id"];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/**
 * The governed submission for a draft Comms already has in hand.
 *
 * Pure translation, no reads and no writes, so the intake hook and the
 * id-based path below build the same request from the same facts.
 */
export function commsDraftSubmissionFor(draft: CommsDraft, relationship: Relationship) {
  const reasoning =
    typeof draft.rationale?.["why"] === "string"
      ? (draft.rationale["why"] as string)
      : `Prepared in Comms as a ${draft.register.replace(/_/g, " ")} message. Intent: ${draft.intent}`;

  return commsDraftSubmission({
    draftId: draft.id,
    relationshipId: relationship.id,
    personName: relationship.fullName,
    ...(relationship.companyName ? { companyName: relationship.companyName } : {}),
    channel: "email",
    ...(draft.subject ? { subject: draft.subject } : {}),
    body: draft.body,
    reasoning,
    ...(threadIdOf(draft) ? { threadId: threadIdOf(draft)! } : {}),
    ...(relationship.lastTouchAt ? { lastContactAt: relationship.lastTouchAt } : {}),
    evidence: draft.evidence,
  });
}

/**
 * Ask a person to judge a prepared message.
 *
 * The draft, not the relationship, is the thing being judged, so the draft id
 * is the aspect: two drafts to the same person are two decisions, and the same
 * draft submitted twice is one.
 */
export async function submitCommsDraftForApproval(
  draftId: ID,
  context: ApprovalsContext,
): Promise<{ request: ApprovalRequest; draft: CommsDraft; relationship: Relationship }> {
  const { draft, relationship } = await loadCommsDraft(draftId, context.organizationId);

  if (draft.reviewState === "sending" || draft.reviewState === "sent") {
    throw new Error("Comms has already sent this draft. There is nothing left to authorise.");
  }
  if (draft.reviewState === "discarded") {
    throw new Error("That draft was discarded in Comms.");
  }

  const request = await approvalsService.submit(context, commsDraftSubmissionFor(draft, relationship));

  return { request, draft, relationship };
}


/* ------------------------------------------------------------------ Scout */

/**
 * Ask a person to judge whether a prospect is worth a relationship.
 *
 * Scout prepares the handoff brief; Approvals carries it unchanged in the
 * payload so the approved decision can be executed by Scout's own existing
 * handoff, with the same canonical prospect and person ids.
 */
export async function submitScoutHandoffForApproval(
  input: { handoff: HandoffDraft; fitScore: number; fitReasons: string[] },
  context: ApprovalsContext,
): Promise<ApprovalRequest> {
  const { handoff } = input;
  const primary = handoff.targets.find((target) => target.rank === "primary") ?? null;
  const contact = primary ?? handoff.contact;

  const submission = scoutRelationshipSubmission({
    prospectId: handoff.prospectId,
    companyName: handoff.companyName,
    ...(contact?.fullName ? { personName: contact.fullName } : {}),
    ...(contact?.roleTitle ? { roleTitle: contact.roleTitle } : {}),
    fitScore: input.fitScore,
    fitReasons: input.fitReasons,
    gaps: handoff.blockers,
    evidence: handoff.requiredContext.flatMap((item) => item.evidence).slice(0, 8),
  });

  return approvalsService.submit(context, {
    ...submission,
    payload: {
      ...(submission.payload ?? {}),
      /* Scout's brief travels with the decision, never a copy of the person. */
      handoff: handoff as unknown as Record<string, unknown>,
      contactId: primary?.personId ?? contact?.personId ?? null,
    },
  });
}
