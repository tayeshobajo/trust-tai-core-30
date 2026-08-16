/**
 * Outcome & Learning — the closed loop, made legible.
 *
 * Three questions, answered in the order a person asks them:
 * what did we try, what happened, and what did the system learn?
 *
 * The restraint is the feature. Where a signal cannot be read, it says so.
 * Where there is one result, it says one result. Only a repeated pattern —
 * or a person's own correction — is shown as something learned.
 */

import { useState } from "react";

import { MetaPill, TTCard } from "@/components/tt/primitives";
import type { ActionExecutionRead, ExecutionStage } from "@/data/intelligence/conductor/execution-read";
import { METRIC_CLASS_LABEL } from "@/domain/outcomes";

const STAGE_LABEL: Record<ExecutionStage, string> = {
  ready_to_approve: "Waiting for you",
  approved_not_routed: "Approved, not yet routed",
  routable_now: "Ready to route",
  not_routable: "No adapter can carry this",
  routed: "Handed to the owning room",
  confirmed: "Confirmed by the owning room",
  held: "Held",
  closed: "Closed",
};

const LEARNING_LABEL: Record<ActionExecutionRead["learningState"], string> = {
  not_yet: "Nothing learned yet",
  one_result: "One result — not a rule",
  pattern: "A pattern worth trusting",
  human_corrected: "You corrected this",
};

const OUTCOME_LABEL: Record<ActionExecutionRead["outcomeStage"], string> = {
  not_observed: "Not observed yet",
  not_measurable: "Nothing can prove this yet",
  signal_present: "Signal present",
  signal_absent: "Signal absent",
  partial: "Part of the signal",
  inconclusive: "Inconclusive",
};

function whenLabel(at: string | undefined): string {
  if (!at) return "never";
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString();
}

export interface CorrectionDraft {
  owningApp: string;
  operation: string;
  statement: string;
}

export interface OutcomeLearningProps {
  reads: ActionExecutionRead[];
  statement: string;
  /** Rooms whose operations have no adapter, with the reason. */
  gaps?: { room: string; operation: string; because: string }[];
  /**
   * Said plainly when the ledger itself is unreachable, so an empty panel is
   * never mistaken for "nothing happened".
   */
  notice?: string;
  /** When the ledger last looked at the owning rooms. */
  lastCheckedAt?: string;
  /** How many routed actions could honestly be re-checked right now. */
  checkable?: number;
  checking?: boolean;
  onCheckOutcomes?: () => void;
  /** A person's own reading, appended as a decided record. */
  correcting?: boolean;
  onCorrect?: (draft: CorrectionDraft) => void;
}

