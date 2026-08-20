/**
 * One signal, one row.
 *
 * The title is the strongest element. Everything else supports it: one
 * sentence, the lineage it belongs to, the impact, the age, and the owning
 * room's own action. Pulse routes; the room acts.
 */

import { Link } from "@tanstack/react-router";
import { MoreVertical } from "lucide-react";
import { useState } from "react";

import {
  PULSE_FEEDBACK_LABEL,
  PULSE_FEEDBACK_MEANING,
  PULSE_SEVERITY_MEANING,
  canOpenCase,
  type PulseFeedbackKind,
  type PulseSignal,
} from "@/domain/pulse";
import { CONFIDENCE_LEVEL_LABEL } from "@/domain/confidence";
import { canOpenInConductor, conductorHandoff } from "@/data/pulse/handoff";
import { cn } from "@/lib/utils";

import { PulseImpact, PulseSeverityIcon, SEVERITY_TEXT } from "./severity";

const FEEDBACK_ORDER: PulseFeedbackKind[] = ["accepted", "not_now", "not_useful"];

function Action({ signal }: { signal: PulseSignal }) {
  const className = cn(
    "inline-flex min-h-9 items-center justify-center rounded-full border px-4 text-[13px] font-medium transition-colors",
    "border-border bg-card text-foreground hover:bg-secondary",
  );
  if (/^https?:\/\//.test(signal.actionRoute)) {
    return (
      <a href={signal.actionRoute} target="_blank" rel="noreferrer" className={className}>
        {signal.actionLabel}
      </a>
    );
  }
  return (
    <Link to={signal.actionRoute} className={className}>
      {signal.actionLabel}
    </Link>
  );
}

export function PulseSignalRow({
  signal,
  feedback,
  onFeedback,
  onDecide,
  caseRecorded,
  deciding,
}: {
  signal: PulseSignal;
  feedback?: PulseFeedbackKind | undefined;
  onFeedback: (kind: PulseFeedbackKind) => void;
  /** Present only where an explicit decision can become a case. */
  onDecide?: ((decision: string) => void | Promise<void>) | undefined;
  caseRecorded?: boolean | undefined;
  deciding?: boolean | undefined;
}) {
  const [menu, setMenu] = useState(false);
  const [why, setWhy] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decision, setDecision] = useState("");
  const decidable = Boolean(onDecide) && canOpenCase(signal);


  return (
    <article className="border-t border-border px-5 py-4 first:border-t-0">
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] lg:items-start lg:gap-4">
        <PulseSeverityIcon severity={signal.severity} />

        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-snug text-foreground">{signal.title}</h3>
          <p className="mt-1 max-w-reading text-[13px] leading-relaxed text-muted-foreground">
            {signal.summary}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <span className={SEVERITY_TEXT[signal.severity]}>{signal.sourceAppLabel}</span>
            <span className="truncate normal-case tracking-normal text-foreground/70">
              {signal.entityPath}
            </span>
            {signal.patternLabel ? (
              <span className="rounded-full border border-border px-2 py-0.5 normal-case tracking-normal text-muted-foreground">
                {signal.patternLabel}
              </span>
            ) : null}
          </p>

          {feedback ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              You marked this “{PULSE_FEEDBACK_LABEL[feedback]}”. {PULSE_FEEDBACK_MEANING[feedback]}
            </p>
          ) : null}

          {decidable ? (
            caseRecorded ? (
              <p className="mt-3 text-[12px] text-muted-foreground">
                Your decision on this is in the case ledger. What happens next gets checked in the
                room that owns it.
              </p>
            ) : decisionOpen ? (
              <form
                className="mt-3 space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (decision.trim().length === 0) return;
                  void onDecide?.(decision.trim());
                }}
              >
                <label htmlFor={`pulse-decision-${signal.id}`} className="tt-eyebrow">
                  What did you decide
                </label>
                <textarea
                  id={`pulse-decision-${signal.id}`}
                  rows={2}
                  value={decision}
                  onChange={(event) => setDecision(event.target.value)}
                  placeholder="Named an owner and asked for a date by Friday."
                  className="w-full max-w-reading resize-none rounded-md border border-border bg-transparent p-2.5 text-[13px] leading-relaxed outline-none focus:border-foreground"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={deciding || decision.trim().length === 0}
                    className="inline-flex min-h-9 items-center rounded-full bg-foreground px-4 text-[13px] font-medium text-background disabled:opacity-50"
                  >
                    {deciding ? "Recording" : "Record this decision"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecisionOpen(false)}
                    className="inline-flex min-h-9 items-center rounded-full px-3 text-[13px] text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-[12px] text-muted-foreground">
                  This records what you decided and the evidence it stood on. It moves no work.
                </p>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setDecisionOpen(true)}
                className="mt-3 inline-flex min-h-9 items-center rounded-full border border-border px-3 text-[13px] text-foreground hover:bg-secondary"
              >
                I acted on this
              </button>
            )
          ) : null}

          {why ? (
            <div className="mt-3 rounded-lg border border-border bg-secondary/60 p-3">
              <p className="tt-eyebrow mb-1.5">Why you are seeing this</p>
              <p className="text-[13px] text-foreground">{signal.reason}</p>
              <p className="mt-2 text-[12px] text-muted-foreground">
                {PULSE_SEVERITY_MEANING[signal.severity]} Confidence:{" "}
                {CONFIDENCE_LEVEL_LABEL[signal.confidence]}.
              </p>
              {signal.evidence.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                  {signal.evidence.map((ref, index) => (
                    <li key={`${ref.label}-${index}`}>{ref.label}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="lg:w-[86px]">
          <p className="tt-eyebrow">Impact</p>
          <PulseImpact impact={signal.impact} />
        </div>

        <div className="lg:w-[80px]">
          <p className="tt-eyebrow">Age</p>
          <p className="text-[13px] text-foreground">
            {signal.ageDays <= 0
              ? "Today"
              : `${signal.ageDays} day${signal.ageDays === 1 ? "" : "s"}`}
          </p>
        </div>

        <div className="relative flex items-center gap-1">
          <Action signal={signal} />
          {canOpenInConductor(signal) ? (
            <Link
              to="/modules/conductor"
              search={conductorHandoff(signal)}
              className="inline-flex min-h-9 items-center justify-center rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Open in Conductor
            </Link>
          ) : null}
          <button
            type="button"
            aria-label="More options for this signal"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
            className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <MoreVertical className="size-4" />
          </button>
          {menu ? (
            <div
              role="menu"
              className="absolute right-0 top-11 z-20 w-52 rounded-xl border border-border bg-popover p-1 shadow-tt-md"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setWhy((v) => !v);
                  setMenu(false);
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-[13px] text-foreground hover:bg-secondary"
              >
                Why am I seeing this?
              </button>
              {FEEDBACK_ORDER.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onFeedback(kind);
                    setMenu(false);
                  }}
                  className="w-full rounded-lg px-3 py-2 text-left text-[13px] text-foreground hover:bg-secondary"
                >
                  {PULSE_FEEDBACK_LABEL[kind]}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
