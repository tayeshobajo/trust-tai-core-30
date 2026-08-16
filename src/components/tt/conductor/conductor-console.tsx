/**
 * The Conductor console — one place to talk to the whole business.
 *
 * The surface is deliberately quiet: a question, a direct answer, and then the
 * working underneath it. Every number says whether it was observed, decided,
 * derived or is unknown, and the boundary of what the Conductor will and will
 * not do is stated on every answer rather than buried in a policy page.
 */

import { useState } from "react";
import { Link } from "@tanstack/react-router";

import { MetaPill, TTButton, TTCard } from "@/components/tt/primitives";
import {
  BLIND_SPOT_SEVERITY_LABEL,
  CONDUCTOR_TOPIC_LABEL,
  type ConductorAnswer,
  type ValueBasis,
} from "@/domain/conductor";

const BASIS_LABEL: Record<ValueBasis, string> = {
  observed: "Observed",
  decided: "You decided",
  inferred: "Inferred",
  recommended: "Recommended",
  unknown: "Not known",
};

const STANDING_TONE: Record<string, string> = {
  healthy: "text-[var(--tt-ink-muted)]",
  watch: "text-[var(--tt-ink)]",
  at_risk: "text-[var(--tt-alert,var(--tt-ink))]",
  unknown: "text-[var(--tt-ink-muted)]",
};

/** The six questions the Conductor can answer well, offered plainly. */
const OPENERS = [
  "How is the business actually doing?",
  "Where are we leaking work?",
  "What are we not measuring?",
  "What deserves me today?",
  "What would it take to reach our revenue goal?",
  "What keeps going wrong that we could fix?",
];

export interface ConductorConsoleProps {
  answer?: ConductorAnswer;
  thinking?: boolean;
  onAsk: (question: string) => void | Promise<void>;
}

