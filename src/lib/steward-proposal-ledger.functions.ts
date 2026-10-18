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
 *
 * Extraction identity: the stored `conversations.transcript` JSONB IS the
 * full `NormalizedConversation` written by `saveConversation`
 * (sourceRef/participants/segments/sourceActionItems included). It is
 * validated strictly and passed to `extractProposals` VERBATIM so
 * `sourceKeyOf` keys match existing commitments. Nothing is fabricated —
 * no invented provider, externalId, date, or participant. An invalid
 * stored shape fails closed with an explicit rejection.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireTrustTaiAuth } from "./steward-trust-tai-auth.server";
import { extractProposals } from "@/data/steward/extract";
import type { NormalizedConversation } from "@/domain/steward";
import {
  registerExtractedProposals,
  type RegisterProposalsResult,
} from "./steward-proposal-ledger.server";
import { createSupabaseProposalLedgerRepository } from "./steward-proposal-ledger.supabase";

export type ProposalLedgerCapabilityState =
  { kind: "unavailable"; reason: string } | { kind: "enabled" };

export type ProposalLedgerSyncState =
  | { kind: "unavailable"; reason: string }
  | { kind: "registered"; added: number }
  | { kind: "transcript_changed"; message: string }
  | { kind: "rejected"; message: string }
  | { kind: "uncertain"; message: string };

function capabilityEnabled(): boolean {
  return process.env["STEWARD_PROPOSAL_LEDGER_ENABLED"] === "true";
}

const DISABLED_REASON =
  "Proposal ledger sync is not available yet: the reviewed backend contract is not applied. Nothing was read or registered.";

const PROVIDERS = new Set(["fathom", "zoom", "gmeet", "slack", "teams", "calendar", "fixture"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Strictly validate a stored transcript as the full NormalizedConversation
 * that saveConversation persisted. Returns the object AS STORED (identity
 * preserved — no reconstruction) or null when the shape is invalid.
 */
export function parseStoredConversation(value: unknown): NormalizedConversation | null {
  if (!isRecord(value)) return null;
  const sourceRef = value["sourceRef"];
  if (!isRecord(sourceRef)) return null;
  if (!isString(sourceRef["provider"]) || !PROVIDERS.has(sourceRef["provider"])) return null;
  if (!isString(sourceRef["url"])) return null;
  if (sourceRef["externalId"] !== undefined && !isString(sourceRef["externalId"])) {
    return null;
  }
  if (sourceRef["shareToken"] !== undefined && !isString(sourceRef["shareToken"])) return null;
  if (!isString(value["title"]) || !isString(value["occurredAt"])) return null;

  const participants = value["participants"];
  if (!Array.isArray(participants)) return null;
  for (const participant of participants) {
    if (!isRecord(participant) || !isString(participant["name"])) return null;
  }

  const segments = value["segments"];
  if (!Array.isArray(segments)) return null;
  for (const segment of segments) {
    if (!isRecord(segment)) return null;
    if (typeof segment["index"] !== "number") return null;
    if (!isString(segment["speaker"]) || !isString(segment["at"]) || !isString(segment["text"])) {
      return null;
    }
  }

  const actionItems = value["sourceActionItems"];
  if (!Array.isArray(actionItems)) return null;
  for (const item of actionItems) {
    if (!isRecord(item) || !isString(item["description"])) return null;
  }

  if (segments.length === 0) return null;
  return value as unknown as NormalizedConversation;
}

const syncInputSchema = z.object({
  orgId: z.string().uuid(),
  conversationId: z.string().uuid(),
  operationId: z.string().uuid(),
});

export const getProposalLedgerCapabilityFn = createServerFn({ method: "GET" })
  .middleware([requireTrustTaiAuth])
  .handler(async (): Promise<ProposalLedgerCapabilityState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    return { kind: "enabled" };
  });

/**
 * Extract proposals from the stored transcript and register them in the
 * ledger. Read + register only: no confirmation, no task writes.
 */
export const syncProposalLedgerFn = createServerFn({ method: "POST" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) => syncInputSchema.parse(data))
  .handler(async ({ data, context }): Promise<ProposalLedgerSyncState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };

    // RLS as the caller: a non-member cannot read the conversation, so a
    // non-member cannot register proposals for it either.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- conversations is not in generated types until the UNAPPLIED patches land
    const rls = context.supabase as any;
    const { data: conversation, error } = await rls
      .from("conversations")
      .select("id, organization_id, title, transcript")
      .eq("id", data.conversationId)
      .eq("organization_id", data.orgId)
      .maybeSingle();
    if (error) return { kind: "rejected", message: "the conversation could not be read" };
    if (!conversation) return { kind: "rejected", message: "conversation not found" };

    // The stored transcript IS the NormalizedConversation; validate and
    // extract from the exact stored object so source keys, participants,
    // provider action items and segment timestamps are preserved. Invalid
    // shape fails closed — never a silent empty extraction.
    const stored = parseStoredConversation(conversation.transcript);
    if (!stored) {
      return {
        kind: "rejected",
        message: "the stored transcript is missing or not a valid normalized conversation",
      };
    }
    const proposals = extractProposals(stored);

    const repo = createSupabaseProposalLedgerRepository(context.supabase);
    const result: RegisterProposalsResult = await registerExtractedProposals(repo, {
      orgId: data.orgId,
      conversationId: data.conversationId,
      operationId: data.operationId,
      // Retain the full review context: kind, statement AND the evidence
      // references the extractor produced against the stored source.
      proposals: proposals.map((p) => ({
        id: p.id,
        kind: p.kind,
        statement: p.statement,
        evidence: p.evidence,
      })),
      transcript: conversation.transcript,
      actorId: context.userId,
    });
    return result;
  });
