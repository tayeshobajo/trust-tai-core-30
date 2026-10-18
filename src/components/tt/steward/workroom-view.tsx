/**
 * Presentational Steward meeting workroom — the approved three-column
 * layout. Pure rendering and local UI state only: every row, receipt and
 * sync status arrives as props, so the same view serves the real route and
 * an isolated test harness with fictional data.
 *
 * Green means verified: status kept AND a valid completion receipt. The
 * score uses confirmed promises plus explicitly added required work; ordinary
 * business links add no denominator weight or verified credit. It never claims
 * transcript extraction is complete, and never reaches 100 while coverage
 * is unconfirmed or proposals await review.
 */

import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronRight,
  Circle,
  CircleDashed,
  ExternalLink,
  Flag,
  History,
  List,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  RotateCw,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { BrandLogo } from "@/components/tt/brand-logo";
import { TTButton } from "@/components/tt/primitives";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { MeetingScoreRead } from "./workroom-backend-panels";
import type { Commitment } from "@/domain/steward";
import type { BoardTask } from "@/domain/cmd-tasks";
import { displayTitleOf } from "@/domain/steward-display-title";
import { PREPARATION_ACTIONS, preparationAvailability } from "@/domain/steward-preparation-actions";
import {
  AiPreparationPanel,
  ScopeReviewPanel,
  VerificationPanel,
  type ActionOutcome,
  type CapabilityState,
  type CoverageRead,
  type ProposalReviewRead,
  type RunsRead,
  type ScopeRead,
  type VerificationRead,
} from "./workroom-backend-panels";

/**
 * Optional staged-backend wiring for the workroom. When absent (fictional
 * fixtures, or before the data layer is connected) the view renders the
 * honest staged/not-activated states exactly as before. Every capability
 * arrives from the server; while flags are OFF each carries the server's
 * unavailable reason and no mutation control is reachable.
 */
export interface WorkroomBackend {
  capabilities: {
    preparation: CapabilityState;
    verification: CapabilityState;
    coverage: CapabilityState;
    scope: CapabilityState;
    proposals: CapabilityState;
  };
  runsFor?: (taskId: string) => RunsRead | undefined;
  verificationFor?: (taskId: string) => VerificationRead | undefined;
  meetingState?: (
    meetingId: string,
  ) => { scope?: ScopeRead; coverage?: CoverageRead; proposals?: ProposalReviewRead } | undefined;
  /** Consistent one-statement score snapshot (006 patch); when present it
      is the ONLY source for the score card, nav and bottom explanation. */
  scoreFor?: (meetingId: string) => MeetingScoreRead | undefined;
  onRequestRun?: (input: {
    taskId: string;
    actionId: string;
    inputRefs: { kind: "transcript" | "task_notes"; id: string }[];
    operationId: string;
  }) => Promise<ActionOutcome>;
  onExecuteRun?: (runId: string) => Promise<ActionOutcome>;
  onVerify?: (input: {
    taskId: string;
    expectedRevision: number;
    note: string;
    operationId: string;
  }) => Promise<ActionOutcome>;
  onReopen?: (input: {
    taskId: string;
    expectedRevision: number;
    note: string;
    operationId: string;
  }) => Promise<ActionOutcome>;
  onAttestCoverage?: (input: {
    meetingId: string;
    operationId: string;
    expectedTranscriptHash: string;
    expectedScopeVersion: number;
  }) => Promise<ActionOutcome>;
  /** Real reload action for failed backend reads (runs, verification,
      scope, coverage, proposals, score). */
  onRetryReads?: () => void;
  onSyncProposals?: (input: { meetingId: string; operationId: string }) => Promise<ActionOutcome>;
  onSyncRequiredScope?: (input: {
    meetingId: string;
    operationId: string;
  }) => Promise<ActionOutcome>;
  onLinkProposal?: (input: {
    meetingId: string;
    proposalId: string;
    taskId: string;
    operationId: string;
  }) => Promise<ActionOutcome>;
  onDismissProposal?: (input: {
    meetingId: string;
    proposalId: string;
    reason: string;
    operationId: string;
  }) => Promise<ActionOutcome>;
}

/**
 * Server-derived score for one meeting, from the CONSISTENT one-statement
 * snapshot (006 patch): 100 only when the snapshot itself reports the
 * agreed scope as nonzero, fully verified, coverage current and no
 * proposals pending. Any failed/partial read yields unknown — a number is
 * never assembled from mixed or missing component reads. Returns null when
 * the staged contracts are not active and the view keeps its existing
 * local derivation.
 */
export function serverMeetingScore(
  read: MeetingScoreRead | undefined,
): { value: number | null; label: string } | null {
  if (!read || read.kind === "unavailable") return null;
  if (read.kind === "loading") return { value: null, label: "Reading recorded scope…" };
  if (read.kind === "rejected") {
    return { value: null, label: `Score unavailable — ${read.message}` };
  }
  const { denominator, verified, pendingProposals, coverageCurrent, complete } = read.snapshot;
  if (denominator === 0) return { value: 0, label: "No agreed scope recorded yet" };
  /* The SQL snapshot computes `complete` from the same statement; a
     displayed 100 is only ever that durable verdict, never a local
     recombination of separate reads. */
  if (complete) return { value: 100, label: "All agreed work verified and coverage confirmed" };
  const value = Math.min(Math.round((verified / denominator) * 100), 99);
  const blockers: string[] = [];
  if (verified < denominator) blockers.push(`${denominator - verified} not verified`);
  if (!coverageCurrent) blockers.push("coverage not confirmed");
  if (pendingProposals > 0) blockers.push(`${pendingProposals} proposals pending`);
  return { value, label: `${verified} of ${denominator} verified — ${blockers.join("; ")}` };
}
import type { WorkroomMeeting, WorkroomRow } from "@/domain/steward-workroom";
import { cn } from "@/lib/utils";
import { workroomRowKey } from "@/domain/steward-meeting-links";
import { taskContextHref } from "./task-context";
import { AddRequiredTask } from "./add-required-task";
import type { RequiredWorkDraft } from "@/domain/steward-required-work";

type RowFilter = "all" | "open" | "verified";

export interface WorkroomSyncState {
  running: boolean;
  failure: string | null;
  /** Last fully successful check; retained across later failures. */
  lastSuccessAt: string | null;
  added: number;
  refreshed: number;
  unchanged: number;
  preserved: number;
  warnings: string[];
  pendingTranscript: number;
  hasMore: boolean;
  onRetry: () => void;
}

