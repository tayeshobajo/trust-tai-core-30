/**
 * The Studio composer.
 *
 * A person says what they want written, in a sentence, and attaches the
 * material it should sound like. Studio reads that sentence back as a plan
 * they can correct before anything runs, and every setting says whether it
 * came from their words, from a choice they made, or from a default.
 *
 * Voice & Sources is a library, not a bin. Material attached during this
 * request is active for it. Material saved earlier stays saved, but has to
 * be included on purpose, so nothing quietly influences writing forever.
 *
 * The composer never writes and never publishes. It produces a request.
 */

import { useEffect, useMemo, useRef, useState } from "react";

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
  provenanceLine,
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

const KIND_LABEL: Record<ContentSourceKind, string> = {
  text: "Pasted text",
  markdown: "Markdown",
  linkedin: "LinkedIn writing",
  article: "Article",
  audio: "Recording",
  video: "Video",
  document: "Document",
  url: "Link",
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
  const [refine, setRefine] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [attach, setAttach] = useState<"none" | "text" | "link">("none");
  const [pasteLabel, setPasteLabel] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  /* Anything already in the library when this screen opened is "saved
     material". Anything that appears afterwards was attached for this
     request, so it starts active. */
  const librarySnapshot = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (librarySnapshot.current === null && sources.length >= 0) {
      librarySnapshot.current = new Set(sources.map((source) => source.id));
    }
  }, [sources]);
  const savedBefore = librarySnapshot.current ?? new Set<string>();

  /* Interpretation is deterministic: no model call happens before a person
     has seen the plan and agreed with it. */
  const request = useMemo<InterpretedRequest>(() => {
    const base = interpretRequest(prompt);
    const settings = { ...base.settings } as ContentRequestSettings;
    for (const [key, value] of Object.entries(overrides)) {
      if (!value?.trim()) continue;
      settings[key as keyof ContentRequestSettings] = { value: value.trim(), origin: "explicit" };
    }
    return { ...base, count: countOverride ?? base.count, settings };
  }, [prompt, overrides, countOverride]);

  const isActive = (source: ContentSource) => {
    if (!usableAsVoice(source)) return false;
    const explicit = selected[source.id];
    if (explicit !== undefined) return explicit;
    return !savedBefore.has(source.id);
  };

  const attached = sources.filter((source) => !savedBefore.has(source.id));
  const library = sources.filter((source) => savedBefore.has(source.id));
  const activeSources = sources.filter(isActive);
  const blockers = requestBlockers(request);

  function keepPastedText() {
    const text = pasteText.trim();
    if (!text) return;
    onAddPasted({
      kind: "text",
      label: pasteLabel.trim() || "Pasted text",
      origin: "pasted into Studio",
      mimeType: "text/plain",
      byteSize: new Blob([text]).size,
      extractedText: text,
      extractionState: "extracted",
      extractionNote: "Pasted directly, so it was read exactly as given.",
    });
    setPasteText("");
    setPasteLabel("");
    setAttach("none");
  }

  function keepLink() {
    const url = linkUrl.trim();
    if (!url) return;
    const plan = extractionPlan("url");
    onAddPasted({
      kind: "url",
      label: linkLabel.trim() || url,
      origin: url,
      mimeType: "text/uri-list",
      byteSize: 0,
      extractedText: "",
      extractionState: plan.state,
      extractionNote: plan.note,
    });
    setLinkUrl("");
    setLinkLabel("");
    setAttach("none");
  }

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

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="text-sm">
                <span className="text-muted-foreground">Posts</span>{" "}
                <TTInput
                  type="number"
                  min={1}
                  max={MAX_POSTS}
                  value={request.count}
                  disabled={running}
                  onChange={(event) => setCountOverride(Number(event.target.value) || 1)}
                  className="mt-1 inline-block h-9 w-24 px-3"
                />
              </label>
              <button
                type="button"
                onClick={() => setRefine((open) => !open)}
                className="text-sm underline text-muted-foreground"
              >
                {refine ? "Hide the details" : "Change the details"}
              </button>
            </div>

            {refine ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
            ) : null}
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
            onClick={() => onSubmit({ request, sourceIds: activeSources.map((source) => source.id) })}
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
          title="Voice & Sources"
          description="Writing you already own, kept once and reused. Studio uses it as reference for cadence, never as facts and never copied."
        />

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            for (const file of Array.from(event.dataTransfer.files ?? [])) onAddFile(file);
          }}
          className={`mt-2 rounded-lg border border-dashed p-5 text-center transition ${
            dragging ? "border-primary bg-primary/5" : "border-border"
          }`}
        >
          <p className="text-sm">Drop files here</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Text and Markdown are read. PDFs, documents and recordings are kept as references and say
            so.
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-3">
            <TTButton variant="secondary" onClick={() => fileInput.current?.click()}>
              Choose a file
            </TTButton>
            <TTButton
              variant="secondary"
              onClick={() => setAttach((current) => (current === "text" ? "none" : "text"))}
            >
              Paste writing
            </TTButton>
            <TTButton
              variant="secondary"
              onClick={() => setAttach((current) => (current === "link" ? "none" : "link"))}
            >
              Add a link
            </TTButton>
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              for (const file of Array.from(event.target.files ?? [])) onAddFile(file);
              event.target.value = "";
            }}
          />
        </div>

        {attach === "text" ? (
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
            <TTButton onClick={keepPastedText} disabled={!pasteText.trim()}>
              Keep this reference
            </TTButton>
          </div>
        ) : null}

        {attach === "link" ? (
          <div className="mt-4 space-y-3 rounded-lg border border-border p-4">
            <TTInput
              value={linkLabel}
              onChange={(event) => setLinkLabel(event.target.value)}
              placeholder="What is this? For example: my article on delivery reviews"
            />
            <TTInput
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="https://"
              aria-label="Reference link"
            />
            <p className="text-xs text-muted-foreground">
              Studio does not open links, so the page text is not read. The link is kept as a
              reference. To use the writing itself, paste the text.
            </p>
            <TTButton onClick={keepLink} disabled={!linkUrl.trim()}>
              Keep this link
            </TTButton>
          </div>
        ) : null}

        <SourceGroup
          title="Attached for this request"
          empty="Nothing attached yet. Studio will write in the Trust Tai voice on its own."
          sources={attached}
          isActive={isActive}
          onToggle={(id, next) => setSelected((current) => ({ ...current, [id]: next }))}
          onRemove={onRemoveSource}
        />

        {library.length > 0 ? (
          <SourceGroup
            title="Saved in your library"
            empty=""
            note="Saved material stays saved but is not used unless you include it in this request."
            sources={library}
            isActive={isActive}
            onToggle={(id, next) => setSelected((current) => ({ ...current, [id]: next }))}
            onRemove={onRemoveSource}
          />
        ) : null}

        <p className="mt-5 text-sm text-muted-foreground">
          {activeSources.length === 0
            ? "No sources are active for this request."
            : `${activeSources.length} source${activeSources.length === 1 ? "" : "s"} active for this request.`}
        </p>
      </TTCard>
    </div>
  );
}

