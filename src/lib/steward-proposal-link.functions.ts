/**
 * STAGED — CAPABILITY-GATED OFF. Protected server entrypoints for explicit
 * human proposal decisions: link a pending proposal to an EXISTING task,
 * or dismiss it with a reason. Consumes the real proposal-link and
 * proposal-ledger adapters over the caller's RLS session (Trust Tai
 * backend only).
 *
 * The capability flag `STEWARD_PROPOSAL_LINKS_ENABLED` defaults to OFF and
 * must stay off until the UNAPPLIED patch
 * `docs/proposed/steward-backend/004_proposal_links.up.sql` is reviewed,
 * applied, and granted. While off, every entrypoint returns an honest
 * `unavailable` state and touches nothing.
 *
 * No auto-confirmation, no task creation from a proposal, no duplicate
 * links: the SQL enforces same-org/same-conversation identity, row-locked
 * transitions, and operation-UUID replay.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireTrustTaiAuth } from "./steward-trust-tai-auth.server";
import { createSupabaseProposalLinkRepository } from "./steward-proposal-link.supabase";
import { createSupabaseProposalLedgerRepository } from "./steward-proposal-ledger.supabase";
import {
  linkProposalToTask,
  type LinkProposalResult,
  type ProposalLink,
} from "./steward-proposal-link.server";
import type { LedgerProposal } from "./steward-proposal-ledger.server";

/** Serialized proposal DTO: evidence is typed so the server-function
    boundary can validate it (the stored column is jsonb). */
export interface SerializedProposal {
  id: string;
  organizationId: string;
  conversationId: string;
  sourceKey: string;
  kind: string;
  statement: string;
  status: "proposed" | "linked" | "dismissed";
  evidence: { label: string; url?: string; kind?: string }[];
}

function serializeProposal(proposal: LedgerProposal): SerializedProposal {
  const evidence = Array.isArray(proposal.evidence) ? proposal.evidence : [];
  return {
    id: proposal.id,
    organizationId: proposal.organizationId,
    conversationId: proposal.conversationId,
    sourceKey: proposal.sourceKey,
    kind: proposal.kind,
    statement: proposal.statement,
    status: proposal.status,
    evidence: evidence
      .filter(
        (ref): ref is { label: string; url?: string; kind?: string } =>
          !!ref &&
          typeof ref === "object" &&
          typeof (ref as { label?: unknown }).label === "string",
      )
      .map((ref) => ({
        label: ref.label,
        ...(typeof ref.url === "string" ? { url: ref.url } : {}),
        ...(typeof ref.kind === "string" ? { kind: ref.kind } : {}),
      })),
  };
}

export type ProposalLinkCapabilityState =
  { kind: "unavailable"; reason: string } | { kind: "enabled" };

/** Durable human decision from the append-only audit, for review history. */
export interface ProposalDecisionRead {
  proposalId: string | null;
  kind: "register" | "link" | "dismiss";
  reason: string | null;
  actorId: string;
  createdAt: string;
  taskId: string | null;
}

export type ProposalReviewReadState =
  | { kind: "unavailable"; reason: string }
  | {
      kind: "ready";
      proposals: SerializedProposal[];
      links: ProposalLink[];
      decisions: ProposalDecisionRead[];
    }
  | { kind: "rejected"; message: string };

export type ProposalDecisionState =
  | { kind: "unavailable"; reason: string }
  | { kind: "linked"; link: ProposalLink; replayed: boolean }
  | { kind: "dismissed"; proposal: SerializedProposal }
  | { kind: "conflict"; message: string }
  | { kind: "rejected"; message: string };

function capabilityEnabled(): boolean {
  return process.env["STEWARD_PROPOSAL_LINKS_ENABLED"] === "true";
}

const DISABLED_REASON =
  "Proposal review decisions are not available yet: the reviewed proposal-link contract is not applied. No proposal was changed.";

const meetingInputSchema = z.object({
  orgId: z.string().uuid(),
  conversationId: z.string().uuid(),
});

export const getProposalLinkCapabilityFn = createServerFn({ method: "GET" })
  .middleware([requireTrustTaiAuth])
  .handler(async (): Promise<ProposalLinkCapabilityState> => {
    return capabilityEnabled()
      ? { kind: "enabled" }
      : { kind: "unavailable", reason: DISABLED_REASON };
  });