export interface WorkroomViewProps {
  onAddRequiredTask?: ((draft: RequiredWorkDraft) => Promise<void>) | undefined;
  linkedRead?: { state: "loading" | "error" | "ready"; truncated: boolean; onRetry?: () => void };
  /** Keep suite branding/account in the enclosing AppShell. */
  embedded?: boolean;
  meetings: WorkroomMeeting[];
  commitmentFor: (id: string) => Commitment | undefined;
  /** Receipts could not be read — verified counts would be a guess. */
  receiptsFailed: boolean;
  sync: WorkroomSyncState;
  /** Compact header navigation (suite rooms, account). */
  headerMenu: ReactNode;
  accountSlot: ReactNode;
  /** Read-only selected-task history; no activity data in fictional fixtures. */
  historyFor?: (commitmentId: string) => ReactNode;
  /**
   * Controlled selection (validated URL state on the live route) so reload
   * and back/forward restore the same meeting and task. When omitted, the
   * view keeps its own selection — used by isolated fictional fixtures.
   */
  selection?: { meetingId: string | null; rowKey: string | null };
  onSelect?: (meetingId: string | null, rowKey: string | null) => void;
  /**
   * Open the canonical task editor focused on one field. Present only for
   * board rows the viewer may edit; absent means the cells stay read-only.
   */
  onEditTaskField?: ((row: WorkroomRow, field: "owner" | "due" | "status") => void) | undefined;
  /** Creator/assignee/admin check; cells are actionable only when this passes. */
  mayEditTask?: ((task: BoardTask) => boolean) | undefined;
  /** Resolve a board task by id for dependency/parent labels in the detail panel. */
  taskById?: ((id: string) => BoardTask | undefined) | undefined;
  /** Staged canonical-backend wiring; absent in fictional fixtures. */
  backend?: WorkroomBackend;
}

function useCompact(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279px)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return compact;
}

/* ---------------------------------------------------------- status pill */

function StatusPill({ row }: { row: WorkroomRow }) {
  if (row.verified) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">
        <Check aria-hidden className="size-3" /> Verified
      </span>
    );
  }
  if (row.kept) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-medium text-warning">
        <AlertCircle aria-hidden className="size-3" /> Needs verification
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground">
      <CircleDashed aria-hidden className="size-3" /> {row.status}
    </span>
  );
}

/* ---------------------------------------------------------- score card */

