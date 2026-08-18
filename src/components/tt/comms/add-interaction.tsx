/**
 * Add an interaction.
 *
 * Something happened away from Comms: a text, a call, a coffee. This captures
 * it in as few words as possible and keeps its provenance honest, so a line
 * Tai typed never reads as something an integration observed.
 *
 * For calls, meetings and pasted conversations, Comms reads the capture and
 * proposes what it thinks it found. Nothing derived is saved until a person
 * ticks it.
 */

import { useMemo, useState } from "react";

import { TTButton, TTField, TTInput } from "@/components/tt/primitives";
import {
  deriveInteraction,
  type DerivedSuggestion,
} from "@/data/comms-derive-interaction";
import {
  INTERACTION_TYPES,
  interactionDefinition,
  type InteractionType,
} from "@/domain/comms-interactions";
import { cn } from "@/lib/utils";

export interface InteractionSubmission {
  type: InteractionType;
  summary: string;
  body?: string;
  occurredAt: string;
  /** Only the suggestions a person actually confirmed. */
  confirmed: DerivedSuggestion[];
}

function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const KIND_LABEL: Record<DerivedSuggestion["kind"], string> = {
  learned: "What was learned",
  commitment: "Promise",
  next_move: "Next move",
};

export function AddInteraction({
  personName,
  userLabel,
  busy,
  onCancel,
  onSave,
}: {
  personName: string;
  userLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onSave: (submission: InteractionSubmission) => void;
}) {
  const [type, setType] = useState<InteractionType>("they_texted");
  const [value, setValue] = useState("");
  const [when, setWhen] = useState(() => localDateTimeValue(new Date()));
  const [reviewing, setReviewing] = useState(false);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});

  const definition = interactionDefinition(type);
  const derived = useMemo(
    () => (definition.narrative ? deriveInteraction(value) : { summary: "", suggestions: [] }),
    [definition.narrative, value],
  );

  function save() {
    const text = value.trim();
    if (!text) return;
    const occurredAt = new Date(when).toISOString();
    const summary = definition.narrative ? derived.summary || text.slice(0, 120) : text.slice(0, 200);
    onSave({
      type,
      summary,
      ...(definition.narrative ? { body: text } : {}),
      occurredAt: Number.isNaN(Date.parse(occurredAt)) ? new Date().toISOString() : occurredAt,
      confirmed: derived.suggestions.filter((entry) => ticked[entry.id]),
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Add an interaction with ${personName}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/25 p-0 backdrop-blur-sm sm:items-center sm:p-6"
    >
      <button type="button" aria-label="Close" className="absolute inset-0" onClick={onCancel} />
      <div className="tt-rise relative flex max-h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-t-xl border border-border bg-card sm:rounded-xl">
        <header className="border-b border-border px-5 py-4">
          <p className="tt-eyebrow">Add interaction</p>
          <h2 className="mt-1 text-lg text-foreground">
            Something happened with {personName}
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Keep it short. Comms records it as added by {userLabel}, never as something a
            connected account observed.
          </p>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <fieldset>
            <legend className="tt-eyebrow">What kind</legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {INTERACTION_TYPES.map((entry) => (
                <button
                  key={entry.type}
                  type="button"
                  aria-pressed={type === entry.type}
                  onClick={() => {
                    setType(entry.type);
                    setReviewing(false);
                    setTicked({});
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    type === entry.type
                      ? "border-royal/40 bg-royal/8 text-royal"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </fieldset>

          <TTField label="What happened">
            <textarea
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setReviewing(false);
              }}
              rows={definition.narrative ? 6 : 3}
              placeholder={definition.placeholder}
              className="w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </TTField>

          <TTField label="When" optional>
            <TTInput
              type="datetime-local"
              className="h-10"
              value={when}
              onChange={(event) => setWhen(event.target.value)}
            />
          </TTField>

          {definition.narrative ? (
            <section className="rounded-lg border border-border bg-secondary/30 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="tt-eyebrow">What Comms thinks it found</p>
                <TTButton
                  variant="quiet"
                  size="sm"
                  type="button"
                  onClick={() => setReviewing(true)}
                  disabled={!value.trim()}
                >
                  Read this back
                </TTButton>
              </div>

              {!reviewing ? (
                <p className="mt-2 text-[12px] text-muted-foreground">
                  Nothing is derived until you ask. Anything found stays a suggestion until you
                  tick it.
                </p>
              ) : derived.suggestions.length === 0 ? (
                <p className="mt-2 text-[12px] text-muted-foreground">
                  Nothing structured stood out. The capture is saved as written.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {derived.suggestions.map((entry) => (
                    <li key={entry.id}>
                      <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-card p-2.5">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={Boolean(ticked[entry.id])}
                          onChange={(event) =>
                            setTicked((current) => ({
                              ...current,
                              [entry.id]: event.target.checked,
                            }))
                          }
                        />
                        <span className="min-w-0">
                          <span className="tt-eyebrow block">
                            {KIND_LABEL[entry.kind]}
                            {entry.due
                              ? ` · due ${new Date(entry.due).toLocaleDateString()}`
                              : ""}
                          </span>
                          <span className="mt-0.5 block text-[13px] text-foreground">
                            {entry.text}
                          </span>
                          <span className="mt-0.5 block text-[12px] text-muted-foreground">
                            Because you wrote: “{entry.because}”
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <TTButton variant="quiet" size="sm" type="button" onClick={onCancel}>
            Cancel
          </TTButton>
          <TTButton size="sm" type="button" onClick={save} disabled={busy || !value.trim()}>
            {busy ? "Saving…" : "Save interaction"}
          </TTButton>
        </footer>
      </div>
    </div>
  );
}