/**
 * Read the review queue for one meeting: the ledger (with retained source
 * evidence) plus existing links, all through RLS. Read-only.
 */
export const getProposalReviewStateFn = createServerFn({ method: "GET" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) => meetingInputSchema.parse(data))
  .handler(async ({ data, context }): Promise<ProposalReviewReadState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    const ledger = createSupabaseProposalLedgerRepository(context.supabase);
    const links = createSupabaseProposalLinkRepository(context.supabase);
    try {
      const [proposals, existingLinks] = await Promise.all([
        ledger.ledgerForConversation(data.orgId, data.conversationId),
        links.linksForConversation(data.orgId, data.conversationId),
      ]);
      /* Durable decision history: linked/dismissed proposals must stay
         reviewable with their reasons and targets, never hidden. */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- proposed tables are not in generated types until the UNAPPLIED patches land
      const rls = context.supabase as any;
      const { data: decisionRows, error: decisionError } = await rls
        .from("steward_proposal_decisions")
        .select("proposal_ledger_id, kind, reason, actor_id, created_at")
        .eq("organization_id", data.orgId)
        .eq("conversation_id", data.conversationId)
        .order("created_at", { ascending: true });
      if (decisionError) {
        return { kind: "rejected", message: "the proposal decision history could not be read" };
      }
      const taskByProposal = new Map(
        existingLinks.map((link) => [link.proposalId, link.taskId] as const),
      );
      const decisions: ProposalDecisionRead[] = (decisionRows ?? []).map(
        (row: Record<string, unknown>) => {
          const proposalId = (row["proposal_ledger_id"] as string | null) ?? null;
          return {
            proposalId,
            kind: (row["kind"] as ProposalDecisionRead["kind"]) ?? "register",
            reason: (row["reason"] as string | null) ?? null,
            actorId: row["actor_id"] as string,
            createdAt: row["created_at"] as string,
            taskId: proposalId ? (taskByProposal.get(proposalId) ?? null) : null,
          };
        },
      );
      return {
        kind: "ready",
        proposals: proposals.map(serializeProposal),
        links: existingLinks,
        decisions,
      };
    } catch (error) {
      return {
        kind: "rejected",
        message:
          error instanceof Error ? error.message : "the proposal review queue could not be read",
      };
    }
  });

/** Link a pending proposal to an EXISTING task (explicit human decision). */
export const linkProposalFn = createServerFn({ method: "POST" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) =>
    meetingInputSchema
      .extend({
        proposalId: z.string().uuid(),
        taskId: z.string().uuid(),
        operationId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<ProposalDecisionState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    const repo = createSupabaseProposalLinkRepository(context.supabase);
    const result: LinkProposalResult = await linkProposalToTask(repo, {
      orgId: data.orgId,
      conversationId: data.conversationId,
      proposalId: data.proposalId,
      taskId: data.taskId,
      operationId: data.operationId,
      actorId: context.userId,
    });
    if (result.kind === "linked") {
      return { kind: "linked", link: result.link, replayed: result.replayed };
    }
    return result;
  });

/** Dismiss a pending proposal with a substantive reason (audited). */
export const dismissProposalFn = createServerFn({ method: "POST" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) =>
    meetingInputSchema
      .extend({
        proposalId: z.string().uuid(),
        reason: z.string().min(10).max(4000),
        operationId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<ProposalDecisionState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    const repo = createSupabaseProposalLedgerRepository(context.supabase);
    try {
      const proposal = await repo.dismissProposal({
        orgId: data.orgId,
        conversationId: data.conversationId,
        proposalId: data.proposalId,
        reason: data.reason,
        operationId: data.operationId,
        actorId: context.userId,
      });
      return { kind: "dismissed", proposal: serializeProposal(proposal) };
    } catch (error) {
      const code = (error as { code?: string }).code;
      const message =
        error instanceof Error ? error.message : "the proposal could not be dismissed";
      if (code === "P0002" || message.includes("operation_conflict")) {
        return {
          kind: "conflict",
          message: "this operation was already recorded with different inputs",
        };
      }
      return { kind: "rejected", message };
    }
  });