function SourceGroup({
  title,
  note,
  empty,
  sources,
  isActive,
  onToggle,
  onRemove,
}: {
  title: string;
  note?: string;
  empty: string;
  sources: ContentSource[];
  isActive: (source: ContentSource) => boolean;
  onToggle: (sourceId: string, next: boolean) => void;
  onRemove: (sourceId: string) => void;
}) {
  return (
    <div className="mt-6">
      <p className="text-sm font-medium">{title}</p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
      <div className="mt-3 space-y-2">
        {sources.length === 0 && empty ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : null}
        {sources.map((source) => {
          const readable = usableAsVoice(source);
          const active = isActive(source);
          return (
            <div key={source.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{source.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{provenanceLine(source)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {EXTRACTION_LABEL[source.extractionState]}
                    {source.extractionNote ? ` · ${source.extractionNote}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <MetaPill>{KIND_LABEL[source.kind]}</MetaPill>
                  <MetaPill>{active ? "Active for this request" : "Not in this request"}</MetaPill>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                {readable ? (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(event) => onToggle(source.id, event.target.checked)}
                    />
                    Use in this request
                  </label>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Held as a reference only, because no text could be read from it.
                  </span>
                )}
                <button
                  type="button"
                  className="text-xs underline text-muted-foreground"
                  onClick={() => onRemove(source.id)}
                >
                  Remove from library
                </button>
              </div>
            </div>
          );
        })}
      </div>
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
