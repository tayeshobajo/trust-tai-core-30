/**
 * Steward's meeting workroom on real data — the data wiring.
 *
 * Reads stored conversations, person-confirmed commitments and completion
 * receipts and canonical business work, then passes them to WorkroomView.
 * Explicit Add task uses the authenticated canonical task service; bounded
 * open-page sync may store meeting imports. Proposal confirmation stays on
 * the meeting review page. Verify/reopen remain blocked pending atomic persistence.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { syncRecentMeetings } from "@/data/steward/recent-sync";
import { stewardService } from "@/data/supabase/steward-service";
import { stewardTaskState } from "@/data/supabase/steward-task-state";
import { extractProposals } from "@/data/steward/extract";
import { buildWorkroom, receiptMapFrom } from "@/domain/steward-workroom";
import type { WorkspaceIdentity } from "@/lib/workspace";

import { WorkroomMoreMenu, WorkroomView, type WorkroomBackend } from "./workroom-view";
import type { ActionOutcome, CapabilityState } from "./workroom-backend-panels";
import {
  getCanonicalRunCapability,
  requestCanonicalRunFn,
  runCanonicalRunWorkerFn,
} from "@/lib/steward-canonical-run.functions";
import { getTaskCanonicalRunsFn } from "@/lib/steward-run-state.functions";
import {
  getMeetingVerificationProjectionFn,
  getTaskVerificationStateFn,
  getVerificationCapabilityFn,
  reopenCanonicalTaskFn,
  verifyCanonicalTaskFn,
} from "@/lib/steward-verification.functions";
import {
  attestMeetingCoverageFn,
  getCoverageCapabilityFn,
  getMeetingCoverageFn,
} from "@/lib/steward-coverage.functions";
import {
  addScopeItemFn,
  amendScopeItemFn,
  getMeetingScopeFn,
  getScopeCapabilityFn,
  reinstateScopeItemFn,
  syncRequiredScopeFn,
} from "@/lib/steward-scope.functions";
import { getMeetingScoreSnapshotFn } from "@/lib/steward-score.functions";
import {
  dismissProposalFn,
  getProposalLinkCapabilityFn,
  getProposalReviewStateFn,
  linkProposalFn,
} from "@/lib/steward-proposal-link.functions";
import { syncProposalLedgerFn } from "@/lib/steward-proposal-ledger.functions";
import { TaskHistory } from "./task-history";
import { TaskEditor } from "./business-task-board";
import { AppShell } from "@/components/tt/app-shell";
import { businessWorkQuery, cmdTasks } from "@/data/supabase/cmd-tasks";
import { mayAddRequiredWork } from "@/domain/steward-required-work";
import { appendLinkedBusinessWork, workroomRowKey } from "@/domain/steward-meeting-links";
import { mayEditBoardTask, type BoardEdit, type BoardTask } from "@/domain/cmd-tasks";
import { useTaskChoices } from "@/data/steward/task-choices";

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const FOCUS_THROTTLE_MS = 60 * 1000;

/* ---------------------------------------------------------- auto sync */

