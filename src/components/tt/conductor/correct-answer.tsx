/**
 * Telling the Conductor it is wrong.
 *
 * The learning loop needs a door, and this is it. Four honest ways an answer
 * can be wrong, a bad number, a bad read, work already handled, or a
 * suggestion that simply is not useful, each recorded with a name and a
 * reason. Corrections are never silent: they appear in the learning trail and
 * they change the next answer.
 */

import { useState } from "react";

import { MetaPill, TTButton, TTCard } from "@/components/tt/primitives";
import { FIGURE_INPUTS, type ConductorAnswer, type CorrectionKind } from "@/domain/conductor";

const KINDS: { kind: CorrectionKind; label: string; hint: string }[] = [
  {
    kind: "wrong_figure",
    label: "A number is wrong",
    hint: "Record the right one; it becomes decided truth immediately.",
  },
  {
    kind: "wrong_read",
    label: "The read is wrong",
    hint: "The numbers may be right but the conclusion is not.",
  },
  {
    kind: "already_handled",
    label: "Already handled",
    hint: "This was dealt with outside the suite.",
  },
  {
    kind: "not_useful",
    label: "Not useful",
    hint: "Do not raise this again for a fortnight.",
  },
];

export interface CorrectionDraft {
  kind: CorrectionKind;
  note: string;
  subjectKey?: string;
  figure?: { key: string; value: number; unit?: string; asOf: string };
}

export interface CorrectAnswerProps {
  answer: ConductorAnswer;
  saving?: boolean;
  saved?: boolean;
  onCorrect: (draft: CorrectionDraft) => void | Promise<void>;
}

export function CorrectAnswer({ answer, saving, saved, onCorrect }: CorrectAnswerProps) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CorrectionKind>("wrong_read");
  const [note, setNote] = useState("");
  const [figureKey, setFigureKey] = useState(FIGURE_INPUTS[0]!.key);
  const [figureValue, setFigureValue] = useState("");
  const [subjectKey, setSubjectKey] = useState("");

  const parsed = Number(figureValue);
  const needsFigure = kind === "wrong_figure";
  const needsSubject = kind === "not_useful" || kind === "already_handled";
  const subjects = [
    ...answer.improvements.map((row) => ({ key: row.id, label: row.headline })),
    ...answer.proposedActions.map((row) => ({ key: row.id, label: row.title })),
  ];
  const valid =
    note.trim().length > 0 &&
    (!needsFigure || (figureValue.trim().length > 0 && Number.isFinite(parsed)));

  async function submit() {
    if (!valid) return;
    const chosen = needsSubject && subjectKey ? subjectKey : undefined;
    await onCorrect({
      kind,
      note: note.trim(),
      ...(chosen ? { subjectKey: chosen } : {}),
      ...(needsFigure
        ? {
            figure: {
              key: figureKey,
              value: parsed,
              asOf: new Date().toISOString(),
            },
          }
        : {}),
    });
    setNote("");
    setFigureValue("");
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--tt-ink-muted)]">
          {saved
            ? "Recorded. The next answer will take it into account."
            : "If this is wrong, say so, it changes what comes next."}
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-[var(--tt-ink-muted)] underline underline-offset-4 transition hover:text-[var(--tt-ink)]"
        >
          This isn&rsquo;t right
        </button>
      </div>
    );
  }

  return (
    <TTCard className="space-y-4 p-5">
      <div className="flex flex-wrap gap-2">
        {KINDS.map((option) => (
          <button
            key={option.kind}
            type="button"
            onClick={() => setKind(option.kind)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              kind === option.kind
                ? "border-[var(--tt-ink)] text-[var(--tt-ink)]"
                : "border-[var(--tt-rule)] text-[var(--tt-ink-muted)] hover:text-[var(--tt-ink)]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-[var(--tt-ink-muted)]">
        {KINDS.find((option) => option.kind === kind)?.hint}
      </p>

      {needsFigure ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-[var(--tt-ink-muted)]">
            <span>Which figure</span>
            <select
              value={figureKey}
              onChange={(event) => setFigureKey(event.target.value)}
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
            <span>The right value</span>
            <input
              value={figureValue}
              inputMode="decimal"
              onChange={(event) => setFigureValue(event.target.value)}
              className="w-full rounded-md border border-[var(--tt-rule)] bg-transparent p-2 text-sm"
            />
          </label>
        </div>
      ) : null}

      {needsSubject && subjects.length > 0 ? (
        <label className="space-y-1 text-xs text-[var(--tt-ink-muted)]">
          <span>Which suggestion</span>
          <select
            value={subjectKey}
            onChange={(event) => setSubjectKey(event.target.value)}
            className="w-full rounded-md border border-[var(--tt-rule)] bg-transparent p-2 text-sm"
          >
            <option value="">The answer as a whole</option>
            {subjects.map((subject) => (
              <option key={subject.key} value={subject.key}>
                {subject.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <textarea
        value={note}
        rows={2}
        onChange={(event) => setNote(event.target.value)}
        placeholder="What did it get wrong, and what is actually true?"
        className="w-full resize-none rounded-md border border-[var(--tt-rule)] bg-transparent p-3 text-sm outline-none focus:border-[var(--tt-ink)]"
      />

      <div className="flex items-center justify-between gap-3">
        <MetaPill>Recorded against your name</MetaPill>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs text-[var(--tt-ink-muted)] underline underline-offset-4"
          >
            Cancel
          </button>
          <TTButton variant="secondary" disabled={!valid || saving} onClick={() => void submit()}>
            {saving ? "Recording…" : "Record correction"}
          </TTButton>
        </div>
      </div>
    </TTCard>
  );
}
