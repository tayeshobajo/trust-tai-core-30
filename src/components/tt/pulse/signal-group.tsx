/**
 * A group of signals at one attention level. Groups never intermix, and each
 * one shows only as many rows as a person can hold at a glance.
 */

import { useState } from "react";

import {
  PULSE_SEVERITY_LABEL,
  PULSE_SEVERITY_MEANING,
  type PulseFeedbackKind,
  type PulseSeverity,
  type PulseSignal,
} from "@/domain/pulse";
import { cn } from "@/lib/utils";

import { SEVERITY_SURFACE, SEVERITY_TEXT } from "./severity";
import { PulseSignalRow } from "./signal-row";

const DEFAULT_VISIBLE: Record<PulseSeverity, number> = {
  act_now: 3,
  evaluate: 4,
  watch_closely: 3,
  good_to_know: 3,
};

export function PulseSignalGroup({
  severity,
  signals,
  feedback,
  onFeedback,
  onDecide,
  recordedCases,
  deciding,
}: {
  severity: PulseSeverity;
  signals: PulseSignal[];
  feedback: Record<string, PulseFeedbackKind>;
  onFeedback: (signal: PulseSignal, kind: PulseFeedbackKind) => void;
  onDecide?: (signal: PulseSignal, decision: string) => void | Promise<void>;
  /** Signal ids that already have a case in the ledger. */
  recordedCases?: Set<string>;
  deciding?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const limit = DEFAULT_VISIBLE[severity];
  const visible = expanded ? signals : signals.slice(0, limit);
  const hidden = signals.length - visible.length;
  const label = PULSE_SEVERITY_LABEL[severity];

  return (
    <section
      aria-label={label}
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <header
        className={cn(
          "flex items-center gap-2 px-5 py-3",
          SEVERITY_SURFACE[severity],
        )}
      >
        <h2
          className={cn(
            "font-mono text-[11px] uppercase tracking-[0.18em]",
            SEVERITY_TEXT[severity],
          )}
        >
          {label}
        </h2>
        <span
          className={cn(
            "grid size-5 place-items-center rounded-full bg-card text-[11px] font-medium",
            SEVERITY_TEXT[severity],
          )}
        >
          {signals.length}
        </span>
        <p className="ml-2 hidden truncate text-[12px] text-muted-foreground sm:block">
          {PULSE_SEVERITY_MEANING[severity]}
        </p>
      </header>

      <div>
        {visible.map((signal) => (
          <PulseSignalRow
            key={signal.id}
            signal={signal}
            feedback={feedback[signal.id]}
            onFeedback={(kind) => onFeedback(signal, kind)}
            onDecide={onDecide ? (decision) => onDecide(signal, decision) : undefined}
            caseRecorded={recordedCases?.has(signal.id) ?? false}
            deciding={deciding ?? false}
          />
        ))}
      </div>

      {signals.length > limit ? (
        <div className="border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              "font-mono text-[10px] uppercase tracking-[0.16em] underline-offset-4 hover:underline",
              SEVERITY_TEXT[severity],
            )}
          >
            {expanded
              ? `Show fewer ${label.toLowerCase()} signals`
              : `View all ${label.toLowerCase()} signals (${hidden} more) →`}
          </button>
        </div>
      ) : null}
    </section>
  );
}
