/**
 * The Studio composer.
 *
 * A person says what they want written, in a sentence, and attaches the
 * material it should sound like. Studio reads that sentence back as a plan
 * they can correct before anything runs, and every setting says whether it
 * came from their words, from a choice they made, or from a default.
 *
 * The composer never writes and never publishes. It produces a request.
 */

import { useMemo, useRef, useState } from "react";

import { MetaPill, SectionHeading, TTButton, TTCard, TTInput } from "@/components/tt/primitives";
import {
  MAX_POSTS,
  interpretRequest,
  planLine,
  requestBlockers,
  type ContentRequestSettings,
  type InterpretedRequest,
  type RequestSetting,
} from "@/domain/content-request";
import {
  EXTRACTION_LABEL,
  extractionPlan,
  kindForFile,
  usableAsVoice,
  type ContentSource,
  type ContentSourceKind,
} from "@/domain/content-source";

export interface ComposerSubmission {
  request: InterpretedRequest;
  sourceIds: string[];
}

export interface PastedSource {
  kind: ContentSourceKind;
  label: string;
  origin: string;
  mimeType: string;
  byteSize: number;
  extractedText: string;
  extractionState: ContentSource["extractionState"];
  extractionNote: string;
}

const SETTING_LABEL: Record<keyof ContentRequestSettings, string> = {
  audience: "Audience",
  length: "Length",
  structure: "Structure",
  angle: "Angle",
  searchIntent: "Search intent",
  cta: "Call to action",
  imageDirection: "Image direction",
  voice: "Voice",
};

const ORIGIN_LABEL: Record<RequestSetting["origin"], string> = {
  explicit: "you set this",
  inferred: "read from your words",
  default: "default",
};

const EXAMPLES = [
  "Write 10 posts about fractional operations for founders, practical, around 1200 words each.",
  "Six posts on why RevOps projects stall, for operations leads, with a case-shaped structure.",
  "Four short posts answering what a relationship operating system actually is.",
];