function ScoreCard({
  meeting,
  receiptsFailed,
  scopeUnavailable = false,
  serverScore,
}: {
  meeting: WorkroomMeeting;
  receiptsFailed: boolean;
  scopeUnavailable?: boolean;
  /** Server-derived score from durable scope/coverage/proposals, when the
      staged contracts are active. Overrides the local derivation. */
  serverScore?: { value: number | null; label: string } | null;
}) {
  /* When receipts could not be read, a numeric score would be computed from
     an empty map — a definitive-looking lie. Show it as unavailable. */
  const value = serverScore
    ? serverScore.value
    : receiptsFailed || scopeUnavailable
      ? null
      : meeting.score;
  const full = value === 100;
  return (
    <div
      aria-label="Verified agreed work"
      className={cn(
        "w-[108px] rounded-lg border border-border bg-cloud p-2 sm:w-[280px] sm:p-3",
        full ? "text-success" : "text-warning",
      )}
    >
      <div className="flex items-center gap-3">
        <svg
          className="hidden size-11 shrink-0 -rotate-90 sm:block"
          viewBox="0 0 48 48"
          aria-hidden="true"
        >
          <circle
            cx="24"
            cy="24"
            r="19"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            className="text-border"
          />
          <circle
            cx="24"
            cy="24"
            r="19"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            pathLength="100"
            strokeDasharray={`${value ?? 0} 100`}
          />
        </svg>
        <div>
          <p className="text-xl font-semibold sm:text-2xl">
            {value === null ? "—/100" : `${value}/100`}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground sm:text-xs">
            {serverScore
              ? serverScore.label
              : receiptsFailed
                ? "Verification unavailable — receipts could not be read"
                : scopeUnavailable
                  ? "Required-work scope unavailable"
                  : value === null
                    ? (() => {
                        const recorded =
                          (meeting.requiredWork?.denominator ?? meeting.agreed) +
                          (meeting.linkedWork?.total ?? 0);
                        return recorded > 0
                          ? `${recorded} recorded tasks · scope review pending`
                          : "Nothing confirmed yet";
                      })()
                    : `${meeting.done} of ${meeting.requiredWork?.denominator ?? meeting.agreed} ${meeting.requiredWork ? "required" : "agreed"} tasks verified`}
          </p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <svg
          viewBox="0 0 100 8"
          preserveAspectRatio="none"
          className="h-2 w-full rounded-full"
          aria-hidden="true"
        >
          <rect width="100" height="8" rx="4" fill="currentColor" className="text-border" />
          <rect width={value ?? 0} height="8" rx="4" fill="currentColor" />
        </svg>
        <span className="text-[10px] text-muted-foreground">
          {value === null ? "not verified yet" : `${value}%`}
        </span>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Verified agreed work. Transcript coverage:{" "}
        {meeting.coverage === "complete" ? "confirmed" : "not confirmed"}.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------- detail panel */

/**
 * Assistant execution status, separate from the accountable human. Wired:
 * the latest persisted run state. Unwired: the honest staged state.
 */
function AssistantExecutionLine({
  backend,
  taskId,
}: {
  backend?: WorkroomBackend | undefined;
  taskId: string;
}) {
  const runs = backend?.runsFor?.(taskId);
  if (backend?.capabilities.preparation.kind === "enabled" && runs?.kind === "ready") {
    const latest = runs.runs[0];
    if (latest) {
      const label =
        latest.status === "complete"
          ? "Draft prepared — awaiting the accountable person's review"
          : latest.status === "failed"
            ? latest.failureReason?.startsWith("uncertain:")
              ? "Outcome uncertain — a deliberate new request is required"
              : `Failed — ${latest.failureReason ?? "no reason recorded"}`
            : latest.status === "running"
              ? "Running"
              : "Queued";
      return <p className="text-muted-foreground">Assistant execution: {label}</p>;
    }
    return <p className="text-muted-foreground">Assistant execution: Not started</p>;
  }
  return (
    <p className="text-muted-foreground">
      Assistant execution: Not started — preparation unavailable (run bridge staged, not activated)
    </p>
  );
}

function TaskDetail({
  meeting,
  row,
  commitment,
  history,
  taskById,
  backend,
}: {
  meeting: WorkroomMeeting;
  row: WorkroomRow;
  commitment: Commitment | undefined;
  history: ReactNode;
  taskById?: ((id: string) => BoardTask | undefined) | undefined;
  backend?: WorkroomBackend | undefined;
}) {
  return (
    <div className="space-y-5 text-sm">
      <div>
        <h2 className="text-base font-semibold text-foreground">{row.what}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {row.kind === "required-task"
            ? "Manually added required work · durable task identity, not a transcript commitment"
            : row.kind === "business-task"
              ? "Linked business task · association is context, not a confirmed meeting commitment"
              : "Confirmed meeting commitment"}
        </p>
        <p className="mt-2 text-muted-foreground">
          Accountable person: {row.owner.label}
          {row.owner.verified ? "" : " · not linked to a teammate"}
        </p>
        {row.boardTask ? (
          <AssistantExecutionLine backend={backend} taskId={row.boardTask.id} />
        ) : null}
        <p className="text-muted-foreground">
          Due: {row.due.label}
          {row.due.exact ? "" : " · not an exact date"}
        </p>
      </div>

      {row.boardTask ? (
        <div className="space-y-3 border-t border-border pt-4">
          {row.kind === "required-task" ? (
            <p className="text-sm text-warning">
              Verification unavailable · zero verified credit. Recorded board status:{" "}
              {row.boardTask.status}.{" "}
              {row.boardTask.archived_at
                ? "Archived; still required."
                : "Required scope is locked."}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Recorded board status is work progress, not verified completion.
          </p>
          {backend ? (
            <VerificationPanel
              /* Keyed by meeting + canonical task: a pending operation can
                 never be retargeted onto another task after selection
                 changes — a new task mounts a fresh panel. */
              key={`${meeting.id}:${row.boardTask.id}`}
              capability={backend.capabilities.verification}
              state={backend.verificationFor?.(row.boardTask.id)}
              task={row.boardTask}
              onVerify={
                backend.onVerify
                  ? (input) => backend.onVerify!({ taskId: row.boardTask!.id, ...input })
                  : undefined
              }
              onReopen={
                backend.onReopen
                  ? (input) => backend.onReopen!({ taskId: row.boardTask!.id, ...input })
                  : undefined
              }
              onRetryReads={backend.onRetryReads}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Verified completion needs the guarded atomic review, which is not available yet.
            </p>
          )}
          <div>
            <p className="font-medium">Next action</p>
            <p className="whitespace-pre-wrap break-words">
              {row.boardTask.next_action || "No next action recorded."}
            </p>
          </div>
          {/* Recorded blockers/approvals and inputs, exactly as stored — no
              inference about availability or new scope. */}
          {row.boardTask.blocked_because ? (
            <p className="break-words">
              Blocker / awaiting approval: {row.boardTask.blocked_because}
            </p>
          ) : null}
          {!row.boardTask.context_links.length ? (
            <p className="text-xs text-muted-foreground">
              Inputs: none recorded — what this task needs has not been captured yet.
            </p>
          ) : null}
          {row.boardTask.depends_on_task_id || row.boardTask.parent_task_id ? (
            <div>
              <p className="font-medium">Dependencies</p>
              <ul className="mt-1 space-y-1 text-[13px] text-muted-foreground">
                {row.boardTask.depends_on_task_id ? (
                  <li>
                    Depends on:{" "}
                    {taskById?.(row.boardTask.depends_on_task_id)?.title ??
                      "Linked task unavailable in this view"}
                  </li>
                ) : null}
                {row.boardTask.parent_task_id ? (
                  <li>
                    Part of:{" "}
                    {taskById?.(row.boardTask.parent_task_id)?.title ??
                      "Parent unavailable in this view"}
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
          {row.boardTask.notes ? (
            <details>
              <summary className="cursor-pointer font-medium text-foreground">Task notes</summary>
              <p className="mt-1 whitespace-pre-wrap break-words">{row.boardTask.notes}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Notes are what a person recorded. A link mentioned in notes has not been opened or
                checked by Steward.
              </p>
            </details>
          ) : null}
          {row.boardTask.acceptance_criteria.length ? (
            <div>
              <p className="font-medium">Planned acceptance criteria</p>
              <ul className="list-disc pl-4">
                {row.boardTask.acceptance_criteria.map((value, index) => (
                  <li key={index}>{value}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Planned outcomes, not completion proof.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* AI help comes first: it prepares the person's review, and never
          completes, assigns or sends anything itself. */}
      <div className="rounded-lg border border-royal/25 bg-royal/5 p-3">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <Sparkles aria-hidden className="size-3.5 text-royal" /> AI help
        </p>
        {row.boardTask && backend ? (
          <AiPreparationPanel
            key={`${meeting.id}:${row.boardTask.id}`}
            capability={backend.capabilities.preparation}
            runs={backend.runsFor?.(row.boardTask.id)}
            task={row.boardTask}
            meetingId={meeting.id}
            actions={PREPARATION_ACTIONS.map((a) => ({
              id: a.id,
              label: a.label,
              summary: a.summary,
              /* review_output needs an actual stored output record as
                 input; only transcript and task notes are supported input
                 kinds today, and a URL mentioned in notes is never read. */
              ...(a.id === "review_output"
                ? {
                    disabledReason:
                      "only the meeting transcript and task notes can be preparation inputs; a recorded output link is not read or fetched, so there is no stored output to review yet.",
                  }
                : {}),
            }))}
            onRequestRun={
              backend.onRequestRun
                ? (input) => backend.onRequestRun!({ taskId: row.boardTask!.id, ...input })
                : undefined
            }
            onExecuteRun={backend.onExecuteRun}
            onRetryReads={backend.onRetryReads}
          />
        ) : row.boardTask ? (
          <>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Bounded preparation for this task. A draft is review material only — it never
              completes the task, grants verified credit, or delivers the work itself.
            </p>
            <p className="mt-2 rounded-md border border-border bg-card p-2 text-xs text-muted-foreground">
              Shared blocker: the durable run bridge for canonical tasks is staged but not
              activated, so every action below stays unavailable. The legacy runner must never
              auto-complete shared board work.
            </p>
            <ul className="mt-3 space-y-2">
              {preparationAvailability(row.boardTask).map(({ action, offered, because }) => (
                <li key={action.id} className="rounded-md border border-border bg-card p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-medium text-foreground">{action.label}</p>
                    <TTButton
                      type="button"
                      variant="secondary"
                      className="h-8 px-2 text-xs"
                      disabled
                    >
                      Unavailable
                    </TTButton>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{action.summary}</p>
                  {offered ? null : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Not offered here: {because}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Steward can read this meeting for meaning and prepare a review. It never completes,
              assigns or sends anything on its own.
            </p>
            <TTButton asChild variant="secondary" className="mt-3">
              <Link
                to="/modules/steward/meetings/$conversationId"
                params={{ conversationId: meeting.id }}
              >
                Prepare review
              </Link>
            </TTButton>
          </>
        )}
      </div>

      {row.boardTask ? (
        <details className="border-t border-border pt-4">
          <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-foreground">
            <List aria-hidden className="size-3.5" /> Inputs and audit
          </summary>
          <div className="mt-2 space-y-2 text-[13px]">
            {row.boardTask.context_links.length ? (
              <ul className="space-y-2">
                {row.boardTask.context_links.map((link, index) => {
                  const href = taskContextHref(link.url);
                  return (
                    <li key={index} className="break-words">
                      {href ? (
                        <a
                          className="text-royal underline"
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {link.label || href}
                        </a>
                      ) : (
                        <span>{link.label || "Link unavailable"}</span>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        Recorded link — Steward has not opened or checked its contents.
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-muted-foreground">No input links recorded.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Revision {row.boardTask.revision} · updated{" "}
              {row.boardTask.updated_at?.slice(0, 10) || "date unavailable"} · created by{" "}
              {row.boardTask.created_by === row.boardTask.owner_user_id
                ? "the owner"
                : "a teammate"}
              .
            </p>
          </div>
        </details>
      ) : null}

      <div className="border-t border-border pt-4">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <Check aria-hidden className="size-3.5" /> Completion evidence
        </p>
        {row.boardTask ? (
          <div className="mt-2 text-[13px]">
            <p className="whitespace-pre-wrap break-words">
              {row.boardTask.completion_evidence || "No board completion evidence recorded."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Recorded board evidence — not a verified commitment receipt.
            </p>
            {row.boardTask.completed_at ? (
              <p className="text-xs text-muted-foreground">
                Recorded {row.boardTask.completed_at} ·{" "}
                {row.boardTask.completed_by || "Actor unavailable"}
              </p>
            ) : null}
          </div>
        ) : row.receipt ? (
          <div className="mt-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-[13px]">
            <p className="text-foreground">“{row.receipt.completionNote}”</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Recorded by {row.receipt.completedBy ?? "a teammate"} ·{" "}
              {row.receipt.completedAt?.slice(0, 16).replace("T", " ")}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-muted-foreground">
            {row.kept
              ? "Marked kept, but no completion receipt with a note is recorded — it does not count as verified yet."
              : "No completion recorded."}
          </p>
        )}
      </div>

      <details className="border-t border-border pt-4">
        <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-foreground">
          <Flag aria-hidden className="size-3.5" /> Meeting source
        </summary>
        {row.boardTask ? (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-muted-foreground">
              Linked task source context is listed under Inputs and audit above. Association does
              not replace email or other recorded sources.
            </p>
          </div>
        ) : commitment && commitment.evidence.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {commitment.evidence.map((ref, index) => (
              <li
                key={index}
                className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-[13px] text-muted-foreground"
              >
                “{ref.label}”
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] text-muted-foreground">
            No source quotation was stored with this promise.
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Source quotations are what was said, not proof of completion.
        </p>
      </details>

      {history ?? (
        <details className="border-t border-border pt-4">
          <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-foreground">
            <History aria-hidden className="size-3.5" /> History
          </summary>
          <p className="mt-2 text-[13px] text-muted-foreground">
            History unavailable in this view.
          </p>
        </details>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <Link
          to="/modules/steward/meetings/$conversationId"
          params={{ conversationId: meeting.id }}
          className="text-primary underline underline-offset-4"
        >
          Review and confirm proposals in the meeting page
        </Link>
        <p className="text-xs text-muted-foreground">
          Verify and reopen controls are not available in this view yet.
        </p>
        {meeting.sourceUrl ? (
          <a
            href={meeting.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
          >
            Open in Fathom <ExternalLink aria-hidden className="size-3.5" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- view */

export function WorkroomView({
  meetings,
  embedded = false,
  commitmentFor,
  receiptsFailed,
  sync,
  headerMenu,
  accountSlot,
  historyFor,
  linkedRead,
  onAddRequiredTask,
  selection,
  onSelect,
  onEditTaskField,
  mayEditTask,
  taskById,
  backend,
}: WorkroomViewProps) {
  const viewportCompact = useCompact();
  const rootRef = useRef<HTMLDivElement>(null);
  const [canvasCompact, setCanvasCompact] = useState(true);
  useEffect(() => {
    const root = rootRef.current;
    if (!embedded || !root) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCanvasCompact(entry.contentRect.width < 1100);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [embedded]);
  const compact = embedded ? canvasCompact : viewportCompact;
  const TaskArea = embedded ? "section" : "main";
  const [localMeeting, setLocalMeeting] = useState<string | null>(null);
  const [localRow, setLocalRow] = useState<string | null>(null);
  /* Controlled (URL) selection when the route provides it; local state in
     isolated fixtures. */
  const selectedMeeting = selection ? selection.meetingId : localMeeting;
  const selectedRow = selection ? selection.rowKey : localRow;
  const [meetingQuery, setMeetingQuery] = useState("");
  const [taskQuery, setTaskQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("everyone");
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [adding, setAdding] = useState<{ id: string; title: string } | null>(null);
  const meetingTriggerRef = useRef<HTMLButtonElement>(null);
  const taskTriggerRef = useRef<HTMLButtonElement | null>(null);

  const filteredMeetings = meetings.filter((m) =>
    m.title.toLowerCase().includes(meetingQuery.trim().toLowerCase()),
  );
  const meeting = meetings.find((m) => m.id === selectedMeeting) ?? meetings[0] ?? null;

  const owners = meeting ? Array.from(new Set(meeting.rows.map((r) => r.owner.label))).sort() : [];
  const visibleRows = meeting
    ? meeting.rows.filter((r) => {
        if (
          rowFilter === "open" &&
          (r.verified || (r.kind !== "required-task" && r.boardTask?.status === "complete"))
        )
          return false;
        if (rowFilter === "verified" && !r.verified) return false;
        if (ownerFilter !== "everyone" && r.owner.label !== ownerFilter) return false;
        if (taskQuery.trim() && !r.what.toLowerCase().includes(taskQuery.trim().toLowerCase()))
          return false;
        return true;
      })
    : [];

  /* Default to the first available task so the detail panel is never blank. */
  const row =
    meeting?.rows.find((r) => workroomRowKey(r) === selectedRow) ??
    visibleRows[0] ??
    meeting?.rows[0] ??
    null;
  const rowCommitment = row && !row.boardTask ? commitmentFor(row.id) : undefined;
  const rowHistory = row && !row.boardTask ? historyFor?.(row.id) : undefined;

  function selectMeeting(id: string) {
    if (onSelect) onSelect(id, null);
    setLocalMeeting(id);
    /* Filters belong to a meeting; a stale owner or search must never hide
       the next meeting's tasks. */
    setLocalRow(null);
    setOwnerFilter("everyone");
    setTaskQuery("");
    setRowFilter("all");
    setNavOpen(false);
  }

  function pickRow(id: string) {
    if (onSelect) onSelect(meeting?.id ?? null, id);
    setLocalRow(id);
    if (compact) setDrawerOpen(true);
  }

  const syncLine = sync.running
    ? "Checking Fathom for recent calls…"
    : sync.failure
      ? `Not refreshed. ${sync.failure}`
      : sync.lastSuccessAt
        ? `Checked ${sync.lastSuccessAt.slice(11, 16)} · ${sync.added} new stored${
            sync.refreshed > 0 ? ` · ${sync.refreshed} transcript updated` : ""
          } · ${sync.unchanged} unchanged${
            sync.preserved > 0 ? ` · ${sync.preserved} changed transcript preserved` : ""
          }${
            sync.pendingTranscript > 0
              ? ` · ${sync.pendingTranscript} waiting for a transcript`
              : ""
          }${sync.hasMore ? " · recent window only — older calls exist beyond this pull" : ""}`
        : "Steward pulls recent Fathom calls while this page is open. A closed browser syncs nothing.";

  const navigation = (
    <div className="flex h-full flex-col">
      <h2 className="px-4 pt-5 text-lg font-semibold">Meetings</h2>
      <label className="mx-4 mt-3 flex h-11 items-center gap-2 rounded-md border border-border bg-card/50 px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          aria-label="Search meetings"
          placeholder="Search meetings…"
          value={meetingQuery}
          onChange={(e) => setMeetingQuery(e.target.value)}
          className="w-full min-w-0 bg-transparent text-sm outline-none"
        />
      </label>
      <nav aria-label="Stored meetings" className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {filteredMeetings.map((m) => (
          <TTButton
            key={m.id}
            variant="quiet"
            aria-pressed={meeting?.id === m.id}
            onClick={() => selectMeeting(m.id)}
            className={cn(
              "grid h-auto min-h-[72px] w-full grid-cols-[20px_minmax(0,1fr)] items-start gap-3 rounded-none border-l-2 px-4 py-3 text-left",
              meeting?.id === m.id
                ? "border-l-royal bg-royal/10 text-foreground"
                : "border-l-transparent",
            )}
          >
            <CalendarDays className={cn("mt-1", meeting?.id === m.id && "text-royal")} />
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "truncate text-sm leading-5",
                    meeting?.id === m.id ? "font-bold" : "font-semibold",
                  )}
                >
                  {m.title}
                </span>
                {meeting?.id === m.id ? (
                  <span className="shrink-0 rounded border border-royal/40 px-1 py-px text-[9px] font-semibold uppercase tracking-[0.12em] text-royal">
                    Current
                  </span>
                ) : null}
              </span>
              <span className="mt-1 flex items-center justify-between gap-1 text-xs text-muted-foreground">
                {(() => {
                  /* The consistent server snapshot, when the staged
                     contract is active, overrides the local derivation for
                     this row too — nav, card and footer never disagree. */
                  const navScore = backend?.scoreFor
                    ? serverMeetingScore(backend.scoreFor(m.id))
                    : null;
                  const pillValue = navScore
                    ? navScore.value === null
                      ? "—"
                      : `${navScore.value}/100`
                    : receiptsFailed ||
                        (linkedRead && (linkedRead.state !== "ready" || linkedRead.truncated))
                      ? "—"
                      : m.score === null
                        ? "Partial"
                        : `${m.score}/100`;
                  const pillFull = navScore
                    ? navScore.value === 100
                    : m.score === 100 &&
                      !receiptsFailed &&
                      (!linkedRead || (linkedRead.state === "ready" && !linkedRead.truncated));
                  return (
                    <>
                      <span>
                        {m.occurredAt.slice(0, 10)} ·{" "}
                        {navScore
                          ? (navScore.label ?? "score unavailable")
                          : receiptsFailed
                            ? "verification unavailable"
                            : (m.requiredWork?.denominator ?? m.agreed) === 0
                              ? "scope review pending"
                              : `${m.done} of ${m.requiredWork?.denominator ?? m.agreed} verified`}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 font-semibold",
                          pillFull ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
                        )}
                      >
                        {pillValue}
                      </span>
                    </>
                  );
                })()}
              </span>
            </span>
          </TTButton>
        ))}
        {filteredMeetings.length === 0 ? (
          <p role="status" className="px-4 py-5 text-sm text-muted-foreground">
            No meetings match.
          </p>
        ) : null}
        <Link
          to="/modules/steward/tasks"
          className="mt-2 flex min-h-12 items-center gap-3 px-4 text-sm text-foreground hover:bg-card/60"
        >
          <List aria-hidden className="size-4" />
          All outstanding work
        </Link>
      </nav>
      <div className="mx-4 border-t border-border py-4 text-xs text-muted-foreground">
        <p className="flex items-center gap-2">
          <LockKeyhole aria-hidden className="size-4" />
          Meeting review confirms proposals. Verify/reopen controls are not available here yet.
        </p>
      </div>
    </div>
  );

  const main = meeting ? (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold leading-8 sm:text-2xl">{meeting.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              {meeting.occurredAt.slice(0, 10)} · {meeting.participantCount} participants ·{" "}
              {meeting.segmentCount} transcript segments
              {meeting.lastSegmentAt ? ` to ${meeting.lastSegmentAt}` : ""}
            </span>
            {meeting.sourceUrl ? (
              <a
                href={meeting.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-royal"
              >
                <CalendarDays aria-hidden className="size-3.5" /> View meeting
              </a>
            ) : null}
          </div>
        </div>
        <ScoreCard
          meeting={meeting}
          receiptsFailed={receiptsFailed}
          scopeUnavailable={!!linkedRead && (linkedRead.state !== "ready" || linkedRead.truncated)}
          serverScore={backend?.scoreFor ? serverMeetingScore(backend.scoreFor(meeting.id)) : null}
        />
      </div>

      {backend ? (
        <details className="mt-3 rounded-md border border-border bg-card p-3">
          <summary className="cursor-pointer text-xs font-medium text-foreground">
            Scope review — coverage, recorded required work, extracted proposals
          </summary>
          <div className="mt-2">
            <ScopeReviewPanel
              /* Keyed by meeting: a pending operation can never retarget
                 onto another meeting after selection changes. */
              key={meeting.id}
              scope={backend.meetingState?.(meeting.id)?.scope}
              coverage={backend.meetingState?.(meeting.id)?.coverage}
              proposals={backend.meetingState?.(meeting.id)?.proposals}
              scopeCapability={backend.capabilities.scope}
              coverageCapability={backend.capabilities.coverage}
              proposalCapability={backend.capabilities.proposals}
              linkTargets={meeting.rows
                .filter((r) => r.boardTask)
                .map((r) => ({ id: r.boardTask!.id, title: r.boardTask!.title }))}
              /* The exact source under review, from the consistent
                 snapshot: attestation binds to this hash + version, and
                 the server rejects drift instead of attesting an unseen
                 source. Null until the snapshot has been read. */
              expectedSource={(() => {
                const read = backend.scoreFor?.(meeting.id);
                return read?.kind === "ready" && read.snapshot.transcriptHash
                  ? {
                      transcriptHash: read.snapshot.transcriptHash,
                      scopeVersion: read.snapshot.scopeVersion,
                    }
                  : null;
              })()}
              onRetryReads={backend.onRetryReads}
              onAttestCoverage={
                backend.onAttestCoverage
                  ? (input) => backend.onAttestCoverage!({ meetingId: meeting.id, ...input })
                  : undefined
              }
              onSyncProposals={
                backend.onSyncProposals
                  ? (input) => backend.onSyncProposals!({ meetingId: meeting.id, ...input })
                  : undefined
              }
              onSyncRequiredScope={
                backend.onSyncRequiredScope
                  ? (input) => backend.onSyncRequiredScope!({ meetingId: meeting.id, ...input })
                  : undefined
              }
              onLinkProposal={
                backend.onLinkProposal
                  ? (input) => backend.onLinkProposal!({ meetingId: meeting.id, ...input })
                  : undefined
              }
              onDismissProposal={
                backend.onDismissProposal
                  ? (input) => backend.onDismissProposal!({ meetingId: meeting.id, ...input })
                  : undefined
              }
            />
          </div>
        </details>
      ) : null}

      {meeting.openProposals > 0 ? (
        <Link
          to="/modules/steward/meetings/$conversationId"
          params={{ conversationId: meeting.id }}
          className="mt-3 flex h-11 w-full items-center justify-between rounded-md border border-warning/15 bg-warning/5 px-3 text-xs text-warning"
        >
          <span className="flex items-center gap-2">
            <AlertCircle aria-hidden className="size-4" />
            {meeting.openProposals} unreviewed extracted passage
            {meeting.openProposals === 1 ? "" : "s"} — not counted until a person confirms
          </span>
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      ) : null}

      {linkedRead ? (
        <div
          role={linkedRead.state === "error" ? "alert" : "status"}
          className="mt-2 text-xs text-muted-foreground"
        >
          {linkedRead.state === "loading"
            ? "Loading linked business work… Counts unavailable."
            : linkedRead.state === "error"
              ? "Linked business work unavailable. Counts and all-work completion are unknown."
              : `${meeting.linkedWork?.total ?? 0} linked business tasks · ${meeting.linkedWork?.open ?? 0} recorded open${linkedRead.truncated ? " · most recent 1,000 board records only; linked coverage incomplete" : ""}`}
          {linkedRead.state === "error" && linkedRead.onRetry ? (
            <TTButton variant="quiet" className="ml-2 h-7 text-xs" onClick={linkedRead.onRetry}>
              Retry linked work
            </TTButton>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 border-b border-border pb-2">
        {onAddRequiredTask ? (
          <TTButton
            variant="secondary"
            className="h-9 shrink-0 gap-1.5 px-2.5 text-xs"
            onClick={() => setAdding({ id: meeting.id, title: meeting.title })}
          >
            <Plus aria-hidden className="size-3.5" />
            Add task
          </TTButton>
        ) : null}
        <div
          className="flex w-full min-w-0 max-w-full overflow-x-auto xl:w-auto"
          aria-label="Task filters"
        >
          {(
            [
              [
                "all",
                `All tasks ${linkedRead && linkedRead.state !== "ready" ? "—" : meeting.rows.length}`,
              ],
              /* When receipts could not be read, open/verified counts would
                 be computed from suppressed verification — show unavailable,
                 never a stale or zero number. */
              [
                "open",
                receiptsFailed || (linkedRead && linkedRead.state !== "ready")
                  ? "Open —"
                  : `Open ${meeting.rows.filter((r) => !r.verified && (r.kind === "required-task" || r.boardTask?.status !== "complete")).length}`,
              ],
              ["verified", receiptsFailed ? "Verified —" : `Verified ${meeting.done}`],
            ] as [RowFilter, string][]
          ).map(([value, label]) => (
            <TTButton
              key={value}
              variant="quiet"
              aria-pressed={rowFilter === value}
              className={cn(
                "h-9 shrink-0 rounded-md px-2.5 text-xs",
                rowFilter === value && "bg-secondary text-royal",
              )}
              onClick={() => setRowFilter(value)}
            >
              {label}
            </TTButton>
          ))}
        </div>
        <div className="flex w-full min-w-0 gap-2 xl:w-auto xl:flex-1">
          <label className="flex h-9 min-w-[110px] flex-1 items-center gap-2 rounded-md border border-input px-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              aria-label="Search tasks"
              placeholder="Search tasks…"
              value={taskQuery}
              onChange={(e) => setTaskQuery(e.target.value)}
              className="w-full min-w-0 bg-transparent text-xs outline-none"
            />
          </label>
          <select
            aria-label="Filter by owner"
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="h-9 w-[104px] shrink-0 rounded-md border border-input bg-card px-2 text-xs"
          >
            <option value="everyone">Everyone</option>
            {owners.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="hidden grid-cols-[minmax(0,1fr)_116px_104px_92px] gap-2 border-b border-border px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground sm:grid">
        <span>Task</span>
        <span>Owner</span>
        <span>Due</span>
        <span>Status</span>
      </div>
      <div aria-label="Meeting tasks">
        {visibleRows.map((r) => {
          const key = workroomRowKey(r);
          const active = row ? workroomRowKey(row) === key : false;
          const editable =
            !!r.boardTask && !!onEditTaskField && (!mayEditTask || mayEditTask(r.boardTask));
          const title = displayTitleOf(r.what);
          const cell = (
            field: "owner" | "due" | "status",
            label: string,
            content: ReactNode,
            className?: string,
          ) =>
            editable ? (
              <button
                type="button"
                aria-label={`${label} for ${title.display}: edit`}
                title={`Edit ${label.toLowerCase()}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onEditTaskField!(r, field);
                }}
                className={cn(
                  "truncate rounded text-left text-[13px] underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 hover:text-royal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal",
                  className,
                )}
              >
                {content}
              </button>
            ) : (
              <span className={cn("truncate text-[13px]", className)}>{content}</span>
            );
          return (
            <div
              key={key}
              className={cn(
                "grid min-h-11 w-full grid-cols-[20px_minmax(0,1fr)] items-center gap-2 border-b border-border px-3 py-2 text-sm transition-colors sm:grid-cols-[20px_minmax(0,1fr)_116px_104px_92px]",
                r.verified ? "bg-success/10" : active ? "bg-secondary" : "hover:bg-secondary/40",
              )}
            >
              <button
                type="button"
                aria-pressed={active}
                aria-label={`Open details for ${title.display}`}
                onClick={(event) => {
                  taskTriggerRef.current = event.currentTarget;
                  pickRow(key);
                }}
                className="col-span-2 grid grid-cols-[20px_minmax(0,1fr)] items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal"
              >
                <span className="inline-flex">
                  {r.verified ? (
                    <Check aria-hidden className="size-4 text-success" />
                  ) : (
                    <Circle aria-hidden className="size-4 text-muted-foreground" />
                  )}
                </span>
                <span className="min-w-0">
                  <span
                    title={title.shortened ? title.full : undefined}
                    className={cn(
                      "line-clamp-2 break-words leading-5",
                      r.verified ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {title.display}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground sm:hidden">
                    <span className="truncate">{r.owner.label}</span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0">{r.due.label}</span>
                  </span>
                </span>
              </button>
              <span className="hidden sm:block">{cell("owner", "Owner", r.owner.label)}</span>
              <span className="hidden sm:block">{cell("due", "Due", r.due.label)}</span>
              <span className="col-start-2 sm:col-start-auto">
                {editable ? (
                  <button
                    type="button"
                    aria-label={`Status for ${title.display}: edit`}
                    title="Edit status"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditTaskField!(r, "status");
                    }}
                    className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal"
                  >
                    <StatusPill row={r} />
                  </button>
                ) : (
                  <StatusPill row={r} />
                )}
              </span>
            </div>
          );
        })}
        {visibleRows.length === 0 ? (
          <div role="status" className="py-10 text-center">
            <p className="font-medium">
              {linkedRead?.state === "loading"
                ? "Reading linked business work…"
                : linkedRead?.state === "error"
                  ? "Linked business work unavailable."
                  : meeting.rows.length === 0
                    ? "No promises confirmed from this meeting yet."
                    : "No tasks match this view."}
            </p>
            {meeting.rows.length > 0 ? (
              <TTButton
                variant="quiet"
                className="mt-2 text-royal"
                onClick={() => {
                  setTaskQuery("");
                  setOwnerFilter("everyone");
                  setRowFilter("all");
                }}
              >
                View all tasks
              </TTButton>
            ) : null}
          </div>
        ) : null}
      </div>

      {(() => {
        /* The consistent server snapshot, when active, is the only source
           for the footer verdict — it can never disagree with the card or
           the nav row, and a failed snapshot read is unknown, never 100. */
        const serverScore = backend?.scoreFor
          ? serverMeetingScore(backend.scoreFor(meeting.id))
          : null;
        const localFull =
          meeting.score === 100 &&
          (!linkedRead || (linkedRead.state === "ready" && !linkedRead.truncated));
        const full = serverScore ? serverScore.value === 100 : localFull;
        return (
          <footer
            aria-label="Requirements for complete meeting work"
            className={cn(
              "mt-4 flex items-start gap-3 rounded-lg border border-l-2 p-3 text-xs leading-5",
              full
                ? "border-success/20 border-l-success bg-success/5"
                : "border-warning/15 border-l-warning bg-warning/5",
            )}
          >
            <AlertCircle
              className={cn("mt-0.5 size-5 shrink-0", full ? "text-success" : "text-warning")}
            />
            <div>
              {meeting.requiredWork ? (
                <p className="mb-1 font-medium">
                  {meeting.requiredWork.total} manually required task
                  {meeting.requiredWork.total === 1 ? "" : "s"} · verification unavailable · zero
                  verified credit. Required scope remains after archive.
                </p>
              ) : null}
              {meeting.linkedWork?.open ? (
                <p className="mb-1 font-medium">
                  {meeting.linkedWork.open} linked business tasks remain recorded open, separately
                  from agreed-work verification.
                </p>
              ) : null}
              {linkedRead && (linkedRead.state !== "ready" || linkedRead.truncated) ? (
                <p className="mb-1 font-medium">
                  Linked-work coverage unavailable or incomplete; all-work completion cannot be
                  established.
                </p>
              ) : null}
              {receiptsFailed ? (
                <>
                  <p className="text-sm font-semibold">Verification unavailable</p>
                  <p className="mt-1 text-muted-foreground">
                    Completion receipts could not be read, so verified status and the path to 100
                    are unavailable rather than guessed. Nothing is shown as verified.
                  </p>
                </>
              ) : serverScore ? (
                <>
                  <p className="text-sm font-semibold">
                    {serverScore.value === null
                      ? "Score unavailable"
                      : serverScore.value === 100
                        ? "All agreed work verified"
                        : "To reach 100/100"}
                  </p>
                  <p className="mt-1 text-muted-foreground">{serverScore.label}</p>
                  {serverScore.value !== 100 ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      100 requires every confirmed promise and manually required task verified,
                      transcript coverage confirmed, and no unreviewed proposals. Work completion,
                      not a grade for people.
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold">
                    {linkedRead && (linkedRead.state !== "ready" || linkedRead.truncated)
                      ? "Required-work scope unavailable"
                      : meeting.agreed === 0 && meeting.rows.length > 0
                        ? `${meeting.rows.length} recorded task${meeting.rows.length === 1 ? "" : "s"}; scope review pending`
                        : meeting.score === 100
                          ? "All agreed work verified"
                          : "To reach 100/100"}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {meeting.agreed === 0 && meeting.rows.length > 0
                      ? "Recorded work is listed, but nothing is confirmed as agreed meeting work yet, and verification is unavailable until the guarded atomic review exists. Reaching 100 is not possible today."
                      : meeting.remark}
                  </p>
                  {meeting.score !== 100 ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      100 requires every confirmed promise and manually required task verified,
                      transcript coverage confirmed, and no unreviewed proposals. Work completion,
                      not a grade for people.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </footer>
        );
      })()}
    </>
  ) : (
    <div className="flex flex-col items-start gap-3 p-2">
      <h2 className="text-xl font-semibold sm:text-2xl">No meeting stored yet</h2>
      <p className="max-w-reading text-sm text-muted-foreground">
        {sync.running
          ? "Steward is checking the connected Fathom source for recent calls…"
          : sync.failure
            ? `Steward could not pull recent calls. ${sync.failure}`
            : "Steward checks for recent Fathom calls while this page is open. Nothing has been stored yet."}
      </p>
      <Link
        to="/modules/steward/meetings"
        className="text-sm text-primary underline underline-offset-4"
      >
        Read a call by link
      </Link>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex min-w-0 flex-col bg-card text-foreground [&_h1]:tracking-normal [&_h2]:tracking-normal [&_h3]:tracking-normal",
        embedded ? "min-h-[calc(100dvh-4rem)]" : "min-h-screen",
      )}
    >
      <header className="grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-border bg-cloud px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-4">
          {embedded ? (
            <h1 className="text-sm font-semibold">Steward</h1>
          ) : (
            <>
              <Link to="/" aria-label="Trust Tai OS home" className="flex items-center gap-4">
                <BrandLogo height={22} />
              </Link>
              <span className="hidden text-xs font-semibold text-muted-foreground sm:block">
                OS
              </span>
              <span className="hidden h-14 border-r border-border sm:block" />
              <span className="hidden text-sm text-muted-foreground sm:block">Suite</span>
              <ChevronRight aria-hidden className="hidden size-4 text-muted-foreground sm:block" />
              <h1 className="hidden text-sm font-semibold sm:block">Steward</h1>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {headerMenu}
          {embedded ? null : accountSlot}
        </div>
      </header>

      <p
        aria-live="polite"
        className="flex items-center gap-2 border-b border-border px-4 py-1.5 text-xs text-muted-foreground"
      >
        <span className="min-w-0 flex-1 truncate">{syncLine}</span>
        {sync.failure ? (
          <TTButton
            variant="quiet"
            className="h-7 shrink-0 rounded-md px-2 text-xs text-royal"
            onClick={sync.onRetry}
          >
            <RotateCw aria-hidden className="size-3.5" /> Retry
          </TTButton>
        ) : null}
      </p>

      {sync.warnings.length > 0 ? (
        <details className="border-b border-border px-4 py-1.5 text-xs text-warning">
          <summary className="cursor-pointer">
            {sync.warnings.length} sync caution{sync.warnings.length === 1 ? "" : "s"} — review
            details
          </summary>
          <ul className="mt-2 space-y-1">
            {sync.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {receiptsFailed ? (
        <p
          role="alert"
          className="border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive"
        >
          Completion receipts could not be read, so nothing is shown as verified rather than
          guessing.
        </p>
      ) : null}

      <div
        className={cn(
          "grid min-h-0 flex-1 min-w-0",
          embedded
            ? "@min-[900px]/workroom:grid-cols-[220px_minmax(0,1fr)] @min-[1100px]/workroom:grid-cols-[18%_56%_26%]"
            : "lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[18%_56%_26%]",
          !row &&
            (embedded ? "@min-[1100px]/workroom:grid-cols-[18%_82%]" : "xl:grid-cols-[18%_82%]"),
        )}
      >
        <aside
          className={cn(
            "hidden min-w-0 border-r border-border bg-cloud",
            embedded ? "@min-[900px]/workroom:block" : "lg:block",
          )}
        >
          {navigation}
        </aside>
        <TaskArea className="min-w-0 px-4 pb-5 pt-4 sm:px-6 sm:pt-5">
          <TTButton
            variant="quiet"
            ref={meetingTriggerRef}
            aria-label="Open meeting navigation"
            className={cn(
              "mb-2 h-11 rounded-md px-0 text-royal",
              embedded ? "@min-[900px]/workroom:hidden" : "lg:hidden",
            )}
            onClick={() => setNavOpen(true)}
          >
            <List aria-hidden />
            Meetings
            <ChevronRight aria-hidden />
          </TTButton>
          {main}
        </TaskArea>
        {row && meeting ? (
          <aside
            aria-label="Selected task details"
            className={cn(
              "hidden min-w-0 overflow-y-auto border-l border-border p-6",
              embedded ? "@min-[1100px]/workroom:block" : "xl:block",
            )}
          >
            <TaskDetail
              meeting={meeting}
              row={row}
              commitment={rowCommitment}
              history={rowHistory}
              taskById={taskById}
              backend={backend}
            />
          </aside>
        ) : null}
      </div>

      {/* Compact breakpoints only: meetings and task detail open as drawers.
          The desktop never mounts these, so focus is never trapped. */}
      {compact ? (
        <>
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetContent
              side="left"
              className="w-[300px] max-w-full bg-cloud p-0"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                meetingTriggerRef.current?.focus();
              }}
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Meetings</SheetTitle>
                <SheetDescription>Choose a stored meeting to see its agreed work.</SheetDescription>
              </SheetHeader>
              {navigation}
            </SheetContent>
          </Sheet>
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent
              side="bottom"
              className="max-h-[85vh] overflow-y-auto"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                taskTriggerRef.current?.focus();
              }}
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Task detail</SheetTitle>
                <SheetDescription>
                  Source evidence, completion evidence and next step for the selected task.
                </SheetDescription>
              </SheetHeader>
              {row && meeting ? (
                <TaskDetail
                  meeting={meeting}
                  row={row}
                  commitment={rowCommitment}
                  history={rowHistory}
                  taskById={taskById}
                  backend={backend}
                />
              ) : null}
            </SheetContent>
          </Sheet>
        </>
      ) : null}
      {adding && onAddRequiredTask ? (
        <AddRequiredTask
          meetingId={adding.id}
          meetingTitle={adding.title}
          onSave={onAddRequiredTask}
          onClose={() => setAdding(null)}
        />
      ) : null}
    </div>
  );
}

/** Compact header overflow menu for the live route. */
export function WorkroomMoreMenu({ children }: { children: ReactNode }) {
  return (
    <details className="relative">
      <summary
        aria-label="More Steward pages"
        className="flex size-11 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-secondary [&::-webkit-details-marker]:hidden"
      >
        <MoreHorizontal aria-hidden className="size-5" />
      </summary>
      <div className="absolute right-0 top-12 z-50 w-56 rounded-md border border-border bg-card p-1 shadow-md">
        {children}
      </div>
    </details>
  );
}
