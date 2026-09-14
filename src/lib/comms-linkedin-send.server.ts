/**
 * Manual LinkedIn send (server only).
 *
 * Nothing here talks to LinkedIn. The member sends the message from their own
 * logged-in LinkedIn account, by hand; this module RECORDS that it happened,
 * with the same guarantees the Gmail path gives a real send:
 *
 *  - The caller is a signed-in member. Every read and write is made with the
 *    caller's own token, so RLS and the organization boundary hold. There is
 *    no service-role key anywhere on this path.
 *  - The claim machinery is reused unchanged (`decideSendClaim`, one stable
 *    idempotency key per draft), so a double click on "Mark as sent" replays
 *    the recorded outcome instead of writing a second record.
 *  - The evidence row in `comms_messages` carries a deterministic synthetic
 *    provider message id derived from the draft id, under provider
 *    `manual_linkedin`, so recording twice can only touch one row.
 *  - The stage moves forward, never back: only `new` or `ready_to_reach`
 *    becomes `reached_out`. A relationship already in conversation, or a
 *    client, keeps its stage; the send is still recorded.
 *
 * No `comms_threads` row is created. The room's timeline reads messages by
 * relationship alone and never consults the thread, and there is no provider
 * thread to reconcile against, so a thread row would be an empty promise.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSendApproval, SendRefused } from "@/lib/comms-send-authority.server";

import { supabaseFor } from "@/lib/comms-gmail.server";
import {
  decideSendClaim,
  readDraftSend,
  sendIdempotencyKey,
  SENDABLE_STATES,
  STALE_SENDING_MS,
  writeDraftSend,
  type DraftSend,
} from "@/domain/comms-send";
import {
  MANUAL_LINKEDIN_PROVIDER,
  MANUAL_LINKEDIN_SOURCE,
  manualLinkedinMessageId,
  readLinkedinRoute,
  stageAfterManualSend,
} from "@/domain/comms-routes";
import type { RelationshipStage } from "@/domain/comms";

export interface ManualLinkedinOutcome {
  draftId: string;
  state: "sent" | "sending" | "failed";
  /** True when a repeated click was answered from the record, not re-written. */
  replayed?: boolean;
  providerMessageId?: string;
  error?: string;
}

interface DraftRow {
  id: string;
  relationship_id: string;
  subject: string | null;
  body: string;
  review_state: string;
  rationale: Record<string, unknown> | null;
  updated_at: string | null;
}

/**
 * Record one draft as sent on LinkedIn by hand. Exported with the client as a
 * parameter so the integration tests can run the whole loop against the
 * in-memory Supabase stand-in; the route-facing wrapper below resolves the
 * member first and passes their own client.
 */