function useRecentSync(identity: WorkspaceIdentity) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<{
    lastSuccessAt: string | null;
    added: number;
    refreshed: number;
    unchanged: number;
    preserved: number;
    warnings: string[];
    pendingTranscript: number;
    hasMore: boolean;
    failure: string | null;
    running: boolean;
  }>({
    lastSuccessAt: null,
    added: 0,
    refreshed: 0,
    unchanged: 0,
    preserved: 0,
    warnings: [],
    pendingTranscript: 0,
    hasMore: false,
    failure: null,
    running: false,
  });
  /* Concurrent runs are deduped inside syncRecentMeetings per org+user; this
     ref additionally prevents overlapping effect invocations. */
  const runningRef = useRef(false);
  /* Focus events can fire in bursts; throttle so a run starts at most once
     per window. */
  const lastStartRef = useRef(0);
  /* Set when the identity changes or the component unmounts, so a late
     result from the previous identity never lands in the new state. */
  const staleRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    const now = Date.now();
    if (now - lastStartRef.current < FOCUS_THROTTLE_MS) return;
    lastStartRef.current = now;
    runningRef.current = true;
    setState((s) => ({ ...s, running: true, failure: null }));
    try {
      /* Each incoming call is matched by an authoritative per-call lookup
         inside syncRecentMeetings — exact org+provider identity queries
         against the conversations table, no capped listing — so an older
         match is never treated as missing and duplicated. */
      const outcome = await syncRecentMeetings({
        organizationId: identity.organizationId,
        userId: identity.userId,
      });
      if (staleRef.current) return;
      setState((s) => ({
        /* A failed or partially written check never erases the last time a
           pull fully succeeded. */
        lastSuccessAt: outcome.checkedAt ?? s.lastSuccessAt,
        added: outcome.added,
        refreshed: outcome.refreshed,
        unchanged: outcome.unchanged,
        preserved: outcome.preserved,
        warnings: outcome.warnings,
        pendingTranscript: outcome.pendingTranscript,
        hasMore: outcome.hasMore,
        failure:
          outcome.errors.length > 0
            ? `${outcome.errors.length} call check${outcome.errors.length === 1 ? "" : "s"} failed. ${outcome.errors[0] ?? ""}`
            : null,
        running: false,
      }));
      if (outcome.added > 0 || outcome.refreshed > 0) {
        await queryClient.invalidateQueries({
          queryKey: ["steward", "workroom", "conversations", identity.organizationId],
        });
      }
    } catch (error) {
      if (staleRef.current) return;
      setState((s) => ({
        ...s,
        running: false,
        failure: error instanceof Error ? error.message : "Could not check for recent calls.",
      }));
    } finally {
      runningRef.current = false;
    }
  }, [identity.organizationId, identity.userId, queryClient]);

  useEffect(() => {
    staleRef.current = false;
    void run();
    const onFocus = () => void run();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(onFocus, SYNC_INTERVAL_MS);
    return () => {
      staleRef.current = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [run]);

  return { ...state, onRetry: () => void run() };
}

/* ---------------------------------------------------------- wiring */

export interface WorkroomSelection {
  meetingId: string | null;
  rowKey: string | null;
}

export function StewardWorkroom({
  identity,
  selection,
  onSelect,
}: {
  identity: WorkspaceIdentity;
  /** Validated URL selection from the route; reload/back restore it. */
  selection?: WorkroomSelection | undefined;
  onSelect?: ((meetingId: string | null, rowKey: string | null) => void) | undefined;
}) {
  return (
    <AppShell identity={identity} canvas="workroom">
      <StewardWorkroomContent identity={identity} selection={selection} onSelect={onSelect} />
    </AppShell>
  );
}

/**
 * Staged canonical-backend wiring for the live workroom. Every capability
 * is read from the server; while the flags are OFF each is an honest
 * unavailable state and no query touches the proposed tables (the
 * entrypoints short-circuit). Mutations only run from explicit user
 * gestures, carry stable operation UUIDs, and replay instead of
 * re-executing. Nothing here runs on mount, selection, or timers.
 */
function useStewardBackend(
  identity: WorkspaceIdentity,
  selection?: WorkroomSelection | undefined,
  /** Board task ids visible in the selected meeting — the bounded
      canonical verification projection covers exactly these. */
  meetingTaskIds: string[] = [],
): WorkroomBackend {
  const queryClient = useQueryClient();
  const org = identity.organizationId;
  const meetingId = selection?.meetingId ?? null;
  const rowKey = selection?.rowKey ?? null;
  const selectedTaskId =
    rowKey && (rowKey.startsWith("business-task:") || rowKey.startsWith("required-task:"))
      ? rowKey.slice(rowKey.indexOf(":") + 1)
      : null;

  const capabilities = useQuery({
    queryKey: ["steward", "capabilities", org],
    staleTime: 60_000,
    queryFn: async (): Promise<WorkroomBackend["capabilities"]> => {
      const [preparation, verification, coverage, scope, proposals] = await Promise.all([
        getCanonicalRunCapability(),
        getVerificationCapabilityFn(),
        getCoverageCapabilityFn(),
        getScopeCapabilityFn(),
        getProposalLinkCapabilityFn(),
      ]);
      const normalize = (value: {
        kind: string;
        reason?: string;
        message?: string;
      }): CapabilityState =>
        value.kind === "enabled" || value.kind === "actions"
          ? { kind: "enabled" }
          : {
              kind: "unavailable",
              reason:
                ("reason" in value && value.reason) ||
                ("message" in value && value.message) ||
                "This capability is not available.",
            };
      return {
        preparation: normalize(preparation),
        verification: normalize(verification),
        coverage: normalize(coverage),
        scope: normalize(scope),
        proposals: normalize(proposals),
      };
    },
  });
  const caps = capabilities.data;

  const runs = useQuery({
    queryKey: ["steward", "runs", org, selectedTaskId],
    enabled: !!selectedTaskId && caps?.preparation.kind === "enabled",
    queryFn: () => getTaskCanonicalRunsFn({ data: { orgId: org, taskId: selectedTaskId! } }),
  });
  const verification = useQuery({
    queryKey: ["steward", "verification", org, selectedTaskId],
    enabled: !!selectedTaskId && caps?.verification.kind === "enabled",
    queryFn: () => getTaskVerificationStateFn({ data: { orgId: org, taskId: selectedTaskId! } }),
  });
  const scope = useQuery({
    queryKey: ["steward", "scope", org, meetingId],
    enabled: !!meetingId && caps?.scope.kind === "enabled",
    queryFn: () => getMeetingScopeFn({ data: { orgId: org, conversationId: meetingId! } }),
  });
  const coverage = useQuery({
    queryKey: ["steward", "coverage", org, meetingId],
    enabled: !!meetingId && caps?.coverage.kind === "enabled",
    queryFn: () => getMeetingCoverageFn({ data: { orgId: org, conversationId: meetingId! } }),
  });
  const proposals = useQuery({
    queryKey: ["steward", "proposal-review", org, meetingId],
    enabled: !!meetingId && caps?.proposals.kind === "enabled",
    queryFn: () => getProposalReviewStateFn({ data: { orgId: org, conversationId: meetingId! } }),
  });
  /* The consistent one-statement score snapshot. Every score surface
     (card, nav, footer) reads this; a failed read is an explicit rejected
     state, never a silently dropped or locally recombined number. */
  const score = useQuery({
    queryKey: ["steward", "score-snapshot", org, meetingId],
    enabled: !!meetingId && caps?.scope.kind === "enabled",
    queryFn: () => getMeetingScoreSnapshotFn({ data: { orgId: org, conversationId: meetingId! } }),
  });
  /* Bounded canonical verification projection for the visible board tasks
     of the selected meeting: full-meeting counts/filters never depend on
     only the selected task's read. */
  const projectionIds = meetingTaskIds.slice().sort();
  const projection = useQuery({
    queryKey: ["steward", "verification-projection", org, meetingId, projectionIds],
    enabled: !!meetingId && caps?.verification.kind === "enabled" && projectionIds.length > 0,
    queryFn: () =>
      getMeetingVerificationProjectionFn({ data: { orgId: org, taskIds: projectionIds } }),
  });

  const unavailable: CapabilityState = {
    kind: "unavailable",
    reason: "Capability state could not be read; nothing is offered.",
  };
  const resolvedCaps: WorkroomBackend["capabilities"] = caps ?? {
    preparation: unavailable,
    verification: unavailable,
    coverage: unavailable,
    scope: unavailable,
    proposals: unavailable,
  };

  function outcomeOf(result: { kind: string; reason?: string; message?: string }): ActionOutcome {
    const message =
      ("reason" in result && result.reason) || ("message" in result && result.message) || null;
    return message ? { kind: result.kind, message } : { kind: result.kind };
  }

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ["steward"] });
  }

  /* A query that rejected after loading must surface an explicit
     rejected/retry state — never silently collapse to undefined. */
  const rejected = (message: string) => ({ kind: "rejected" as const, message });

  return {
    capabilities: resolvedCaps,
    /* Real reload for failed reads: refetch every backend query. */
    onRetryReads: () => {
      void runs.refetch();
      void verification.refetch();
      void scope.refetch();
      void coverage.refetch();
      void proposals.refetch();
      void score.refetch();
    },
    runsFor: (taskId) => {
      if (taskId !== selectedTaskId) return undefined;
      /* A failed refetch surfaces the error even with stale data cached. */
      if (runs.isError) return rejected("Run history could not be read; retry to reload it.");
      if (runs.data) {
        return runs.data.kind === "ready"
          ? {
              kind: "ready",
              truncated: runs.data.truncated,
              runs: runs.data.runs.map((run) => ({
                id: run.id,
                action: run.action,
                status: run.status,
                artifactText: run.artifactText,
                artifactDigest: run.artifactDigest,
                evidenceRefs: run.evidenceRefs,
                failureReason: run.failureReason,
                clientOperationId: run.clientOperationId,
              })),
            }
          : runs.data;
      }
      return runs.isPending && caps?.preparation.kind === "enabled"
        ? { kind: "loading" }
        : undefined;
    },
    verificationFor: (taskId) => {
      if (taskId !== selectedTaskId) return undefined;
      if (verification.isError) {
        return rejected("Verification state could not be read; retry to reload it.");
      }
      if (verification.data) {
        if (verification.data.kind !== "ready") return verification.data;
        return {
          kind: "ready",
          /* Receipt-backed verified, computed server-side with the same
             criterion as the scope SQL — raw board status alone is never
             verified. */
          verified: verification.data.read.verified === true,
          task: verification.data.read.task
            ? {
                status: verification.data.read.task.status === "complete" ? "complete" : "open",
                revision: verification.data.read.task.revision,
              }
            : null,
          receipts: verification.data.read.receipts.map((receipt) => ({
            id: receipt.id,
            kind: receipt.kind,
            note: receipt.note,
            actorId: receipt.actorId,
            createdAt: receipt.createdAt,
          })),
        };
      }
      return verification.isPending && caps?.verification.kind === "enabled"
        ? { kind: "loading" }
        : undefined;
    },
    scoreFor: (id) => {
      if (id !== meetingId) return undefined;
      /* A failed refetch must surface the error even when stale data is
         still cached — a stale 100 after a failed read is never shown. */
      if (score.isError) {
        return rejected("The consistent score snapshot could not be read; retry to reload it.");
      }
      if (score.data) return score.data;
      if (caps?.scope.kind === "enabled") {
        return score.isPending ? { kind: "loading" } : undefined;
      }
      /* Capability OFF: explicitly unavailable, never a forever-loading
         "Reading recorded scope…" state. */
      return resolvedCaps.scope.kind === "unavailable"
        ? { kind: "unavailable", reason: resolvedCaps.scope.reason }
        : undefined;
    },
    meetingState: (id) => {
      if (id !== meetingId) return undefined;
      const state: {
        scope?: import("./workroom-backend-panels").ScopeRead;
        coverage?: import("./workroom-backend-panels").CoverageRead;
        proposals?: import("./workroom-backend-panels").ProposalReviewRead;
      } = {};
      /* Capability OFF maps to an explicit unavailable state — a disabled
         query stays isPending forever and must never render as
         "Reading recorded scope…". */
      if (resolvedCaps.scope.kind === "unavailable") {
        state.scope = { kind: "unavailable", reason: resolvedCaps.scope.reason };
      } else if (scope.isError) {
        state.scope = rejected("Recorded scope could not be read; retry to reload it.");
      } else if (scope.data) {
        state.scope =
          scope.data.kind === "ready"
            ? {
                kind: "ready",
                counts: scope.data.counts,
                items: scope.data.items.map((item) => ({
                  id: item.id,
                  taskId: item.taskId,
                  classification: item.classification,
                  removedAt: item.removedAt,
                })),
              }
            : scope.data;
      } else if (scope.isPending) state.scope = { kind: "loading" };
      if (resolvedCaps.coverage.kind === "unavailable") {
        state.coverage = { kind: "unavailable", reason: resolvedCaps.coverage.reason };
      } else if (coverage.isError) {
        state.coverage = rejected("Coverage state could not be read; retry to reload it.");
      } else if (coverage.data) {
        state.coverage =
          coverage.data.kind === "ready"
            ? {
                kind: "ready",
                current: coverage.data.current,
                attestedAt: coverage.data.latest?.attestedAt ?? null,
              }
            : coverage.data;
      } else if (coverage.isPending) state.coverage = { kind: "loading" };
      if (resolvedCaps.proposals.kind === "unavailable") {
        state.proposals = { kind: "unavailable", reason: resolvedCaps.proposals.reason };
      } else if (proposals.isError) {
        state.proposals = rejected("Proposal review state could not be read; retry to reload it.");
      } else if (proposals.data) {
        state.proposals =
          proposals.data.kind === "ready"
            ? {
                kind: "ready",
                proposals: proposals.data.proposals.map((proposal) => ({
                  id: proposal.id,
                  sourceKey: proposal.sourceKey,
                  kind: proposal.kind,
                  statement: proposal.statement,
                  status: proposal.status,
                  evidence: proposal.evidence.map((ref) => ({ label: ref.label })),
                })),
                decisions: proposals.data.decisions.map((decision) => ({
                  proposalId: decision.proposalId,
                  kind: decision.kind,
                  reason: decision.reason,
                  actorId: decision.actorId,
                  createdAt: decision.createdAt,
                  taskId: decision.taskId,
                })),
              }
            : proposals.data;
      } else if (proposals.isPending) state.proposals = { kind: "loading" };
      return state;
    },
    verificationProjectionFor: (id) => {
      if (id !== meetingId) return undefined;
      if (resolvedCaps.verification.kind === "unavailable") {
        return { kind: "unavailable", reason: resolvedCaps.verification.reason };
      }
      if (projectionIds.length === 0)
        return { kind: "ready", verified: {}, unknown: [], truncated: false };
      if (projection.isError) {
        return {
          kind: "rejected",
          message: "The canonical verification projection could not be read; retry to reload it.",
        };
      }
      if (projection.data) return projection.data;
      return projection.isPending ? { kind: "loading" } : undefined;
    },
    onRemoveScopeItem: async (input) => {
      const result = await amendScopeItemFn({
        data: {
          orgId: org,
          conversationId: input.meetingId,
          itemId: input.itemId,
          reason: input.reason,
          operationId: input.operationId,
        },
      });
      await invalidate();
      return outcomeOf(result);
    },
    onReinstateScopeItem: async (input) => {
      const result = await reinstateScopeItemFn({
        data: {
          orgId: org,
          conversationId: input.meetingId,
          itemId: input.itemId,
          reason: input.reason,
          operationId: input.operationId,
        },
      });
      await invalidate();
      return outcomeOf(result);
    },
    onRequestRun: async (input) => {
      const result = await requestCanonicalRunFn({
        data: {
          orgId: org,
          taskId: input.taskId,
          action: input.actionId as never,
          operationId: input.operationId,
          inputRefs: input.inputRefs,
        },
      });
      await invalidate();
      return outcomeOf(result);
    },
    onExecuteRun: async (runId) => {
      const result = await runCanonicalRunWorkerFn({ data: { runId } });
      await invalidate();
      /* The worker envelope wraps the execute outcome; unwrap it
         faithfully so a nested "uncertain"/"failed" is never flattened
         into a generic "result". */
      const inner = result as {
        kind: string;
        result?: { kind: string; reason?: string; message?: string };
      };
      if (inner.kind === "result" && inner.result) return outcomeOf(inner.result);
      return outcomeOf(result);
    },
    onVerify: async (input) => {
      /* The expected revision comes from the immutable gesture captured at
         the first click — never re-read from refreshed state, so a retry
         after an uncertain transport replays the exact original tuple. */
      const result = await verifyCanonicalTaskFn({
        data: {
          orgId: org,
          taskId: input.taskId,
          expectedRevision: input.expectedRevision,
          operationId: input.operationId,
          note: input.note,
        },
      });
      await invalidate();
      /* Verified state changes what the business-work projection shows. */
      await queryClient.invalidateQueries({
        queryKey: businessWorkQuery(org, identity.userId).queryKey,
      });
      return outcomeOf(result);
    },
    onReopen: async (input) => {
      const result = await reopenCanonicalTaskFn({
        data: {
          orgId: org,
          taskId: input.taskId,
          expectedRevision: input.expectedRevision,
          operationId: input.operationId,
          note: input.note,
        },
      });
      await invalidate();
      await queryClient.invalidateQueries({
        queryKey: businessWorkQuery(org, identity.userId).queryKey,
      });
      return outcomeOf(result);
    },
    onAttestCoverage: async (input) => {
      /* Bound to the exact transcript hash + scope version the human
         reviewed; the server rejects drift instead of attesting an unseen
         source. */
      const result = await attestMeetingCoverageFn({
        data: {
          orgId: org,
          conversationId: input.meetingId,
          operationId: input.operationId,
          expectedTranscriptHash: input.expectedTranscriptHash,
          expectedScopeVersion: input.expectedScopeVersion,
        },
      });
      await invalidate();
      return outcomeOf(result);
    },
    onSyncProposals: async (input) => {
      const result = await syncProposalLedgerFn({
        data: { orgId: org, conversationId: input.meetingId, operationId: input.operationId },
      });
      await invalidate();
      return outcomeOf(result);
    },
    onSyncRequiredScope: async (input) => {
      const result = await syncRequiredScopeFn({
        data: { orgId: org, conversationId: input.meetingId, operationId: input.operationId },
      });
      await invalidate();
      return outcomeOf(result);
    },
    onLinkProposal: async (input) => {
      const result = await linkProposalFn({
        data: {
          orgId: org,
          conversationId: input.meetingId,
          proposalId: input.proposalId,
          taskId: input.taskId,
          operationId: input.operationId,
        },
      });
      await invalidate();
      return outcomeOf(result);
    },
    onDismissProposal: async (input) => {
      const result = await dismissProposalFn({
        data: {
          orgId: org,
          conversationId: input.meetingId,
          proposalId: input.proposalId,
          reason: input.reason,
          operationId: input.operationId,
        },
      });
      await invalidate();
      return outcomeOf(result);
    },
  };
}

