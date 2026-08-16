/**
 * Recorded figures — the instrument of last resort.
 *
 * Cash, burn, receivables, close rate, deal size: numbers no room in the
 * suite will ever count for itself. Rather than let the survival question sit
 * permanently unanswerable, a person records them here, dated. The panel is
 * blunt about what it is: hand-recorded truth, going stale on a clock.
 */

import { useState } from "react";

import { MetaPill, TTButton, TTCard } from "@/components/tt/primitives";
import {
  FIGURE_INPUTS,
  FIGURE_STALE_DAYS,
  type BusinessFigure,
} from "@/domain/conductor";
import { currentFigure, figureAgeDays } from "@/data/intelligence/conductor/figures";

export interface FiguresPanelProps {
  figures: BusinessFigure[];
  now: string;
  saving?: boolean;
  /** Set when the ledger cannot be written yet — recording is refused up front. */
  disabled?: boolean;
  disabledReason?: string;
  onRecord: (input: { key: string; value: number; asOf: string; note?: string }) => void | Promise<void>;
}

function today(now: string): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function FiguresPanel({
  figures,
  now,
  saving,
  disabled,
  disabledReason,
  onRecord,
}: FiguresPanelProps) {
  const [key, setKey] = useState(FIGURE_INPUTS[0]!.key);
  const [value, setValue] = useState("");
  const [asOf, setAsOf] = useState(today(now));
  const [note, setNote] = useState("");

  const definition = FIGURE_INPUTS.find((row) => row.key === key)!;
  const parsed = Number(value);
  const valid = value.trim().length > 0 && Number.isFinite(parsed);

  async function submit() {
    if (!valid || disabled) return;
    await onRecord({
      key,
      value: parsed,
      asOf: new Date(`${asOf}T12:00:00.000Z`).toISOString(),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setValue("");
    setNote("");
  }

  return (
    <TTCard className="space-y-5 p-6">
      <div className="space-y-1">
        <h2 className="text-base">Figures only you can supply</h2>
        <p className="text-sm text-[var(--tt-ink-muted)]">
          Nothing in the suite counts these. Record them and they become decided
          truth — dated, attributed, and stale after {FIGURE_STALE_DAYS} days.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {FIGURE_INPUTS.map((input) => {
          const figure = currentFigure(figures, input.key, now);
          const age = figure ? figureAgeDays(figure, now) : undefined;
          return (
            <li key={input.key} className="space-y-1 border-t border-[var(--tt-rule)] pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm">{input.label}</span>
                <span className="text-sm">
                  {figure ? figure.value : <span className="text-[var(--tt-ink-muted)]">Not recorded</span>}
                </span>
              </div>
              <p className="text-xs text-[var(--tt-ink-muted)]">
                {age === undefined
                  ? input.feeds
                  : `${age} day${age === 1 ? "" : "s"} old${age > FIGURE_STALE_DAYS ? " — worth confirming" : ""}. ${input.feeds}`}
              </p>
            </li>
          );
        })}
      </ul>

      <form
        className="space-y-3 border-t border-[var(--tt-rule)] pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-xs text-[var(--tt-ink-muted)]">
            <span>Figure</span>
            <select
              value={key}
              onChange={(event) => setKey(event.target.value)}
              className="w-full rounded-md border border-[var(--tt-rule)] bg-transparent p-2 text-sm"
            >
              {FIGURE_INPUTS.map((input) => (
                <option key={input.key} value={input.key}>
                  {input.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-[var(--tt-ink-muted)]">
            <span>Value ({definition.unit})</span>
            <input
              value={value}
              inputMode="decimal"
              placeholder={definition.placeholder ?? ""}
              onChange={(event) => setValue(event.target.value)}
              className="w-full rounded-md border border-[var(--tt-rule)] bg-transparent p-2 text-sm"
            />
          </label>
          <label className="space-y-1 text-xs text-[var(--tt-ink-muted)]">
            <span>True as of</span>
            <input
              type="date"
              value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
              className="w-full rounded-md border border-[var(--tt-rule)] bg-transparent p-2 text-sm"
            />
          </label>
        </div>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Anything worth remembering about this number (optional)"
          className="w-full rounded-md border border-[var(--tt-rule)] bg-transparent p-2 text-sm"
        />
        <div className="flex items-center justify-between gap-3">
          <MetaPill>{disabled ? "Recording unavailable" : `Feeds: ${definition.feeds}`}</MetaPill>
          <TTButton type="submit" variant="secondary" disabled={!valid || saving || disabled}>
            {saving ? "Recording…" : "Record figure"}
          </TTButton>
        </div>
        {disabled && disabledReason ? (
          <p className="text-xs text-[var(--tt-ink-muted)]">{disabledReason}</p>
        ) : null}
      </form>
    </TTCard>
  );
}