export async function recordLinkedinSend(
  client: SupabaseClient,
  input: { organizationId: string; userId: string; draftId: string },
): Promise<ManualLinkedinOutcome> {
  const { data: draftRow, error: draftError } = await client
    .from("comms_drafts")
    .select("id, relationship_id, subject, body, review_state, rationale, updated_at")
    .eq("id", input.draftId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (draftError) throw new Error(draftError.message);
  if (!draftRow) throw new Error("That draft is not on record.");
  const draft = draftRow as DraftRow;

  // Idempotency before anything else, exactly as the Gmail path: an accepted
  // record replays; one in flight says so; anything else claims or refuses.
  const decision = decideSendClaim({
    reviewState: draft.review_state,
    rationale: draft.rationale,
    ...(draft.updated_at ? { updatedAt: draft.updated_at } : {}),
  });
  if (decision.kind === "replay") {
    return {
      draftId: draft.id,
      state: "sent",
      replayed: true,
      ...(decision.send.providerMessageId
        ? { providerMessageId: decision.send.providerMessageId }
        : {}),
    };
  }
  if (decision.kind === "in_flight") return { draftId: draft.id, state: "sending" };
  if (decision.kind === "not_sendable") throw new Error(decision.reason);

  const { data: relationshipRow, error: relationshipError } = await client
    .from("comms_relationships")
    .select("id, full_name, stage, metadata")
    .eq("id", draft.relationship_id)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (relationshipError) throw new Error(relationshipError.message);
  const relationship = relationshipRow as {
    id: string;
    stage: string;
    metadata: Record<string, unknown> | null;
  } | null;
  if (!relationship) throw new Error("That relationship is not on record.");

  const route = readLinkedinRoute(relationship.metadata);
  if (!route) {
    throw new Error(
      "This relationship has no LinkedIn profile on record yet. Add one before marking a LinkedIn send.",
    );
  }

  // The claim: only the first attempt moves a sendable draft to `sending`.
  // Same conditional shape as Gmail, including the stale-claim reclaim.
  const attemptedAt = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS).toISOString();
  const claimSend: DraftSend = {
    state: "sending",
    idempotencyKey: sendIdempotencyKey(draft.id),
    attemptedAt,
  };
  const { data: claimedRows } = await client
    .from("comms_drafts")
    .update({
      review_state: "sending",
      rationale: writeDraftSend(draft.rationale, claimSend),
      updated_at: attemptedAt,
    })
    .eq("id", draft.id)
    .or(
      `review_state.in.(${SENDABLE_STATES.join(",")}),` +
        `and(review_state.eq.sending,updated_at.lt.${staleBefore})`,
    )
    .select("id");
  const claimed = Array.isArray(claimedRows) ? claimedRows.length > 0 : Boolean(claimedRows);
  if (!claimed) {
    // Lost the race: answer from whoever holds the claim now.
    const { data: current } = await client
      .from("comms_drafts")
      .select("review_state, rationale")
      .eq("id", draft.id)
      .maybeSingle();
    const row = current as {
      review_state: string;
      rationale: Record<string, unknown> | null;
    } | null;
    const send = readDraftSend(row?.rationale);
    if (row?.review_state === "sent" && send?.state === "sent") {
      return {
        draftId: draft.id,
        state: "sent",
        replayed: true,
        ...(send.providerMessageId ? { providerMessageId: send.providerMessageId } : {}),
      };
    }
    return { draftId: draft.id, state: "sending" };
  }

  const sentAt = new Date().toISOString();
  const providerMessageId = manualLinkedinMessageId(draft.id);

  // The evidence row. Same shape as the Gmail path's, with the transport
  // named honestly: no mailbox, no recipients, provenance saying a person
  // sent this by hand from their own LinkedIn account and where.
  const { error: messageError } = await client.from("comms_messages").upsert(
    {
      organization_id: input.organizationId,
      relationship_id: relationship.id,
      thread_id: null,
      provider: MANUAL_LINKEDIN_PROVIDER,
      provider_message_id: providerMessageId,
      provider_thread_id: null,
      direction: "outbound",
      from_email: null,
      to_emails: [],
      cc_emails: [],
      subject: draft.subject?.trim() || null,
      snippet: draft.body.replace(/\s+/g, " ").trim().slice(0, 180),
      occurred_at: sentAt,
      provenance: {
        source: MANUAL_LINKEDIN_SOURCE,
        recorded_by: input.userId,
        linkedin_url: route.url,
        sent_at: sentAt,
      },
    },
    { onConflict: "organization_id,provider,provider_message_id", ignoreDuplicates: false },
  );
  if (messageError) {
    // No evidence row means no send on record. Settle the claim as a failure
    // the same way the Gmail path does -- review_state back off `sending`
    // with the failure written into the rationale -- so the member can
    // safely click again. The stage is left exactly where it was.
    await client
      .from("comms_drafts")
      .update({
        review_state: "send_failed",
        rationale: writeDraftSend(draft.rationale, {
          ...claimSend,
          state: "failed",
          error: `The message record could not be written: ${messageError.message}`,
        }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id)
      .eq("review_state", "sending");
    return {
      draftId: draft.id,
      state: "failed",
      error: "The send could not be recorded. Nothing was saved; try marking it as sent again.",
    };
  }

  // The stage rule, applied in one write with the touch clock: forward only.
  const nextStage = stageAfterManualSend(relationship.stage as RelationshipStage);
  await client
    .from("comms_relationships")
    .update({
      last_touch_at: sentAt,
      updated_at: sentAt,
      ...(nextStage ? { stage: nextStage } : {}),
    })
    .eq("id", relationship.id)
    .eq("organization_id", input.organizationId);

  // Settle the claim: only a draft still held by this attempt may be moved.
  await client
    .from("comms_drafts")
    .update({
      review_state: "sent",
      rationale: writeDraftSend(draft.rationale, {
        ...claimSend,
        state: "sent",
        sentAt,
        providerMessageId,
      }),
      updated_at: sentAt,
    })
    .eq("id", draft.id)
    .eq("review_state", "sending");

  return { draftId: draft.id, state: "sent", providerMessageId };
}

/** An authentication answer the route can turn straight into a status code. */
export type ManualLinkedinResult =
  | { kind: "ok"; outcome: ManualLinkedinOutcome }
  | { kind: "auth"; status: 401 | 403 | 503; error: string };

/**
 * The route-facing entry: authenticate the caller, resolve their membership
 * server-side, and record the send under their own access. Auth failures are
 * answered, never thrown, so the route can keep the same honest status codes
 * as the other public handlers: 401 for a dead session, 403 only for proven
 * non-membership, and 503 when the membership read itself failed, a failed
 * read is not evidence of non-membership.
 */
export async function markDraftSentOnLinkedin(input: {
  token: string;
  organizationId: string;
  draftId: string;
}): Promise<ManualLinkedinResult> {
  const client = supabaseFor(input.token);

  const { data: userData, error: userError } = await client.auth.getUser(input.token);
  const user = userData?.user;
  if (userError || !user) {
    return {
      kind: "auth",
      status: 401,
      error: "Your session has expired. Sign in again to record this send.",
    };
  }

  const { data: membership, error: membershipError } = await client
    .from("organization_memberships")
    .select("organization_id, status")
    .eq("organization_id", input.organizationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError) {
    return {
      kind: "auth",
      status: 503,
      error: "Could not confirm your workspace access just now. Nothing was changed.",
    };
  }
  if (!membership || ((membership["status"] as string | null) ?? "active") !== "active") {
    return {
      kind: "auth",
      status: 403,
      error: "Your account is not a member of this Trust Tai workspace.",
    };
  }

  /* The same gate as every other send path. Marking a LinkedIn message as
     sent is a person's attestation, not a delivery by LinkedIn — but it still
     writes an outgoing message into the record, so it needs the same current,
     approved review of exactly these words. */
  const { data: draftRow } = await client
    .from("comms_drafts")
    .select("subject, body, relationship_id")
    .eq("id", input.draftId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  const draft = (draftRow ?? {}) as { subject?: string | null; body?: string | null };
  try {
    await requireSendApproval(input.token, {
      organizationId: input.organizationId,
      draftId: input.draftId,
      payload: {
        channel: "linkedin_manual",
        subject: draft.subject ?? null,
        body: draft.body ?? "",
        recipient: "linkedin",
        senderIdentity: `user:${user.id}`,
        attachments: [],
      },
    });
  } catch (error) {
    if (error instanceof SendRefused) {
      return { kind: "auth", status: 403, error: error.message };
    }
    throw error;
  }

  const outcome = await recordLinkedinSend(client, {
    organizationId: input.organizationId,
    userId: user.id,
    draftId: input.draftId,
  });
  return { kind: "ok", outcome };
}
