/**
 * Milestone outcome metric panel (P3-01).
 *
 * The manual path. Roadmap owns the outcome metric, so it is typed here by a
 * person: key, label, unit, direction, baseline with its date, target with its
 * date. Nothing is prefilled with a guess, and a milestone with no metric says
 * so plainly instead of showing a zero.
 */

import { useState } from "react";

import { MetaPill, TTButton, TTInput } from "@/components/tt/primitives";
import {
  METRIC_DIRECTIONS,
  METRIC_DIRECTION_LABEL,
  NO_METRIC,
  checkOutcomeMetric,
  metricSummary,
  type MetricDirection,
  type OutcomeMetric,
  type OutcomeMetricInput,
} from "@/domain/milestone-metric";

interface Draft {
  key: string;
  label: string;
  unit: string;
  direction: MetricDirection | "";
  baselineValue: string;
  baselineAt: string;
  targetValue: string;
  targetAt: string;
}

const EMPTY: Draft = {
  key: "",
  label: "",
  unit: "",
  direction: "",
  baselineValue: "",
  baselineAt: "",
  targetValue: "",
  targetAt: "",
};

function draftFrom(metric: OutcomeMetric | null): Draft {
  if (!metric) return EMPTY;
  return {
    key: metric.key,
    label: metric.label,
    unit: metric.unit,
    direction: metric.direction,
    baselineValue: String(metric.baseline.value),
    baselineAt: metric.baseline.at,
    targetValue: String(metric.target.value),
    targetAt: metric.target.at,
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="tt-eyebrow">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

export function MetricPanel({
  metric,
  subject,
  busy,
  onSave,
  onClear,
}: {
  metric: OutcomeMetric | null;
  subject: string;
  busy: boolean;
  onSave: (input: OutcomeMetricInput) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(metric));
  const [refusal, setRefusal] = useState<string | null>(null);

  const set = (patch: Partial<Draft>) => setDraft((value) => ({ ...value, ...patch }));

  const submit = () => {
    const checked = checkOutcomeMetric({
      key: draft.key,
      label: draft.label,
      unit: draft.unit,
      direction: draft.direction as MetricDirection,
      baseline: { value: draft.baselineValue as unknown as number, at: draft.baselineAt },
      target: { value: draft.targetValue as unknown as number, at: draft.targetAt },
    });
    if (!checked.ok) {
      setRefusal(checked.refusal);
      return;
    }
    setRefusal(null);
    onSave(checked.metric);
    setOpen(false);
  };

  return (
    <section className="mt-5 rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="tt-eyebrow">Outcome metric</p>
          <p className="mt-1 max-w-reading text-sm text-foreground">{metricSummary(metric)}</p>
        </div>
        <div className="flex items-center gap-2">
          {metric ? <MetaPill>Decided</MetaPill> : <MetaPill>{NO_METRIC}</MetaPill>}
          <TTButton
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setDraft(draftFrom(metric));
              setRefusal(null);
              setOpen((value) => !value);
            }}
          >
            {open ? "Cancel" : metric ? "Edit metric" : "Set metric"}
          </TTButton>
        </div>
      </div>

      {open ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Metric key">
              <TTInput
                value={draft.key}
                onChange={(event) => set({ key: event.target.value })}
                placeholder="demo_to_close_rate"
                aria-label={`Metric key for ${subject}`}
              />
            </Field>
            <Field label="Label">
              <TTInput
                value={draft.label}
                onChange={(event) => set({ label: event.target.value })}
                placeholder="Demo to close rate"
                aria-label={`Metric label for ${subject}`}
              />
            </Field>
            <Field label="Unit">
              <TTInput
                value={draft.unit}
                onChange={(event) => set({ unit: event.target.value })}
                placeholder="%"
                aria-label={`Metric unit for ${subject}`}
              />
            </Field>
            <Field label="Direction">
              <select
                value={draft.direction}
                onChange={(event) => set({ direction: event.target.value as MetricDirection })}
                aria-label={`Metric direction for ${subject}`}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"
              >
                <option value="">Choose a direction</option>
                {METRIC_DIRECTIONS.map((entry) => (
                  <option key={entry} value={entry}>
                    {METRIC_DIRECTION_LABEL[entry]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Baseline value">
              <TTInput
                value={draft.baselineValue}
                onChange={(event) => set({ baselineValue: event.target.value })}
                placeholder="12"
                inputMode="decimal"
                aria-label={`Baseline value for ${subject}`}
              />
            </Field>
            <Field label="Baseline date">
              <TTInput
                type="date"
                value={draft.baselineAt}
                onChange={(event) => set({ baselineAt: event.target.value })}
                aria-label={`Baseline date for ${subject}`}
              />
            </Field>
            <Field label="Target value">
              <TTInput
                value={draft.targetValue}
                onChange={(event) => set({ targetValue: event.target.value })}
                placeholder="25"
                inputMode="decimal"
                aria-label={`Target value for ${subject}`}
              />
            </Field>
            <Field label="Target date">
              <TTInput
                type="date"
                value={draft.targetAt}
                onChange={(event) => set({ targetAt: event.target.value })}
                aria-label={`Target date for ${subject}`}
              />
            </Field>
          </div>

          {refusal ? <p className="text-sm text-destructive">{refusal}</p> : null}

          <div className="flex flex-wrap gap-2">
            <TTButton size="sm" disabled={busy} onClick={submit}>
              Save metric
            </TTButton>
            {metric ? (
              <TTButton
                size="sm"
                variant="quiet"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  onClear();
                }}
              >
                Remove metric
              </TTButton>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
