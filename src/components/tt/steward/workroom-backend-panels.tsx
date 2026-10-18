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
 * While every capability flag is OFF the panels render the honest
 * unavailable state with the server-supplied reason — no task or model
 * mutation can be triggered from mount, selection, or timers.
 */

import { useState } from "react";
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
  | { kind: "ready"; runs: RunSnapshot[] }
  | { kind: "rejected"; message: string }
  | { kind: "loading" };

export type VerificationRead =
  | { kind: "unavailable"; reason: string }
  | {
      kind: "ready";
      task: { status: "open" | "complete"; revision: number } | null;
      receipts: { id: string; note: string; actorId: string; createdAt: string }[];
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

export type ProposalReviewRead =
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; proposals: ProposalSnapshot[] }
  | { kind: "rejected"; message: string }
  | { kind: "loading" };

/** Generic action outcome; the panels render kind + message only. */
export interface ActionOutcome {
  kind: string;
  message?: string;
}

/* ---------------------------------------------------------- AI panel */

export interface AiPreparationProps {
  capability: CapabilityState;
  runs: RunsRead | undefined;
  task: BoardTask;
  meetingId: string;
  actions: { id: string; label: string; summary: string }[];
  onRequestRun:
    | ((input: {
        actionId: string;
        inputRefs: { kind: "transcript" | "task_notes"; id: string }[];
        operationId: string;
      }) => Promise<ActionOutcome>)
    | undefined;
  onExecuteRun: ((runId: string) => Promise<ActionOutcome>) | undefined;
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
}: AiPreparationProps) {
  const [selectedAction, setSelectedAction] = useState(actions[0]?.id ?? "");
  const [useTranscript, setUseTranscript] = useState(true);
  const [useNotes, setUseNotes] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);

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
    setBusy(true);
    setOutcome(null);
    try {
      /* A fresh operation UUID per deliberate request; a retry of the SAME
         request reuses the UUID so it replays instead of re-executing. */
      setOutcome(
        await onRequestRun({
          actionId: selectedAction,
          inputRefs,
          operationId: crypto.randomUUID(),
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function execute(runId: string) {
    if (!onExecuteRun) return;
    setBusy(true);
    setOutcome(null);
    try {
      setOutcome(await onExecuteRun(runId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-3">
      <p className="text-[13px] text-muted-foreground">
        Bounded preparation for this task. A draft is review material only — it never completes
        the task, grants verified credit, or delivers the work itself.
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
          {actions.map((action) => (
            <option key={action.id} value={action.id}>
              {action.label}
            </option>
          ))}
        </select>
        <TTButton
          type="button"
          variant="secondary"
          className="h-8 px-2 text-xs"
          disabled={busy || inputRefs.length === 0 || !onRequestRun}
          onClick={() => void request()}
        >
          <Sparkles aria-hidden className="size-3.5" /> Request preparation
        </TTButton>
      </div>
      {outcome ? (
        <p
          role="status"
          className="rounded-md border border-border bg-card p-2 text-xs text-muted-foreground"
        >
          {outcome.message ?? outcome.kind}
        </p>
      ) : null}
      <RunHistory runs={runs} busy={busy} onExecute={execute} />
    </div>
  );
}

function RunHistory({
  runs,
  busy,
  onExecute,
}: {
  runs: RunsRead | undefined;
  busy: boolean;
  onExecute: (runId: string) => Promise<void>;
}) {
  if (!runs || runs.kind === "loading") {
    return <p className="text-xs text-muted-foreground">Reading run history…</p>;
  }
  if (runs.kind === "unavailable" || runs.kind === "rejected") {
    return (
      <p className="text-xs text-muted-foreground">
        {"reason" in runs ? runs.reason : runs.message}
      </p>
    );
  }
  if (runs.runs.length === 0) {
    return <p className="text-xs text-muted-foreground">No preparation runs recorded yet.</p>;
  }
  return (
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
  );
}

/* ---------------------------------------------------------- verification */

export interface VerificationPanelProps {
  capability: CapabilityState;
  state: VerificationRead | undefined;
  task: BoardTask;
  onVerify: ((input: { note: string; operationId: string }) => Promise<ActionOutcome>) | undefined;
  onReopen: ((input: { note: string; operationId: string }) => Promise<ActionOutcome>) | undefined;
}

/**
 * Evidence review: verify with a substantive note against the expected
 * revision, reopen with a reason. Receipts and audit history are durable;
 * board "Delivered" status alone never counts.
 */
export function VerificationPanel({
  capability,
  state,
  task,
  onVerify,
  onReopen,
}: VerificationPanelProps) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);

  if (capability.kind === "unavailable") {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {capability.reason}
      </p>
    );
  }

  const verified = state?.kind === "ready" && state.task?.status === "complete";

  async function act(handler: typeof onVerify) {
    if (!handler || note.trim().length < 10) return;
    setBusy(true);
    setOutcome(null);
    try {
      setOutcome(await handler({ note: note.trim(), operationId: crypto.randomUUID() }));
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2 text-[13px]">
      {state?.kind === "ready" && state.receipts.length > 0 ? (
        <ul className="space-y-1">
          {state.receipts.map((receipt) => (
            <li
              key={receipt.id}
              className="rounded-md border border-success/30 bg-success/5 px-3 py-2"
            >
              <p className="text-foreground">“{receipt.note}”</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Durable receipt · {receipt.createdAt.slice(0, 16).replace("T", " ")}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {state?.kind === "rejected" ? (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <AlertCircle aria-hidden className="size-3.5" /> {state.message}
        </p>
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
      <div className="flex items-center gap-2">
        {verified ? (
          <TTButton
            type="button"
            variant="secondary"
            className="h-8 px-2 text-xs"
            disabled={busy || note.trim().length < 10 || !onReopen}
            onClick={() => void act(onReopen)}
          >
            Reopen (history preserved)
          </TTButton>
        ) : (
          <TTButton
            type="button"
            variant="secondary"
            className="h-8 px-2 text-xs"
            disabled={busy || note.trim().length < 10 || !onVerify}
            onClick={() => void act(onVerify)}
          >
            <Check aria-hidden className="size-3.5" /> Verify at revision {task.revision}
          </TTButton>
        )}
      </div>
      {outcome ? (
        <p role="status" className="text-xs text-muted-foreground">
          {outcome.message ?? outcome.kind}
        </p>
      ) : null}
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
  onAttestCoverage: (() => Promise<ActionOutcome>) | undefined;
  onSyncProposals: (() => Promise<ActionOutcome>) | undefined;
  onLinkProposal:
    | ((input: { proposalId: string; taskId: string; operationId: string }) => Promise<ActionOutcome>)
    | undefined;
  onDismissProposal:
    | ((input: { proposalId: string; reason: string; operationId: string }) => Promise<ActionOutcome>)
    | undefined;
}

/**
 * Meeting scope review: explicit extraction registration, the pending
 * proposal list with source evidence, human link-to-existing-task or
 * reasoned dismiss, and explicit coverage attestation. Nothing here
 * auto-confirms; a link alone is not agreement.
 */
export function ScopeReviewPanel({
  scope,
  coverage,
  proposals,
  scopeCapability,
  coverageCapability,
  proposalCapability,
  linkTargets,
  onAttestCoverage,
  onSyncProposals,
  onLinkProposal,
  onDismissProposal,
}: ScopeReviewPanelProps) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  const [dismissReasons, setDismissReasons] = useState<Record<string, string>>({});
  const [linkChoices, setLinkChoices] = useState<Record<string, string>>({});

  async function act(handler: (() => Promise<ActionOutcome> | undefined) | undefined) {
    if (!handler) return;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await handler();
      if (result) setOutcome(result);
    } finally {
      setBusy(false);
    }
  }

  const pending =
    proposals?.kind === "ready" ? proposals.proposals.filter((p) => p.status === "proposed") : [];

  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        {proposalCapability.kind === "enabled" ? (
          <TTButton
            type="button"
            variant="secondary"
            className="h-8 px-2 text-xs"
            disabled={busy || !onSyncProposals}
            onClick={() => void act(onSyncProposals)}
          >
            Register extracted proposals
          </TTButton>
        ) : (
          <p className="text-xs text-muted-foreground">{proposalCapability.reason}</p>
        )}
        {coverageCapability.kind === "enabled" ? (
          <TTButton
            type="button"
            variant="secondary"
            className="h-8 px-2 text-xs"
            disabled={busy || !onAttestCoverage}
            onClick={() => void act(onAttestCoverage)}
          >
            Attest current transcript coverage
          </TTButton>
        ) : (
          <p className="text-xs text-muted-foreground">{coverageCapability.reason}</p>
        )}
      </div>
      {coverage?.kind === "ready" ? (
        <p className="text-xs text-muted-foreground">
          Coverage: {coverage.current ? "confirmed for the current transcript" : "not confirmed"}
          {coverage.attestedAt ? ` · attested ${coverage.attestedAt.slice(0, 10)}` : ""}
        </p>
      ) : null}
      {scope?.kind === "ready" ? (
        <p className="text-xs text-muted-foreground">
          Recorded scope: {scope.counts.denominator} required · {scope.counts.verified} verified ·{" "}
          {scope.counts.pendingProposals} proposals pending review
        </p>
      ) : scopeCapability.kind === "unavailable" ? (
        <p className="text-xs text-muted-foreground">{scopeCapability.reason}</p>
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
                  onChange={(e) =>
                    setLinkChoices((m) => ({ ...m, [proposal.id]: e.target.value }))
                  }
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
                  onClick={() =>
                    void act(() =>
                      onLinkProposal?.({
                        proposalId: proposal.id,
                        taskId: linkChoices[proposal.id] ?? "",
                        operationId: crypto.randomUUID(),
                      }),
                    )
                  }
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
                    busy || (dismissReasons[proposal.id] ?? "").trim().length < 10 || !onDismissProposal
                  }
                  onClick={() =>
                    void act(() =>
                      onDismissProposal?.({
                        proposalId: proposal.id,
                        reason: (dismissReasons[proposal.id] ?? "").trim(),
                        operationId: crypto.randomUUID(),
                      }),
                    )
                  }
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
      {outcome ? (
        <p role="status" className="text-xs text-muted-foreground">
          {outcome.message ?? outcome.kind}
        </p>
      ) : null}
    </div>
  );
}
