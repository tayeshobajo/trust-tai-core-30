/**
 * Workroom panels that render the STAGED canonical backend state:
 * preparation runs, atomic verification, coverage, scope and proposal
 * review. Purely presentational — every value arrives as props and every
 * action is a callback supplied by the data wiring, so the same panels
 * serve the live route and isolated fictional fixtures.
 *
 * Structural types are declared locally on purpose: the server entrypoint
 * modules import *.server.ts code that must never reach a client bundle,
 * so the view layer mirrors the small read shapes it needs instead of
 * importing them.
 *
 * Operation identity: every mutation gesture creates its operation UUID
 * ONCE and keeps it with the exact payload. A transport failure leaves the
 * outcome UNKNOWN — the panel keeps the pending operation and offers a
 * retry with the SAME id and payload (the server replays instead of
 * re-executing). A fresh UUID is generated only for a deliberate new
 * operation. User input (evidence notes, dismiss reasons, link choices) is
 * preserved across rejected/conflict/uncertain outcomes.
 *
 * While every capability flag is OFF the panels render the honest
 * unavailable state with the server-supplied reason — no task or model
 * mutation can be triggered from mount, selection, or timers.
 */

import { useCallback, useState } from "react";
import { AlertCircle, Check, RotateCw, Sparkles } from "lucide-react";

import { TTButton } from "@/components/tt/primitives";
import type { BoardTask } from "@/domain/cmd-tasks";

/* ---------------------------------------------------------- read shapes */

export type CapabilityState = { kind: "unavailable"; reason: string } | { kind: "enabled" };

export interface RunSnapshot {
  id: string;
  action: string;
  status: "queued" | "running" | "complete" | "failed";
  artifactText: string | null;
  artifactDigest: string | null;
  evidenceRefs: string[];
  failureReason: string | null;
  clientOperationId: string;
}

export type RunsRead =
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; runs: RunSnapshot[]; truncated: boolean }
  | { kind: "rejected"; message: string }
  | { kind: "loading" };

export interface ReceiptSnapshot {
  id: string;
  kind: "verify" | "reopen";
  note: string;
  actorId: string;
  createdAt: string;
}

export type VerificationRead =
  | { kind: "unavailable"; reason: string }
  | {
      kind: "ready";
      task: { status: "open" | "complete"; revision: number } | null;
      receipts: ReceiptSnapshot[];
    }
  | { kind: "rejected"; message: string }
  | { kind: "loading" };

export interface ScopeSnapshot {
  denominator: number;
  verified: number;
  pendingProposals: number;
}

export type ScopeRead =
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; counts: ScopeSnapshot }
  | { kind: "rejected"; message: string }
  | { kind: "loading" };

export type CoverageRead =
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; current: boolean; attestedAt: string | null }
  | { kind: "rejected"; message: string }
  | { kind: "loading" };

export interface ProposalSnapshot {
  id: string;
  sourceKey: string;
  kind: string;
  statement: string;
  status: "proposed" | "linked" | "dismissed";
  evidence: { label: string }[];
}

/** Durable human decision on a proposal, for the decision history. */
export interface ProposalDecisionSnapshot {
  proposalId: string | null;
  kind: "register" | "link" | "dismiss";
  reason: string | null;
  actorId: string;
  createdAt: string;
  /** Link target task id, when the decision linked a proposal. */
  taskId: string | null;
}

export type ProposalReviewRead =
  | { kind: "unavailable"; reason: string }
  | {
      kind: "ready";
      proposals: ProposalSnapshot[];
      decisions: ProposalDecisionSnapshot[];
    }
  | { kind: "rejected"; message: string }
  | { kind: "loading" };

/** Consistent one-statement meeting score snapshot (006 patch). */
export interface MeetingScoreSnapshot {
  denominator: number;
  verified: number;
  pendingProposals: number;
  coverageCurrent: boolean;
  attestedAt: string | null;
  scopeVersion: number;
  /** Current server-derived transcript hash, read in the same statement;
      the value a coverage attestation binds to. */
  transcriptHash: string | null;
  complete: boolean;
}

export type MeetingScoreRead =
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; snapshot: MeetingScoreSnapshot }
  | { kind: "rejected"; message: string }
  | { kind: "loading" };

/** Generic action outcome; the panels render kind + message only. */
export interface ActionOutcome {
  kind: string;
  message?: string;
}

/* ---------------------------------------------------------- operations */