function StewardWorkroomContent({
  identity,
  selection,
  onSelect,
}: {
  identity: WorkspaceIdentity;
  selection?: WorkroomSelection | undefined;
  onSelect?: ((meetingId: string | null, rowKey: string | null) => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const org = identity.organizationId;
  const business = useQuery(businessWorkQuery(org, identity.userId));
  const conversations = useQuery({
    queryKey: ["steward", "workroom", "conversations", org],
    queryFn: () => stewardService.conversations(org, 60),
  });
  const commitments = useQuery({
    queryKey: ["steward", "commitments", org],
    queryFn: () => stewardService.commitments(org),
  });
  const receipts = useQuery({
    queryKey: ["steward", "task-state", org],
    queryFn: () => stewardTaskState.list(org),
  });

  const sync = useRecentSync(identity);

  /* Canonical task editing from the workroom cells: the same TaskEditor and
     revision-checked service as the business board, never a parallel path. */
  const [editing, setEditing] = useState<{
    task: BoardTask;
    field: "owner" | "due" | "status";
  } | null>(null);
  const choices = useTaskChoices(org, { userId: identity.userId, name: identity.name });
  const meetingRead = useQuery({
    queryKey: ["steward", "meeting-options", org, identity.userId],
    queryFn: () => cmdTasks.meetingOptions(org),
    enabled: !!editing,
  });
  const taskById = useMemo(() => {
    const map = new Map((business.data?.tasks ?? []).map((task) => [task.id, task]));
    return (id: string) => map.get(id);
  }, [business.data]);
  const actor = { userId: identity.userId, role: identity.role };
  async function saveEdit(input: BoardEdit) {
    if (!editing) return;
    await cmdTasks.update(editing.task, input);
    await queryClient.invalidateQueries({
      queryKey: businessWorkQuery(org, identity.userId).queryKey,
    });
    setEditing(null);
  }

  const receiptMap = useMemo(
    () => receiptMapFrom(receipts.data, receipts.isError),
    [receipts.data, receipts.isError],
  );

  const proposalCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of conversations.data ?? []) {
      const confirmed = new Set(
        (commitments.data ?? []).filter((k) => k.conversationId === c.id).map((k) => k.sourceKey),
      );
      const proposals = extractProposals(c.conversation).filter((p) => !confirmed.has(p.id));
      map.set(c.id, proposals.length);
    }
    return map;
  }, [conversations.data, commitments.data]);

  const meetings = useMemo(() => {
    if (!conversations.data || !commitments.data) return [];
    return buildWorkroom(
      conversations.data
        .filter((c) => c.provider === "fathom")
        .map((c) => {
          const segments = Array.isArray(c.conversation?.segments) ? c.conversation.segments : [];
          return {
            id: c.id,
            title: c.title || "Untitled meeting",
            occurredAt: c.occurredAt,
            provider: c.provider,
            sourceUrl: c.sourceUrl,
            participantCount: c.participants.length,
            segmentCount: segments.length,
            lastSegmentAt: segments.length ? (segments[segments.length - 1]?.at ?? null) : null,
            /* No stored Fathom record carries a trustworthy completeness
               contract today, so coverage stays unknown. */
            coverageConfirmed: false,
          };
        }),
      commitments.data,
      receiptMap,
      proposalCounts,
    );
  }, [conversations.data, commitments.data, receiptMap, proposalCounts]);

  const commitmentById = useMemo(() => {
    const map = new Map((commitments.data ?? []).map((c) => [c.id, c]));
    return (id: string) => map.get(id);
  }, [commitments.data]);
  const linkedMeetings = useMemo(
    () =>
      appendLinkedBusinessWork(
        meetings,
        business.isError || business.isPending ? [] : (business.data?.tasks ?? []),
        org,
        typeof window === "undefined" ? undefined : window.location.origin,
      ),
    [meetings, business.data, business.isError, business.isPending, org],
  );

  /* The view defaults to the first row of the selected meeting when the
     URL carries a meeting only. The backend queries must use the SAME
     effective selection, or the initially shown task loads no state until
     the user clicks it again. */
  const effectiveSelection = useMemo<WorkroomSelection | undefined>(() => {
    if (!selection?.meetingId) return selection;
    if (selection.rowKey) return selection;
    const meeting = linkedMeetings.find((m) => m.id === selection.meetingId);
    const firstRow = meeting?.rows[0];
    if (!firstRow) return selection;
    return { meetingId: selection.meetingId, rowKey: workroomRowKey(firstRow) };
  }, [selection, linkedMeetings]);

  const selectedMeetingTaskIds = useMemo(() => {
    const meeting = linkedMeetings.find((m) => m.id === effectiveSelection?.meetingId);
    return (meeting?.rows ?? [])
      .map((r) => r.boardTask?.id)
      .filter((id): id is string => typeof id === "string");
  }, [linkedMeetings, effectiveSelection?.meetingId]);
  const backend = useStewardBackend(identity, effectiveSelection, selectedMeetingTaskIds);

  if (conversations.isPending || commitments.isPending || receipts.isPending) {
    return <p className="p-6 text-sm text-muted-foreground">Reading stored meetings…</p>;
  }
  if (conversations.isError || commitments.isError) {
    return (
      <p className="p-6 text-sm text-destructive">
        Couldn’t read stored meetings. Nothing is shown rather than a guess.
      </p>
    );
  }

  return (
    <>
      <WorkroomView
        embedded
        meetings={linkedMeetings}
        backend={backend}
        {...(selection ? { selection } : {})}
        {...(onSelect ? { onSelect } : {})}
        taskById={taskById}
        mayEditTask={(task) => mayEditBoardTask(task, actor)}
        onEditTaskField={(row, field) => {
          const task = row.boardTask;
          if (!task || !mayEditBoardTask(task, actor)) return;
          setEditing({ task, field });
        }}
        onAddRequiredTask={
          mayAddRequiredWork(identity)
            ? async (draft) => {
                const created = await cmdTasks.createRequired(identity, draft);
                /* When the durable scope contract is active, the same
                   explicit gesture records the new required task in the
                   meeting scope so the denominator grows immediately. The
                   same operation UUID traces both writes. A scope failure
                   is reported honestly: the task exists, and the explicit
                   "Sync required scope" control retries the scope side. */
                if (backend.capabilities.scope.kind === "enabled") {
                  const scopeResult = await addScopeItemFn({
                    data: {
                      orgId: org,
                      conversationId: draft.meetingId,
                      taskId: created.id,
                      classification: "manual_required",
                      operationId: draft.operationId,
                    },
                  });
                  if (scopeResult.kind !== "applied") {
                    throw new Error(
                      `The task was recorded, but adding it to the meeting scope failed: ${
                        "message" in scopeResult
                          ? scopeResult.message
                          : "reason" in scopeResult
                            ? scopeResult.reason
                            : "unknown error"
                      }. Use Sync required scope to retry.`,
                    );
                  }
                }
                await queryClient.invalidateQueries({
                  queryKey: businessWorkQuery(org, identity.userId).queryKey,
                });
                await queryClient.invalidateQueries({ queryKey: ["steward"] });
              }
            : undefined
        }
        linkedRead={{
          state: business.isPending ? "loading" : business.isError ? "error" : "ready",
          truncated: business.data?.truncated ?? false,
          onRetry: () => void business.refetch(),
        }}
        commitmentFor={commitmentById}
        receiptsFailed={receipts.isError}
        sync={sync}
        historyFor={(commitmentId) => (
          <TaskHistory
            key={`${org}:${identity.userId}:${commitmentId}`}
            organizationId={org}
            userId={identity.userId}
            commitmentId={commitmentId}
          />
        )}
        headerMenu={
          <WorkroomMoreMenu>
            {(
              [
                ["/", "Suite home"],
                ["/modules/steward/team", "Team"],
                ["/modules/steward/tasks", "All outstanding work"],
                ["/modules/steward/board", "Business task board"],
                ["/modules/steward/agents", "Agents"],
                ["/modules/steward/scouts", "Scouts"],
                ["/modules/steward/ai", "Trust Tai AI"],
                ["/modules/steward/timeline", "Timeline"],
                ["/modules/steward/memory", "Memory"],
              ] as const
            ).map(([to, label]) => (
              <Link
                key={to}
                to={to}
                className="block rounded px-3 py-2 text-sm text-foreground hover:bg-secondary"
              >
                {label}
              </Link>
            ))}
          </WorkroomMoreMenu>
        }
        accountSlot={null}
      />
      {editing ? (
        <TaskEditor
          key={`${editing.task.id}:${editing.task.revision}`}
          task={editing.task}
          scope="business"
          identity={identity}
          tasks={business.data?.tasks ?? []}
          people={choices.data?.people ?? []}
          meetingOptions={meetingRead.data?.meetings ?? []}
          meetingsLoading={meetingRead.isPending}
          meetingsError={meetingRead.isError}
          meetingsTruncated={meetingRead.data?.truncated ?? false}
          focusField={editing.field}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
        />
      ) : null}
    </>
  );
}