export function StudioComposer({
  sources,
  onAddPasted,
  onAddFile,
  onRemoveSource,
  onSubmit,
  running,
  progress,
  publisherNote,
}: {
  sources: ContentSource[];
  onAddPasted: (input: PastedSource) => void;
  onAddFile: (file: File) => void;
  onRemoveSource: (sourceId: string) => void;
  onSubmit: (submission: ComposerSubmission) => void;
  running: boolean;
  progress: string[];
  publisherNote?: string;
}) {
  const [prompt, setPrompt] = useState("");
  const [overrides, setOverrides] = useState<Partial<Record<keyof ContentRequestSettings, string>>>({});
  const [countOverride, setCountOverride] = useState<number | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteLabel, setPasteLabel] = useState("");
  const [pasteText, setPasteText] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);

  /* Interpretation is deterministic: no model call happens before a person
     has seen the plan and agreed with it. */
  const request = useMemo<InterpretedRequest>(() => {
    const base = interpretRequest(prompt);
    const settings = { ...base.settings } as ContentRequestSettings;
    for (const [key, value] of Object.entries(overrides)) {
      if (!value?.trim()) continue;
      settings[key as keyof ContentRequestSettings] = { value: value.trim(), origin: "explicit" };
    }
    return {
      ...base,
      count: countOverride ?? base.count,
      settings,
    };
  }, [prompt, overrides, countOverride]);

  const usable = sources.filter(usableAsVoice);
  const activeSources = usable.filter((source) => selected[source.id] !== false);
  const blockers = requestBlockers(request);

  return (
    <div className="space-y-6">
      <TTCard className="p-6">
        <SectionHeading
          title="Say what you would like written"
          description="One sentence is enough. Studio reads it back as a plan you can correct before anything is written."
        />

        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={running}
          rows={3}
          placeholder="Write 10 posts about fractional operations for founders, practical, around 1200 words each."
          className="mt-4 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
          aria-label="What would you like written"
        />

        {!prompt.trim() ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setPrompt(example)}
                className="rounded-full border border-border px-3 py-1 text-left text-xs text-muted-foreground transition hover:border-primary/50"
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}

        {prompt.trim() ? (
          <div className="mt-5 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Here is what I understood</p>
            <p className="mt-1 text-sm text-muted-foreground">{planLine(request, activeSources.length)}</p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="text-muted-foreground">How many posts</span>
                <TTInput
                  type="number"
                  min={1}
                  max={MAX_POSTS}
                  value={request.count}
                  disabled={running}
                  onChange={(event) => setCountOverride(Number(event.target.value) || 1)}
                  className="mt-1"
                />
              </label>

              {(Object.keys(SETTING_LABEL) as (keyof ContentRequestSettings)[]).map((key) => {
                const setting = request.settings[key];
                return (
                  <label key={key} className="text-sm">
                    <span className="text-muted-foreground">
                      {SETTING_LABEL[key]}{" "}
                      <span className="text-xs">({ORIGIN_LABEL[setting.origin]})</span>
                    </span>
                    <TTInput
                      value={overrides[key] ?? setting.value}
                      disabled={running}
                      onChange={(event) =>
                        setOverrides((current) => ({ ...current, [key]: event.target.value }))
                      }
                      className="mt-1"
                    />
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}

        {blockers.length > 0 && prompt.trim() ? (
          <ul className="mt-4 list-disc pl-5 text-sm text-muted-foreground">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <TTButton
            onClick={() =>
              onSubmit({ request, sourceIds: activeSources.map((source) => source.id) })
            }
            disabled={running || blockers.length > 0}
          >
            {running ? "Writing" : "Prepare the batch"}
          </TTButton>
          <span className="text-sm text-muted-foreground">
            Nothing publishes from here. A prepared batch goes to Approvals for one decision.
          </span>
        </div>

        {progress.length > 0 ? (
          <ol className="mt-4 space-y-1 text-sm text-muted-foreground">
            {progress.slice(-6).map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))}
          </ol>
        ) : null}

        {publisherNote ? <p className="mt-4 text-sm text-muted-foreground">{publisherNote}</p> : null}
      </TTCard>

      <TTCard className="p-6">
        <SectionHeading
          title="What it should sound like"
          description="Attach writing you already own. Studio uses it as reference for cadence, never as facts and never copied."
        />

        <div className="mt-4 flex flex-wrap gap-3">
          <TTButton variant="secondary" onClick={() => setPasteOpen((open) => !open)}>
            {pasteOpen ? "Close" : "Paste text"}
          </TTButton>
          <TTButton variant="secondary" onClick={() => fileInput.current?.click()}>
            Add a file
          </TTButton>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onAddFile(file);
              event.target.value = "";
            }}
          />
        </div>

        {pasteOpen ? (
          <div className="mt-4 space-y-3 rounded-lg border border-border p-4">
            <TTInput
              value={pasteLabel}
              onChange={(event) => setPasteLabel(event.target.value)}
              placeholder="Where is this from? For example: my LinkedIn post on hiring"
            />
            <textarea
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              rows={6}
              placeholder="Paste the writing here"
              className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
              aria-label="Pasted reference text"
            />
            <TTButton
              onClick={() => {
                const text = pasteText.trim();
                if (!text) return;
                const label = pasteLabel.trim() || "Pasted text";
                onAddPasted({
                  kind: "text",
                  label,
                  origin: "pasted into Studio",
                  mimeType: "text/plain",
                  byteSize: new Blob([text]).size,
                  extractedText: text,
                  extractionState: "extracted",
                  extractionNote: "Pasted directly, so it was read exactly as given.",
                });
                setPasteText("");
                setPasteLabel("");
                setPasteOpen(false);
              }}
              disabled={!pasteText.trim()}
            >
              Keep this reference
            </TTButton>
          </div>
        ) : null}

        <div className="mt-5 space-y-2">
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing attached. Studio will write in the Trust Tai voice on its own.
            </p>
          ) : null}
          {sources.map((source) => {
            const readable = usableAsVoice(source);
            return (
              <div
                key={source.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{source.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {EXTRACTION_LABEL[source.extractionState]}
                    {source.extractionNote ? ` · ${source.extractionNote}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <MetaPill>{source.kind}</MetaPill>
                  {readable ? (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={selected[source.id] !== false}
                        onChange={(event) =>
                          setSelected((current) => ({
                            ...current,
                            [source.id]: event.target.checked,
                          }))
                        }
                      />
                      Use in this run
                    </label>
                  ) : null}
                  <button
                    type="button"
                    className="text-xs underline text-muted-foreground"
                    onClick={() => onRemoveSource(source.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </TTCard>
    </div>
  );
}

/** Read a dropped or chosen file honestly: text is read, anything else says so. */
export async function readFileAsSource(file: File): Promise<PastedSource> {
  const kind = kindForFile({ name: file.name, type: file.type });
  const plan = extractionPlan(kind);
  const base: PastedSource = {
    kind,
    label: file.name,
    origin: "uploaded to Studio",
    mimeType: file.type || "application/octet-stream",
    byteSize: file.size,
    extractedText: "",
    extractionState: plan.state,
    extractionNote: plan.note,
  };
  if (!plan.readable) return base;
  const text = await file.text();
  return {
    ...base,
    extractedText: text,
    extractionState: text.trim() ? "extracted" : "failed",
    extractionNote: text.trim() ? plan.note : "The file was empty, so there was nothing to read.",
  };
}