export function ConductorConsole({ answer, thinking, onAsk }: ConductorConsoleProps) {
  const [question, setQuestion] = useState("");
  const [showWorking, setShowWorking] = useState(false);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setQuestion(trimmed);
    await onAsk(trimmed);
  }

  return (
    <div className="space-y-8">
      <TTCard className="space-y-5 p-6">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
        >
          <label
            htmlFor="conductor-question"
            className="text-sm text-[var(--tt-ink-muted)]"
          >
            Ask the business a question.
          </label>
          <textarea
            id="conductor-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={2}
            placeholder="How is the business actually doing?"
            className="w-full resize-none rounded-md border border-[var(--tt-rule)] bg-transparent p-3 text-base leading-relaxed outline-none focus:border-[var(--tt-ink)]"
          />
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-[var(--tt-ink-muted)]">
              Reads every room you are authorised to see. Changes nothing.
            </p>
            <TTButton type="submit" disabled={thinking || question.trim().length === 0}>
              {thinking ? "Reading the suite…" : "Ask"}
            </TTButton>
          </div>
        </form>

        <div className="flex flex-wrap gap-2 border-t border-[var(--tt-rule)] pt-4">
          {OPENERS.map((opener) => (
            <button
              key={opener}
              type="button"
              onClick={() => void ask(opener)}
              className="rounded-full border border-[var(--tt-rule)] px-3 py-1 text-xs text-[var(--tt-ink-muted)] transition hover:border-[var(--tt-ink)] hover:text-[var(--tt-ink)]"
            >
              {opener}
            </button>
          ))}
        </div>
      </TTCard>

      {answer ? (
        <div className="space-y-8">
          {/* -------------------------------------------------- the answer */}
          <TTCard className="space-y-5 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <MetaPill>{CONDUCTOR_TOPIC_LABEL[answer.topic]}</MetaPill>
              {answer.grounded ? null : <MetaPill>Partial read</MetaPill>}
            </div>
            <p className="text-xl leading-relaxed">{answer.answer}</p>

            {answer.nextMove ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--tt-rule)] pt-4">
                <p className="text-sm text-[var(--tt-ink-muted)]">{answer.nextMove.statement}</p>
                <Link to={answer.nextMove.route}>
                  <TTButton variant="secondary">{answer.nextMove.routeLabel}</TTButton>
                </Link>
              </div>
            ) : null}

            {answer.watch ? (
              <p className="text-sm text-[var(--tt-ink-muted)]">
                Watch: {answer.watch.statement}
              </p>
            ) : null}

            {onCorrect ? (
              <div className="border-t border-[var(--tt-rule)] pt-4">
                <CorrectAnswer
                  answer={answer}
                  {...(correcting !== undefined ? { saving: correcting } : {})}
                  {...(corrected !== undefined ? { saved: corrected } : {})}
                  onCorrect={onCorrect}
                />
              </div>
            ) : null}
          </TTCard>

          {/* ------------------------------------------ figures only you have */}
          {figures ?? null}

          {/* ----------------------------------------------- operating plan */}
          {answer.plan ? <PlanPanel plan={answer.plan} /> : null}


          {/* -------------------------------------------------- improvements */}
          {answer.improvements.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm uppercase tracking-wide text-[var(--tt-ink-muted)]">
                System improvements
              </h2>
              {answer.improvements.map((improvement) => (
                <TTCard key={improvement.id} className="space-y-3 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <MetaPill>{improvement.owningApp}</MetaPill>
                    <MetaPill>{improvement.risk} risk</MetaPill>
                    <MetaPill>Seen {improvement.occurrences} times</MetaPill>
                  </div>
                  <p className="text-lg">{improvement.headline}</p>
                  <p className="text-sm text-[var(--tt-ink-muted)]">{improvement.diagnosis}</p>
                  <p className="text-sm">{improvement.fix}</p>
                  <p className="text-xs text-[var(--tt-ink-muted)]">
                    You would know it worked when: {improvement.expectedSignal}
                  </p>
                  <div className="flex items-center justify-between gap-3 border-t border-[var(--tt-rule)] pt-3">
                    <span className="text-xs text-[var(--tt-ink-muted)]">
                      Requires your approval in the owning room.
                    </span>
                    <Link to={improvement.route}>
                      <TTButton variant="secondary">Open room</TTButton>
                    </Link>
                  </div>
                </TTCard>
              ))}
            </section>
          ) : null}

          {/* ------------------------------------------------- bounded work */}
          {answer.proposedActions.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm uppercase tracking-wide text-[var(--tt-ink-muted)]">
                Bounded next steps
              </h2>
              {answer.proposedActions.map((action) => (
                <TTCard key={action.id} className="space-y-3 p-5">
                  <p className="text-base">{action.title}</p>
                  <p className="text-sm text-[var(--tt-ink-muted)]">{action.summary}</p>
                  <div className="grid gap-3 text-xs text-[var(--tt-ink-muted)] sm:grid-cols-2">
                    <div>
                      <p className="uppercase tracking-wide">Will do</p>
                      <ul className="mt-1 space-y-1">
                        {action.willDo.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="uppercase tracking-wide">Will not do</p>
                      <ul className="mt-1 space-y-1">
                        {action.willNotDo.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-[var(--tt-rule)] pt-3">
                    <span className="text-xs text-[var(--tt-ink-muted)]">
                      Authorised and completed by you, in {action.appId}.
                    </span>
                    <Link to={action.route}>
                      <TTButton variant="secondary">{action.routeLabel}</TTButton>
                    </Link>
                  </div>
                </TTCard>
              ))}
            </section>
          ) : null}

          {/* ------------------------------------------------- vital signs */}
          <section className="space-y-3">
            <h2 className="text-sm uppercase tracking-wide text-[var(--tt-ink-muted)]">
              Vital signs
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {answer.vitals.areas.map((area) => (
                <TTCard key={area.question} className="space-y-3 p-5">
                  <p className="text-base">{area.label}</p>
                  <ul className="space-y-2">
                    {area.readings.map((reading) => (
                      <li key={reading.key} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm">{reading.definition.label}</span>
                          <span className={`text-sm ${STANDING_TONE[reading.standing] ?? ""}`}>
                            {reading.basis === "unknown"
                              ? "Not known"
                              : `${reading.value ?? "—"}${reading.definition.unit === "percent" ? "%" : ""}`}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--tt-ink-muted)]">
                          {BASIS_LABEL[reading.basis]} · {reading.because}
                        </p>
                      </li>
                    ))}
                  </ul>
                </TTCard>
              ))}
            </div>
          </section>

          {/* ------------------------------------------------ factory flow */}
          {answer.factory.warnings.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm uppercase tracking-wide text-[var(--tt-ink-muted)]">
                Upstream and downstream
              </h2>
              {answer.factory.warnings.map((warning) => (
                <TTCard key={warning.nodeId} className="space-y-2 p-5">
                  <p className="text-base">{warning.statement}</p>
                  <p className="text-sm text-[var(--tt-ink-muted)]">{warning.because}</p>
                  <p className="text-xs text-[var(--tt-ink-muted)]">
                    Expected to be felt within {warning.expectedByDays} days.
                  </p>
                </TTCard>
              ))}
            </section>
          ) : null}

          {/* ---------------------------------------------------- unknowns */}
          {answer.unknowns.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm uppercase tracking-wide text-[var(--tt-ink-muted)]">
                What we cannot see
              </h2>
              {answer.unknowns.map((spot) => (
                <TTCard key={spot.key} className="space-y-2 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <MetaPill>{BLIND_SPOT_SEVERITY_LABEL[spot.severity]}</MetaPill>
                    {spot.ownerApp ? <MetaPill>{spot.ownerApp}</MetaPill> : null}
                  </div>
                  <p className="text-base">{spot.question}</p>
                  <p className="text-sm text-[var(--tt-ink-muted)]">{spot.whyItMatters}</p>
                  <p className="text-sm">{spot.howToInstrument}</p>
                </TTCard>
              ))}
            </section>
          ) : null}

          {/* ------------------------------------------------- action graph */}
          {answer.actionGraph && answer.actionGraph.steps.length > 1 ? (
            <section className="space-y-3">
              <h2 className="text-sm uppercase tracking-wide text-[var(--tt-ink-muted)]">
                Prepared across rooms — nothing has happened
              </h2>
              <TTCard className="space-y-4 p-5">
                <p className="text-sm text-[var(--tt-ink-muted)]">
                  {answer.actionGraph.owningApps.join(", ")} · every step needs your
                  approval in the room that owns it.
                </p>
                <ol className="space-y-3">
                  {answer.actionGraph.steps.map((step, index) => (
                    <li key={step.id} className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <MetaPill>{index + 1}</MetaPill>
                        <MetaPill>{step.owningApp}</MetaPill>
                        {step.consequential ? <MetaPill>Consequential</MetaPill> : null}
                        <MetaPill>Needs {step.requiredCapability}</MetaPill>
                      </div>
                      <p className="text-sm">{step.title}</p>
                      <p className="text-xs text-[var(--tt-ink-muted)]">
                        {step.dependsOn.length > 0
                          ? "Only after the step above is authorised. "
                          : ""}
                        {step.expectedSignal}
                      </p>
                    </li>
                  ))}
                </ol>
              </TTCard>
            </section>
          ) : null}

          {/* ---------------------------------------------------- evidence */}
          {answer.evidence.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm uppercase tracking-wide text-[var(--tt-ink-muted)]">
                What this answer rests on
              </h2>
              <TTCard className="space-y-2 p-5">
                <ul className="space-y-2">
                  {answer.evidence.map((ref) => (
                    <li key={`${ref.kind}-${ref.label}`} className="flex flex-wrap items-baseline gap-2">
                      <MetaPill>{ref.kind}</MetaPill>
                      {ref.url ? (
                        <a
                          href={ref.url}
                          className="text-sm underline-offset-4 hover:underline"
                          rel="noreferrer"
                        >
                          {ref.label}
                        </a>
                      ) : (
                        <span className="text-sm">{ref.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </TTCard>
            </section>
          ) : null}

          {/* ------------------------------------------------ the boundary */}

          <TTCard className="space-y-4 p-5">
            <button
              type="button"
              onClick={() => setShowWorking((value) => !value)}
              className="text-sm text-[var(--tt-ink-muted)] underline-offset-4 hover:underline"
            >
              {showWorking ? "Hide" : "Show"} what this rests on, and what I will not do
            </button>
            {showWorking ? (
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[var(--tt-ink-muted)]">
                    I will
                  </p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {answer.control.willDo.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-[var(--tt-ink-muted)]">
                    I will not
                  </p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {answer.control.willNotDo.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
                {answer.withheld.length > 0 ? (
                  <div className="sm:col-span-2">
                    <p className="text-xs uppercase tracking-wide text-[var(--tt-ink-muted)]">
                      Rooms not read
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-[var(--tt-ink-muted)]">
                      {answer.withheld.map((room) => (
                        <li key={room.appId}>
                          {room.appId} — {room.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </TTCard>
        </div>
      ) : null}
    </div>
  );
}

function PlanPanel({ plan }: { plan: NonNullable<ConductorAnswer["plan"]> }) {
  return (
    <section className="space-y-4">
      <h2 className="text-sm uppercase tracking-wide text-[var(--tt-ink-muted)]">
        Operating plan — {plan.outcome}
      </h2>

      {!plan.complete ? (
        <TTCard className="space-y-2 p-5">
          <p className="text-base">This outcome cannot be decomposed yet.</p>
          <p className="text-sm text-[var(--tt-ink-muted)]">{plan.blockedBecause}</p>
        </TTCard>
      ) : (
        <>
          <TTCard className="space-y-3 p-5">
            <p className="text-xs uppercase tracking-wide text-[var(--tt-ink-muted)]">
              Working back
            </p>
            <ul className="space-y-2">
              {plan.targets.map((target) => (
                <li key={target.key} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm">{target.label}</span>
                    <span className="text-base">
                      {target.value} {target.unit}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--tt-ink-muted)]">
                    {BASIS_LABEL[target.basis]} · {target.workedOut}
                  </p>
                </li>
              ))}
            </ul>
          </TTCard>

          <div className="grid gap-4 md:grid-cols-2">
            {plan.rooms.map((room) => (
              <TTCard key={room.appId} className="space-y-2 p-5">
                <div className="flex items-center gap-2">
                  <MetaPill>{room.label}</MetaPill>
                  <MetaPill>{room.role}</MetaPill>
                </div>
                <p className="text-sm">{room.contribution}</p>
                {room.dependencies.length > 0 ? (
                  <p className="text-xs text-[var(--tt-ink-muted)]">
                    Depends on: {room.dependencies.join(" ")}
                  </p>
                ) : null}
                <Link
                  to={room.route}
                  className="text-xs underline-offset-4 hover:underline"
                >
                  Open {room.label}
                </Link>
              </TTCard>
            ))}
          </div>

          <TTCard className="space-y-3 p-5">
            <p className="text-xs uppercase tracking-wide text-[var(--tt-ink-muted)]">
              What this rests on
            </p>
            <ul className="space-y-2">
              {plan.assumptions.map((assumption) => (
                <li key={assumption.key} className="space-y-1">
                  <p className="text-sm">{assumption.statement}</p>
                  <p className="text-xs text-[var(--tt-ink-muted)]">
                    {BASIS_LABEL[assumption.basis]} · {assumption.because}
                  </p>
                </li>
              ))}
            </ul>
            {plan.risks.length > 0 ? (
              <div className="border-t border-[var(--tt-rule)] pt-3">
                <p className="text-xs uppercase tracking-wide text-[var(--tt-ink-muted)]">Risks</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {plan.risks.map((risk) => (
                    <li key={risk.statement}>
                      {risk.statement}{" "}
                      <span className="text-[var(--tt-ink-muted)]">{risk.because}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </TTCard>

          {plan.checkpoints.length > 0 ? (
            <TTCard className="space-y-2 p-5">
              <p className="text-xs uppercase tracking-wide text-[var(--tt-ink-muted)]">
                Checkpoints
              </p>
              <ul className="space-y-1 text-sm">
                {plan.checkpoints.map((checkpoint) => (
                  <li key={checkpoint.label}>
                    <span className="text-[var(--tt-ink-muted)]">
                      Day {checkpoint.atDays} — {checkpoint.label}:
                    </span>{" "}
                    {checkpoint.expect}
                  </li>
                ))}
              </ul>
            </TTCard>
          ) : null}
        </>
      )}
    </section>
  );
}