interface PendingOperation<T> {
  operationId: string;
  payload: T;
}

/**
 * One in-flight-or-uncertain mutation attempt. The operation UUID and the
 * exact payload are created once per deliberate gesture and survive a
 * transport failure, so a retry replays the SAME operation instead of
 * re-executing. `reset` (a fresh UUID) is only for a deliberate new
 * operation after the previous one resolved.
 */
function useOperationAttempt<T>() {
  const [pending, setPending] = useState<PendingOperation<T> | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);

  const run = useCallback(
    async (
      handler: (input: T & { operationId: string }) => Promise<ActionOutcome>,
      payload: T,
      reuse: PendingOperation<T> | null,
    ) => {
      const attempt = reuse ?? { operationId: crypto.randomUUID(), payload };
      setBusy(true);
      setOutcome(null);
      try {
        const result = await handler({ ...attempt.payload, operationId: attempt.operationId });
        setOutcome(result);
        /* Resolved outcomes (success, rejection, conflict) end the
           operation. An UNCERTAIN outcome — a thrown transport failure OR
           a server-reported ambiguous result — keeps the operation pending
           for a same-id retry: the mutation may have committed, and only
           a replay of the same id can reconcile it. */
        if (result.kind === "uncertain") {
          setPending(attempt);
        } else {
          setPending(null);
        }
        return result;
      } catch (error) {
        /* Transport ambiguity: the request may have committed. Keep the
           operation id + payload and report uncertainty honestly. */
        setPending(attempt);
        const message = error instanceof Error ? error.message : "the request did not complete";
        const uncertain: ActionOutcome = {
          kind: "uncertain",
          message: `Outcome unknown — ${message}. Retry replays the same operation; it never re-executes.`,
        };
        setOutcome(uncertain);
        return uncertain;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { pending, busy, outcome, run, setOutcome };
}

function OutcomeNote({ outcome }: { outcome: ActionOutcome | null }) {
  if (!outcome) return null;
  const tone =
    outcome.kind === "uncertain" || outcome.kind === "conflict" || outcome.kind === "rejected"
      ? "text-warning"
      : "text-muted-foreground";
  return (
    <p role="status" className={`rounded-md border border-border bg-card p-2 text-xs ${tone}`}>
      {outcome.message ?? outcome.kind}
    </p>
  );
}

/** A failed READ with a real reload action — never wording alone. */
function RejectedNote({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-warning">
      <AlertCircle aria-hidden className="size-3.5" /> {message}
      {onRetry ? (
        <TTButton type="button" variant="secondary" className="h-7 px-2 text-xs" onClick={onRetry}>
          <RotateCw aria-hidden className="size-3" /> Reload
        </TTButton>
      ) : null}
    </p>
  );
}

/* ---------------------------------------------------------- AI panel */

export interface AiPreparationProps {
  capability: CapabilityState;
  runs: RunsRead | undefined;
  task: BoardTask;
  meetingId: string;
  actions: { id: string; label: string; summary: string; disabledReason?: string }[];
  onRequestRun:
    | ((input: {
        actionId: string;
        inputRefs: { kind: "transcript" | "task_notes"; id: string }[];
        operationId: string;
      }) => Promise<ActionOutcome>)
    | undefined;
  onExecuteRun: ((runId: string) => Promise<ActionOutcome>) | undefined;
  /** Real reload action for a failed run-history read. */
  onRetryReads?: (() => void) | undefined;
}

/**
 * Bounded preparation: explicit stored-input selection, a human-triggered
 * request, persisted run states with artifact preview and exact citations,
 * and deliberate rerun via a fresh operation UUID. AI output never
 * completes the task.
 */
export function AiPreparationPanel({
  capability,
  runs,
  task,
  meetingId,
  actions,
  onRequestRun,
  onExecuteRun,
  onRetryReads,
}: AiPreparationProps) {
  const enabledActions = actions.filter((action) => !action.disabledReason);
  const [selectedAction, setSelectedAction] = useState(enabledActions[0]?.id ?? "");
  const [useTranscript, setUseTranscript] = useState(true);
  const [useNotes, setUseNotes] = useState(true);
  const attempt = useOperationAttempt<{
    actionId: string;
    inputRefs: { kind: "transcript" | "task_notes"; id: string }[];
  }>();

  if (capability.kind === "unavailable") {
    return (
      <p className="mt-2 rounded-md border border-border bg-card p-2 text-xs text-muted-foreground">
        {capability.reason}
      </p>
    );
  }

  const inputRefs: { kind: "transcript" | "task_notes"; id: string }[] = [
    ...(useTranscript ? [{ kind: "transcript" as const, id: meetingId }] : []),
    ...(useNotes ? [{ kind: "task_notes" as const, id: task.id }] : []),
  ];

  async function request() {
    if (!onRequestRun || inputRefs.length === 0 || !selectedAction) return;
    await attempt.run(onRequestRun, { actionId: selectedAction, inputRefs }, null);
  }

  async function retry() {
    if (!onRequestRun || !attempt.pending) return;
    await attempt.run(onRequestRun, attempt.pending.payload, attempt.pending);
  }

  async function execute(runId: string) {
    if (!onExecuteRun) return;
    attempt.setOutcome(null);
    try {
      attempt.setOutcome(await onExecuteRun(runId));
    } catch (error) {
      attempt.setOutcome({
        kind: "uncertain",
        message: `Execution outcome unknown — ${
          error instanceof Error ? error.message : "the request did not complete"
        }. Re-read the run history before trying again; a failed reread is not proof of failure.`,
      });
    }
  }

  return (
    <div className="mt-2 space-y-3">
      <p className="text-[13px] text-muted-foreground">
        Bounded preparation for this task. A draft is review material only — it never completes the
        task, grants verified credit, or delivers the work itself.
      </p>
      <fieldset className="rounded-md border border-border bg-card p-2.5">
        <legend className="px-1 text-xs font-medium text-foreground">Stored inputs</legend>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={useTranscript}
            onChange={(e) => setUseTranscript(e.target.checked)}
          />
          Meeting transcript (stored record {meetingId.slice(0, 8)}…)
        </label>
        <label className="mt-1 flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={useNotes}
            onChange={(e) => setUseNotes(e.target.checked)}
          />
          Task notes (stored record {task.id.slice(0, 8)}…)
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          Only stored records can be inputs. A link mentioned in notes is not read or fetched.
        </p>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Preparation action"
          className="h-8 rounded-md border border-border bg-card px-2 text-xs"
          value={selectedAction}
          onChange={(e) => setSelectedAction(e.target.value)}
        >
          {enabledActions.map((action) => (
            <option key={action.id} value={action.id}>
              {action.label}
            </option>
          ))}
        </select>
        <TTButton
          type="button"
          variant="secondary"
          className="h-8 px-2 text-xs"
          disabled={attempt.busy || inputRefs.length === 0 || !onRequestRun || !selectedAction}
          onClick={() => void request()}
        >
          <Sparkles aria-hidden className="size-3.5" /> Request preparation
        </TTButton>
      </div>
      {actions
        .filter((action) => action.disabledReason)
        .map((action) => (
          <p key={action.id} className="text-xs text-muted-foreground">
            {action.label}: not offered — {action.disabledReason}
          </p>
        ))}
      <OutcomeNote outcome={attempt.outcome} />
      {attempt.pending ? (
        <TTButton
          type="button"
          variant="secondary"
          className="h-8 px-2 text-xs"
          disabled={attempt.busy}
          onClick={() => void retry()}
        >
          <RotateCw aria-hidden className="size-3.5" /> Retry same operation
        </TTButton>
      ) : null}
      <RunHistory runs={runs} busy={attempt.busy} onExecute={execute} onRetry={onRetryReads} />
    </div>
  );
}

function RunHistory({
  runs,
  busy,
  onExecute,
  onRetry,
}: {
  runs: RunsRead | undefined;
  busy: boolean;
  onExecute: (runId: string) => Promise<void>;
  onRetry?: (() => void) | undefined;
}) {
  if (!runs || runs.kind === "loading") {
    return <p className="text-xs text-muted-foreground">Reading run history…</p>;
  }
  if (runs.kind === "rejected") {
    return <RejectedNote message={runs.message} onRetry={onRetry} />;
  }
  if (runs.kind === "unavailable") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-warning">
        <AlertCircle aria-hidden className="size-3.5" />
        {runs.reason}
      </p>
    );
  }
  if (runs.runs.length === 0) {
    return <p className="text-xs text-muted-foreground">No preparation runs recorded yet.</p>;
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {runs.runs.map((run) => (
          <li key={run.id} className="rounded-md border border-border bg-card p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-medium text-foreground">
                {run.action} ·{" "}
                {run.status === "failed" && run.failureReason?.startsWith("uncertain:")
                  ? "uncertain"
                  : run.status}
              </p>
              {run.status === "queued" ? (
                <TTButton
                  type="button"
                  variant="secondary"
                  className="h-8 px-2 text-xs"
                  disabled={busy}
                  onClick={() => void onExecute(run.id)}
                >
                  <RotateCw aria-hidden className="size-3.5" /> Run now
                </TTButton>
              ) : null}
              {run.status === "running" ? (
                <span className="text-xs text-muted-foreground">running…</span>
              ) : null}
            </div>
            {run.status === "failed" ? (
              <p className="mt-1 text-xs text-warning">
                {run.failureReason ?? "Failed"} — a deliberate rerun needs a new request.
              </p>
            ) : null}
            {run.artifactText ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs font-medium text-foreground">
                  Draft artifact (review material, not delivery)
                </summary>
                <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-muted-foreground">
                  {run.artifactText}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cited inputs: {run.evidenceRefs.join(", ") || "none recorded"} · digest{" "}
                  {run.artifactDigest?.slice(0, 12) ?? "unavailable"}…
                </p>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
      {runs.truncated ? (
        <p className="text-xs text-muted-foreground">
          Showing the 20 most recent runs; older history exists and is retained, just not listed
          here.
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------- verification */

export interface VerificationPanelProps {
  capability: CapabilityState;
  state: VerificationRead | undefined;
  task: BoardTask;
  onVerify:
    | ((input: {
        taskId: string;
        expectedRevision: number;
        note: string;
        operationId: string;
      }) => Promise<ActionOutcome>)
    | undefined;
  onReopen:
    | ((input: {
        taskId: string;
        expectedRevision: number;
        note: string;
        operationId: string;
      }) => Promise<ActionOutcome>)
    | undefined;
  /** Real reload action for a failed verification-state read. */
  onRetryReads?: (() => void) | undefined;
}

/**
 * The immutable gesture tuple: action kind, task identity, the revision
 * the human reviewed and the exact note are captured ONCE at the first
 * click. A retry after an uncertain transport replays this exact tuple —
 * never a handler or revision re-derived from refreshed state, so a
 * background refetch can never turn a verify retry into a reopen.
 */
interface VerificationGesture {
  kind: "verify" | "reopen";
  taskId: string;
  expectedRevision: number;
  note: string;
}

/**
 * Evidence review: verify with a substantive note against the expected
 * revision, reopen with a reason. Receipts and audit history are durable;
 * board "Delivered" status alone never counts. Verify and reopen receipts
 * render distinctly — a reopen is never styled as proof.
 */
export function VerificationPanel({
  capability,
  state,
  task,
  onVerify,
  onReopen,
  onRetryReads,
}: VerificationPanelProps) {
  const [note, setNote] = useState("");
  const attempt = useOperationAttempt<VerificationGesture>();

  if (capability.kind === "unavailable") {
    return <p className="mt-2 text-xs text-muted-foreground">{capability.reason}</p>;
  }

  const verified = state?.kind === "ready" && state.task?.status === "complete";
  const currentRevision =
    state?.kind === "ready" && state.task ? state.task.revision : task.revision;

  function dispatch(gesture: VerificationGesture, reuse: typeof attempt.pending) {
    /* The handler is chosen from the STORED gesture kind, never from the
       current verified status — a retry after a successful-but-uncertain
       verify must replay the verify, not become a reopen. */
    const handler = gesture.kind === "reopen" ? onReopen : onVerify;
    if (!handler) return Promise.resolve({ kind: "rejected" as const, message: "unavailable" });
    return attempt.run(handler, gesture, reuse);
  }

  async function act() {
    /* A new deliberate action is blocked while an operation's outcome is
       unknown: reconcile (retry) the pending operation first, so two
       different gestures can never share one identity or race. */
    if (attempt.pending) return;
    const trimmed = note.trim();
    if (trimmed.length < 10) return;
    const gesture: VerificationGesture = {
      kind: verified ? "reopen" : "verify",
      taskId: task.id,
      expectedRevision: currentRevision,
      note: trimmed,
    };
    const result = await dispatch(gesture, null);
    /* The note is cleared only on a resolved success; rejected, conflict
       and uncertain outcomes keep the user's words for correction/retry. */
    if (result.kind === "verified" || result.kind === "reopened") setNote("");
  }

  async function retry() {
    /* Replays the EXACT original tuple — kind, task, revision and note as
       first captured — regardless of refreshed state or edits to the note
       field since. */
    if (!attempt.pending) return;
    const result = await dispatch(attempt.pending.payload, attempt.pending);
    if (result.kind === "verified" || result.kind === "reopened") setNote("");
  }

  return (
    <div className="mt-2 space-y-2 text-[13px]">
      {state?.kind === "ready" && state.receipts.length > 0 ? (
        <ul className="space-y-1">
          {state.receipts.map((receipt) => (
            <li
              key={receipt.id}
              className={
                receipt.kind === "verify"
                  ? "rounded-md border border-success/30 bg-success/5 px-3 py-2"
                  : "rounded-md border border-warning/40 bg-warning/5 px-3 py-2"
              }
            >
              <p className="text-foreground">“{receipt.note}”</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {receipt.kind === "verify" ? "Verified" : "Reopened"} · durable receipt ·{" "}
                {receipt.createdAt.slice(0, 16).replace("T", " ")} · actor{" "}
                {receipt.actorId.slice(0, 8)}…
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {state?.kind === "rejected" ? (
        <RejectedNote message={state.message} onRetry={onRetryReads} />
      ) : null}
      <label className="block">
        <span className="text-xs font-medium text-foreground">
          {verified ? "Reopen reason" : "Completion evidence note"}
        </span>
        <textarea
          className="mt-1 w-full rounded-md border border-border bg-card p-2 text-sm"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            verified
              ? "Why is this no longer verified? (at least 10 characters)"
              : "What concretely proves this is done? (at least 10 characters)"
          }
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {verified ? (
          <TTButton
            type="button"
            variant="secondary"
            className="h-8 px-2 text-xs"
            disabled={attempt.busy || !!attempt.pending || note.trim().length < 10 || !onReopen}
            onClick={() => void act()}
          >
            Reopen (history preserved)
          </TTButton>
        ) : (
          <TTButton
            type="button"
            variant="secondary"
            className="h-8 px-2 text-xs"
            disabled={attempt.busy || !!attempt.pending || note.trim().length < 10 || !onVerify}
            onClick={() => void act()}
          >
            <Check aria-hidden className="size-3.5" /> Verify at revision {currentRevision}
          </TTButton>
        )}
        {attempt.pending ? (
          <TTButton
            type="button"
            variant="secondary"
            className="h-8 px-2 text-xs"
            disabled={attempt.busy}
            onClick={() => void retry()}
          >
            <RotateCw aria-hidden className="size-3.5" /> Retry same operation
          </TTButton>
        ) : null}
      </div>
      {attempt.pending ? (
        <p className="text-xs text-warning">
          One operation’s outcome is unknown. Retry replays the exact original{" "}
          {attempt.pending.payload.kind} (task …{attempt.pending.payload.taskId.slice(-8)}, revision{" "}
          {attempt.pending.payload.expectedRevision}); a new action stays blocked until it resolves.
        </p>
      ) : null}
      <OutcomeNote outcome={attempt.outcome} />
    </div>
  );
}

/* ---------------------------------------------------------- scope review */

export interface ScopeReviewPanelProps {
  scope: ScopeRead | undefined;
  coverage: CoverageRead | undefined;
  proposals: ProposalReviewRead | undefined;
  scopeCapability: CapabilityState;
  coverageCapability: CapabilityState;
  proposalCapability: CapabilityState;
  linkTargets: { id: string; title: string }[];
  /**
   * The exact source the human reviewed: current transcript hash and
   * durable scope version from the consistent score snapshot. Attestation
   * is bound to these — if the source changed since the review, the
   * server rejects the attestation instead of attesting an unseen
   * transcript. Null when the snapshot has not been read; attestation is
   * then not offered.
   */
  expectedSource: { transcriptHash: string; scopeVersion: number } | null;
  onAttestCoverage:
    | ((input: {
        operationId: string;
        expectedTranscriptHash: string;
        expectedScopeVersion: number;
      }) => Promise<ActionOutcome>)
    | undefined;
  onSyncProposals: ((input: { operationId: string }) => Promise<ActionOutcome>) | undefined;
  /** Explicit durable sync of recorded required tasks into meeting scope. */
  onSyncRequiredScope: ((input: { operationId: string }) => Promise<ActionOutcome>) | undefined;
  onLinkProposal:
    | ((input: {
        proposalId: string;
        taskId: string;
        operationId: string;
      }) => Promise<ActionOutcome>)
    | undefined;
  onDismissProposal:
    | ((input: {
        proposalId: string;
        reason: string;
        operationId: string;
      }) => Promise<ActionOutcome>)
    | undefined;
  /** Real reload action for failed scope/coverage/proposal reads. */
  onRetryReads?: (() => void) | undefined;
}

/**
 * Meeting scope review: explicit extraction registration, the pending
 * proposal list with source evidence, human link-to-existing-task or
 * reasoned dismiss, explicit required-scope sync, and explicit coverage
 * attestation. Nothing here auto-confirms; a link alone is not agreement.
 * Linked/dismissed proposals stay visible in the decision history with
 * their reasons and targets — decisions never vanish from review.
 */
/** The simple one-click operations, tagged so a retry replays the exact
 *  original action — never whichever button happens to be rendered. */
type SimpleAction = "register" | "attest" | "sync";
/* Discriminated: an attestation always carries the exact source binding
   captured at the click; the other simple operations never do. */
type SimpleGesture =
  | {
      action: "attest";
      expectedTranscriptHash: string;
      expectedScopeVersion: number;
    }
  | { action: "register" | "sync" };

export function ScopeReviewPanel({
  scope,
  coverage,
  proposals,
  scopeCapability,
  coverageCapability,
  proposalCapability,
  linkTargets,
  expectedSource,
  onAttestCoverage,
  onSyncProposals,
  onSyncRequiredScope,
  onLinkProposal,
  onDismissProposal,
  onRetryReads,
}: ScopeReviewPanelProps) {
  const simple = useOperationAttempt<SimpleGesture>();
  const linkAttempt = useOperationAttempt<{ proposalId: string; taskId: string }>();
  const dismissAttempt = useOperationAttempt<{ proposalId: string; reason: string }>();
  const [dismissReasons, setDismissReasons] = useState<Record<string, string>>({});
  const [linkChoices, setLinkChoices] = useState<Record<string, string>>({});
  const busy = simple.busy || linkAttempt.busy || dismissAttempt.busy;

  function runRegisterOrSync(action: "register" | "sync", reuse: typeof simple.pending) {
    const handler = action === "register" ? onSyncProposals : onSyncRequiredScope;
    if (!handler) return Promise.resolve({ kind: "rejected" as const, message: "unavailable" });
    return simple.run((input) => handler({ operationId: input.operationId }), { action }, reuse);
  }

  function runAttest(reuse: typeof simple.pending) {
    if (!onAttestCoverage || !expectedSource)
      return Promise.resolve({ kind: "rejected" as const, message: "unavailable" });
    /* Captured at the gesture: the attestation is bound to the exact
       transcript hash + scope version the human reviewed. */
    const gesture: SimpleGesture = {
      action: "attest",
      expectedTranscriptHash: expectedSource.transcriptHash,
      expectedScopeVersion: expectedSource.scopeVersion,
    };
    return simple.run(
      (input) =>
        input.action === "attest"
          ? onAttestCoverage({
              operationId: input.operationId,
              expectedTranscriptHash: input.expectedTranscriptHash,
              expectedScopeVersion: input.expectedScopeVersion,
            })
          : Promise.resolve({ kind: "rejected" as const, message: "unexpected operation" }),
      gesture,
      reuse,
    );
  }

  function runSimple(action: SimpleAction, reuse: typeof simple.pending) {
    return action === "attest" ? runAttest(reuse) : runRegisterOrSync(action, reuse);
  }

  const pending =
    proposals?.kind === "ready" ? proposals.proposals.filter((p) => p.status === "proposed") : [];
  const decided =
    proposals?.kind === "ready" ? proposals.proposals.filter((p) => p.status !== "proposed") : [];
  const decisions = proposals?.kind === "ready" ? proposals.decisions : [];
  const decisionFor = (proposalId: string) =>
    decisions
      .filter((d) => d.proposalId === proposalId && d.kind !== "register")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1);
  const targetTitle = (taskId: string | null) =>
    taskId
      ? (linkTargets.find((t) => t.id === taskId)?.title ?? `task ${taskId.slice(0, 8)}…`)
      : null;

  async function link(proposalId: string) {
    /* A new link is blocked while a link operation's outcome is unknown:
       reconcile (retry) the pending operation first, so two different
       gestures can never share one identity or race. */
    if (linkAttempt.pending) return;
    const taskId = linkChoices[proposalId] ?? "";
    if (!onLinkProposal || !taskId) return;
    await linkAttempt.run(onLinkProposal, { proposalId, taskId }, null);
  }

  async function retryLink() {
    /* Replays the EXACT original tuple — proposal and task as first
       captured — regardless of dropdown changes since. */
    if (!onLinkProposal || !linkAttempt.pending) return;
    await linkAttempt.run(onLinkProposal, linkAttempt.pending.payload, linkAttempt.pending);
  }

  async function dismiss(proposalId: string) {
    if (dismissAttempt.pending) return;
    const reason = (dismissReasons[proposalId] ?? "").trim();
    if (!onDismissProposal || reason.length < 10) return;
    const result = await dismissAttempt.run(onDismissProposal, { proposalId, reason }, null);
    /* Keep the reason text unless the dismissal resolved successfully. */
    if (result.kind === "dismissed") {
      setDismissReasons((m) => ({ ...m, [proposalId]: "" }));
    }
  }

  async function retryDismiss() {
    /* Replays the EXACT original proposal + reason, regardless of edits
       to the reason field since the first click. */
    if (!onDismissProposal || !dismissAttempt.pending) return;
    const result = await dismissAttempt.run(
      onDismissProposal,
      dismissAttempt.pending.payload,
      dismissAttempt.pending,
    );
    if (result.kind === "dismissed") {
      setDismissReasons((m) => ({ ...m, [dismissAttempt.pending!.payload.proposalId]: "" }));
    }
  }

  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        {proposalCapability.kind === "enabled" ? (
          <TTButton
            type="button"
            variant="secondary"
            className="h-8 px-2 text-xs"
            disabled={busy || !!simple.pending || !onSyncProposals}
            onClick={() => void runSimple("register", null)}
          >
            Register extracted proposals
          </TTButton>
        ) : (
          <p className="text-xs text-muted-foreground">{proposalCapability.reason}</p>
        )}
        {coverageCapability.kind === "enabled" ? (
          expectedSource ? (
            <TTButton
              type="button"
              variant="secondary"
              className="h-8 px-2 text-xs"
              disabled={busy || !!simple.pending || !onAttestCoverage}
              onClick={() => void runSimple("attest", null)}
            >
              Attest current transcript coverage
            </TTButton>
          ) : (
            <p className="text-xs text-muted-foreground">
              Coverage attestation needs the current score snapshot read first, so the attestation
              is bound to the exact transcript and scope version reviewed.
            </p>
          )
        ) : (
          <p className="text-xs text-muted-foreground">{coverageCapability.reason}</p>
        )}
        {scopeCapability.kind === "enabled" && onSyncRequiredScope ? (
          <TTButton
            type="button"
            variant="secondary"
            className="h-8 px-2 text-xs"
            disabled={busy || !!simple.pending}
            onClick={() => void runSimple("sync", null)}
          >
            Sync recorded required tasks into scope
          </TTButton>
        ) : null}
      </div>
      {simple.pending ? (
        <div className="flex flex-wrap items-center gap-2">
          <TTButton
            type="button"
            variant="secondary"
            className="h-8 px-2 text-xs"
            disabled={simple.busy}
            onClick={() => void runSimple(simple.pending!.payload.action, simple.pending)}
          >
            <RotateCw aria-hidden className="size-3.5" /> Retry same operation (
            {simple.pending.payload.action})
          </TTButton>
          <p className="text-xs text-warning">
            Outcome unknown — retry replays the exact original action and payload.
          </p>
        </div>
      ) : null}
      {coverage?.kind === "ready" ? (
        <p className="text-xs text-muted-foreground">
          Coverage: {coverage.current ? "confirmed for the current transcript" : "not confirmed"}
          {coverage.attestedAt ? ` · attested ${coverage.attestedAt.slice(0, 10)}` : ""}
        </p>
      ) : coverage?.kind === "rejected" ? (
        <RejectedNote message={coverage.message} onRetry={onRetryReads} />
      ) : null}
      {scope?.kind === "ready" ? (
        <p className="text-xs text-muted-foreground">
          Recorded scope: {scope.counts.denominator} required · {scope.counts.verified} verified ·{" "}
          {scope.counts.pendingProposals} proposals pending review
        </p>
      ) : scope?.kind === "rejected" ? (
        <RejectedNote message={scope.message} onRetry={onRetryReads} />
      ) : scopeCapability.kind === "unavailable" ? (
        <p className="text-xs text-muted-foreground">{scopeCapability.reason}</p>
      ) : null}
      {proposals?.kind === "rejected" ? (
        <RejectedNote message={proposals.message} onRetry={onRetryReads} />
      ) : null}
      {proposals?.kind === "ready" && pending.length > 0 ? (
        <ul className="space-y-2">
          {pending.map((proposal) => (
            <li key={proposal.id} className="rounded-md border border-border bg-card p-2.5">
              <p className="font-medium text-foreground">{proposal.statement}</p>
              {proposal.evidence.length > 0 ? (
                <ul className="mt-1 space-y-1">
                  {proposal.evidence.map((ref, index) => (
                    <li key={index} className="text-xs text-muted-foreground">
                      “{ref.label}”
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  aria-label={`Link ${proposal.statement} to an existing task`}
                  className="h-8 max-w-full rounded-md border border-border bg-card px-2 text-xs"
                  value={linkChoices[proposal.id] ?? ""}
                  onChange={(e) => setLinkChoices((m) => ({ ...m, [proposal.id]: e.target.value }))}
                >
                  <option value="">Link to existing task…</option>
                  {linkTargets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.title}
                    </option>
                  ))}
                </select>
                <TTButton
                  type="button"
                  variant="secondary"
                  className="h-8 px-2 text-xs"
                  disabled={busy || !linkChoices[proposal.id] || !onLinkProposal}
                  onClick={() => void link(proposal.id)}
                >
                  Link
                </TTButton>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  aria-label={`Dismiss reason for ${proposal.statement}`}
                  className="h-8 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-xs"
                  placeholder="Dismiss reason (at least 10 characters)"
                  value={dismissReasons[proposal.id] ?? ""}
                  onChange={(e) =>
                    setDismissReasons((m) => ({ ...m, [proposal.id]: e.target.value }))
                  }
                />
                <TTButton
                  type="button"
                  variant="secondary"
                  className="h-8 px-2 text-xs"
                  disabled={
                    busy ||
                    (dismissReasons[proposal.id] ?? "").trim().length < 10 ||
                    !onDismissProposal
                  }
                  onClick={() => void dismiss(proposal.id)}
                >
                  Dismiss
                </TTButton>
              </div>
            </li>
          ))}
        </ul>
      ) : proposals?.kind === "ready" ? (
        <p className="text-xs text-muted-foreground">No proposals pending review.</p>
      ) : null}
      {decided.length > 0 ? (
        <details className="rounded-md border border-border bg-card p-2.5">
          <summary className="cursor-pointer text-xs font-medium text-foreground">
            Decision history ({decided.length} resolved)
          </summary>
          <ul className="mt-2 space-y-2">
            {decided.map((proposal) => {
              const decision = decisionFor(proposal.id);
              return (
                <li key={proposal.id} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{proposal.statement}</span> —{" "}
                  {proposal.status === "linked" ? (
                    <>
                      linked to {targetTitle(decision?.taskId ?? null) ?? "a task"}; the obligation
                      counts in the required-work denominator
                    </>
                  ) : (
                    <>dismissed{decision?.reason ? `: “${decision.reason}”` : ""}</>
                  )}
                  {decision
                    ? ` · ${decision.createdAt.slice(0, 16).replace("T", " ")} · actor ${decision.actorId.slice(0, 8)}…`
                    : ""}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
      <OutcomeNote outcome={simple.outcome ?? linkAttempt.outcome ?? dismissAttempt.outcome} />
      {linkAttempt.pending || dismissAttempt.pending ? (
        <p className="text-xs text-warning">
          One operation’s outcome is unknown. Re-run the same action — it replays the same operation
          instead of re-executing.
        </p>
      ) : null}
      {/* Truthful gap: the audited scope amendment contract (005) exists
          in the proposed SQL, but removal/reinstatement is not wired into
          this interface — scope can only grow here, never silently
          shrink. */}
      <p className="text-xs text-muted-foreground">
        Removing or reinstating recorded scope is not supported in this interface yet; the audited
        amendment contract exists in the proposed backend but is not wired here. Recorded required
        work can only be added, never quietly dropped.
      </p>
    </div>
  );
}
