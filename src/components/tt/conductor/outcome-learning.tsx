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
}

function Row({ read }: { read: ActionExecutionRead }) {
  const observation = read.observation;
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
        <MetaPill>{LEARNING_LABEL[read.learningState]}</MetaPill>
        {read.learning ? (
          <span className="text-sm text-[var(--tt-ink-muted)]">
            {read.learning.lesson} ({read.learning.confidence} confidence)
          </span>
        ) : null}
      </div>
      {read.boundary ? (
        <p className="mt-2 text-xs text-[var(--tt-ink-muted)]">Boundary crossed: {read.boundary}</p>
      ) : null}
    </li>
  );
}

export function OutcomeLearning({ reads, statement, gaps = [] }: OutcomeLearningProps) {
  return (
    <TTCard>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Outcome &amp; learning</h2>
        <MetaPill>{reads.length} governed actions</MetaPill>
      </div>
      <p className="mt-1 text-sm text-[var(--tt-ink-muted)]">{statement}</p>

      {reads.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--tt-ink-muted)]">
          Nothing has been approved yet, so there is nothing to observe and nothing to learn from.
        </p>
      ) : (
        <ul className="mt-4">
          {reads.map((read) => (
            <Row key={read.action.id} read={read} />
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
