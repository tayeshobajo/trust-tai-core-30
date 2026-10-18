/**
 * STAGED — CAPABILITY-GATED OFF. Protected server entrypoint that syncs
 * the proposal ledger for a stored conversation: it reads the canonical
 * transcript through the authenticated per-request client (RLS applies),
 * runs the REAL deterministic extractor (`extractProposals`), and
 * registers the output through the proposal-ledger adapter.
 *
 * The capability flag `STEWARD_PROPOSAL_LEDGER_ENABLED` defaults to OFF
 * and must stay off until the UNAPPLIED patches in
 * `docs/proposed/steward-backend/004_proposal_links.up.sql` are reviewed,
 * applied, and granted. While off, every entrypoint returns an explicit
 * unavailable result and touches nothing.
 *
 * Registration is idempotent re-extraction: it never resets a human's
 * linked/dismissed decision, and the SQL rejects registration against a
 * transcript that changed since extraction. Model suggestions are never
 * auto-confirmed.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractProposals } from "@/data/steward/extract";
import type { NormalizedConversation, TranscriptSegment } from "@/domain/steward";
import {
  registerExtractedProposals,
  type RegisterProposalsResult,
} from "./steward-proposal-ledger.server";
import { createSupabaseProposalLedgerRepository } from "./steward-proposal-ledger.supabase";

export type ProposalLedgerCapabilityState =
  | { kind: "unavailable"; reason: string }
  | { kind: "enabled" };

export type ProposalLedgerSyncState =
  | { kind: "unavailable"; reason: string }
  | { kind: "registered"; added: number }
  | { kind: "transcript_changed"; message: string }
  | { kind: "rejected"; message: string };

function capabilityEnabled(): boolean {
  return process.env["STEWARD_PROPOSAL_LEDGER_ENABLED"] === "true";
}

const DISABLED_REASON =
  "Proposal ledger sync is not available yet: the reviewed backend contract is not applied. Nothing was read or registered.";

/** Stored transcript JSONB: { segments: [{ speaker, text, offset }] }. */
interface StoredTranscript {
  segments?: { speaker?: string; text?: string; offset?: number }[];
}

function toNormalizedConversation(
  conversationId: string,
  title: string,
  transcript: StoredTranscript,
): NormalizedConversation {
  const segments: TranscriptSegment[] = (transcript.segments ?? []).map((segment, index) => ({
    index,
    speaker: segment.speaker ?? "Unknown",
    at: offsetToTimestamp(segment.offset ?? 0),
    text: segment.text ?? "",
  }));
  return {
    sourceRef: { provider: "fathom", externalId: conversationId, url: "" },
    title,
    occurredAt: new Date(0).toISOString(),
    participants: [],
    sourceActionItems: [],
    segments,
  };
}

function offsetToTimestamp(offsetSeconds: number): string {
  const total = Math.max(0, Math.floor(offsetSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

const syncInputSchema = z.object({
  orgId: z.string().uuid(),
  conversationId: z.string().uuid(),
  operationId: z.string().uuid(),
});

export const getProposalLedgerCapabilityFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ProposalLedgerCapabilityState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    return { kind: "enabled" };
  });

/**
 * Extract proposals from the stored transcript and register them in the
 * ledger. Read + register only: no confirmation, no task writes.
 */
export const syncProposalLedgerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => syncInputSchema.parse(data))
  .handler(async ({ data, context }): Promise<ProposalLedgerSyncState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };

    // RLS as the caller: a non-member cannot read the conversation, so a
    // non-member cannot register proposals for it either.
    const { data: conversation, error } = await context.supabase
      .from("conversations")
      .select("id, organization_id, title, transcript")
      .eq("id", data.conversationId)
      .eq("organization_id", data.orgId)
      .maybeSingle();
    if (error) return { kind: "rejected", message: "the conversation could not be read" };
    if (!conversation) return { kind: "rejected", message: "conversation not found" };

    const transcript = (conversation.transcript ?? {}) as StoredTranscript;
    if (!transcript.segments || transcript.segments.length === 0) {
      return { kind: "rejected", message: "the conversation has no stored transcript to extract from" };
    }

    const normalized = toNormalizedConversation(
      conversation.id as string,
      (conversation.title as string) ?? "Untitled call",
      transcript,
    );
    const proposals = extractProposals(normalized);

    const repo = createSupabaseProposalLedgerRepository(context.supabase);
    const result: RegisterProposalsResult = await registerExtractedProposals(repo, {
      orgId: data.orgId,
      conversationId: data.conversationId,
      operationId: data.operationId,
      proposals: proposals.map((p) => ({ id: p.id, kind: p.kind, statement: p.statement })),
      transcript: conversation.transcript,
      actorId: context.userId,
    });
    return result;
  });
