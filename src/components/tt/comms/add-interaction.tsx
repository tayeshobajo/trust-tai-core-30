/**
 * Add an interaction.
 *
 * Something happened away from Comms: a text, a call, a coffee. This captures
 * it in as few words as possible and keeps its provenance honest, so a line
 * Tai typed never reads as something an integration observed.
 *
 * For calls, meetings and pasted conversations, Comms reads the capture and
 * proposes what it thinks it found. Those captures cannot be saved straight
 * from the form: they pass through a draft the person has to read and confirm,
 * so nothing derived is ever written without a deliberate yes.
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
  /**
   * The person explicitly recorded this capture as the counterparty's own
   * words (a quote from a call, a note they wrote). Only then may
   * counterparty-only reads treat the capture as their evidence.
   */
  theirWords?: boolean;
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
  const [step, setStep] = useState<"capture" | "confirm">("capture");
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [theirWords, setTheirWords] = useState(false);

  const definition = interactionDefinition(type);
  const derived = useMemo(
    () => (definition.narrative ? deriveInteraction(value): { summary: "", suggestions: [] }),
    [definition.narrative, value],
  );

  const confirmedList = derived.suggestions.filter((entry) => ticked[entry.id]);

  function save() {
    const text = value.trim();
    if (!text) return;
    /** A narrative capture only reaches the record through the draft step. */
    if (definition.narrative && step !== "confirm") {
      setStep("confirm");
      return;
    }
    const occurredAt = new Date(when).toISOString();
    const summary = definition.narrative ? derived.summary || text.slice(0, 120): text.slice(0, 200);
    onSave({
      type,
      summary,
...(definition.narrative ? { body: text }: {}),
      occurredAt: Number.isNaN(Date.parse(occurredAt)) ? new Date().toISOString(): occurredAt,
      confirmed: confirmedList,
...(definition.narrative && theirWords ? { theirWords: true }: {}),
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
          {step === "confirm" ? null: (
          <>
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
                    setStep("capture");
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
                setStep("capture");
              }}
              rows={definition.narrative ? 6: 3}
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

          </>
          )}

          {step === "confirm" ? (
            <section className="space-y-3.5">
              <div className="rounded-lg border border-border bg-secondary/30 p-3.5">
                <p className="tt-eyebrow">What will be written down</p>
                <p className="mt-1.5 text-[13px] text-foreground">{derived.summary || value.trim().slice(0, 120)}</p>
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  Recorded as {new Date(when).toLocaleString()} · added by {userLabel}. The full
                  capture is kept with it.
                </p>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-card p-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={theirWords}
                  onChange={(event) => setTheirWords(event.target.checked)}
                />
                <span>
                  <span className="block text-[13px] text-foreground">
                    These are {personName}&rsquo;s own words
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    Tick this when the capture quotes what they actually said. Reads that only
                    ever listen to the other person, like recognizing a need they revealed, will treat it as their voice, not yours.
                  </span>
                </span>
              </label>


              <div>
                <p className="tt-eyebrow">What Comms thinks it found</p>
                {derived.suggestions.length === 0 ? (
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    Nothing structured stood out. The capture will be saved as written, and no
                    facts will be added to memory.
                  </p>
                ): (
                  <>
                    <p className="mt-1.5 text-[12px] text-muted-foreground">
                      Nothing here reaches memory unless you tick it. Untick anything Comms read
                      wrong.
                    </p>
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
                                  ? ` \u00b7 due ${new Date(entry.due).toLocaleDateString()}`
: ""}
                              </span>
                              <span className="mt-0.5 block text-[13px] text-foreground">
                                {entry.text}
                              </span>
                              <span className="mt-0.5 block text-[12px] text-muted-foreground">
                                Because you wrote: \u201c{entry.because}\u201d
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      {confirmedList.length === 0
                        ? "Nothing is ticked, so only the interaction itself will be saved."
: `${confirmedList.length} of ${derived.suggestions.length} will be added to memory.`}
                    </p>
                  </>
                )}
              </div>
            </section>
          ): null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <TTButton
            variant="quiet"
            size="sm"
            type="button"
            onClick={step === "confirm" ? () => setStep("capture"): onCancel}
          >
            {step === "confirm" ? "Back to the capture": "Cancel"}
          </TTButton>
          <TTButton size="sm" type="button" onClick={save} disabled={busy || !value.trim()}>
            {busy
              ? "Saving\u2026"
: definition.narrative && step === "capture"
                ? "Read this back"
: "Save interaction"}
          </TTButton>
        </footer>
      </div>
    </div>
  );
}