function Row({
  read,
  correcting,
  onCorrect,
}: {
  read: ActionExecutionRead;
  correcting?: boolean;
  onCorrect?: (draft: CorrectionDraft) => void;
}) {
  const observation = read.observation;
  const [open, setOpen] = useState(false);
  const [statement, setStatement] = useState("");
  return (
    <li className="border-t border-[var(--tt-line)] py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{read.action.intent}</p>
        <MetaPill>{STAGE_LABEL[read.stage]}</MetaPill>
      </div>
      <p className="mt-1 text-sm text-[var(--tt-ink-muted)]">{read.because}</p>

      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-[var(--tt-ink-muted)]">
            What should become true
          </dt>
          <dd>{read.expectedSignal}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[var(--tt-ink-muted)]">
            What we found
          </dt>
          <dd>
            {observation
              ? read.observedResult
              : read.measurable
                ? "Not measured yet."
                : `Nothing in ${read.action.owningApp} can prove this yet.`}
          </dd>
        </div>
        {observation && observation.observedEvidence.length > 0 ? (
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-[var(--tt-ink-muted)]">Evidence</dt>
            <dd className="text-[var(--tt-ink-muted)]">
              {observation.observedEvidence.map((item) => item.label).join(" · ")}
            </dd>
          </div>
        ) : null}
        {read.metricClass ? (
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-[var(--tt-ink-muted)]">
              What kind of number this is
            </dt>
            <dd className="text-[var(--tt-ink-muted)]">
              {METRIC_CLASS_LABEL[read.metricClass]} — not the same as business health.
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <MetaPill>{OUTCOME_LABEL[read.outcomeStage]}</MetaPill>
        <MetaPill>{LEARNING_LABEL[read.learningState]}</MetaPill>
        {read.learning ? (
          <span className="text-sm text-[var(--tt-ink-muted)]">
            {read.learning.lesson} ({read.learning.confidence} confidence)
          </span>
        ) : null}
      </div>
      {read.lastCheckedAt ? (
        <p className="mt-2 text-xs text-[var(--tt-ink-muted)]">
          Last checked {whenLabel(read.lastCheckedAt)}.
        </p>
      ) : null}
      {read.boundary ? (
        <p className="mt-2 text-xs text-[var(--tt-ink-muted)]">Boundary crossed: {read.boundary}</p>
      ) : null}

      {onCorrect ? (
        <div className="mt-3">
          {open ? (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (statement.trim().length === 0) return;
                onCorrect({
                  owningApp: read.action.owningApp,
                  operation: read.action.operation,
                  statement: statement.trim(),
                });
                setStatement("");
                setOpen(false);
              }}
            >
              <label className="block text-xs uppercase tracking-wide text-[var(--tt-ink-muted)]">
                What actually happened, in your words
              </label>
              <textarea
                value={statement}
                onChange={(event) => setStatement(event.target.value)}
                rows={2}
                required
                className="w-full rounded-md border border-[var(--tt-line)] bg-transparent px-3 py-2 text-sm"
                placeholder="The draft was prepared, but I sent it by hand — the ledger cannot see that."
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={correcting || statement.trim().length === 0}
                  className="rounded-md border border-[var(--tt-line)] px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {correcting ? "Recording…" : "Record correction"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-1.5 text-sm text-[var(--tt-ink-muted)]"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-[var(--tt-ink-muted)]">
                Your reading is added to the ledger and outranks anything the system inferred.
                Nothing already recorded is edited or removed.
              </p>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-sm text-[var(--tt-ink-muted)] underline underline-offset-4"
            >
              Correct this reading
            </button>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function OutcomeLearning({
  reads,
  statement,
  gaps = [],
  notice,
  lastCheckedAt,
  checkable = 0,
  checking = false,
  onCheckOutcomes,
  correcting,
  onCorrect,
}: OutcomeLearningProps) {
  return (
    <TTCard>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Outcome &amp; learning</h2>
        <MetaPill>{reads.length} governed actions</MetaPill>
      </div>
      <p className="mt-1 text-sm text-[var(--tt-ink-muted)]">{statement}</p>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[var(--tt-ink-muted)]">
        <span>Last checked {whenLabel(lastCheckedAt)}.</span>
        {onCheckOutcomes && checkable > 0 ? (
          <button
            type="button"
            onClick={onCheckOutcomes}
            disabled={checking}
            className="underline underline-offset-4 disabled:opacity-50"
          >
            {checking ? "Checking…" : `Check outcomes (${checkable})`}
          </button>
        ) : null}
      </div>

      {notice ? (
        <p className="mt-3 rounded-md border border-[var(--tt-line)] px-3 py-2 text-sm text-[var(--tt-ink-muted)]">
          {notice}
        </p>
      ) : null}


      {reads.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--tt-ink-muted)]">
          Nothing has been approved yet, so there is nothing to observe and nothing to learn from.
        </p>
      ) : (
        <ul className="mt-4">
          {reads.map((read) => (
            <Row
              key={read.action.id}
              read={read}
              {...(correcting !== undefined ? { correcting } : {})}
              {...(onCorrect ? { onCorrect } : {})}
            />
          ))}
        </ul>
      )}

      {gaps.length > 0 ? (
        <details className="mt-5 text-sm">
          <summary className="cursor-pointer text-[var(--tt-ink-muted)]">
            What the Conductor cannot do ({gaps.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {gaps.map((gap) => (
              <li key={`${gap.room}:${gap.operation}`}>
                <span className="font-medium">{gap.operation}</span>
                <span className="block text-[var(--tt-ink-muted)]">{gap.because}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </TTCard>
  );
}
