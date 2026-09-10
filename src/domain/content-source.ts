/**
 * Voice and reference material.
 *
 * A source is evidence a person gave the room: their own LinkedIn writing, an
 * existing article, a recording of them talking. It is never a second copy of
 * canonical content, and it is never quietly used forever: each request says
 * which sources were active for it.
 *
 * Extraction is where honesty matters most. Plain text and markdown can be
 * read here and now. A PDF, a Word file or a recording cannot, because no
 * extraction or transcription provider is connected to this project. Those
 * are stored with the reason, not with an empty string pretending to be text.
 */

import type { ID, ISODateTime } from "./entities";

export type ContentSourceKind =
  | "text"
  | "markdown"
  | "linkedin"
  | "article"
  | "audio"
  | "video"
  | "document"
  | "url";

export type ExtractionState =
  /** Real text is held for this source. */
  | "extracted"
  /** The file type cannot be read at all. */
  | "unsupported"
  /** It could be read, but no provider is connected to do it. */
  | "not_configured"
  | "failed"
  | "pending";

export interface ContentSource {
  id: ID;
  organizationId: ID;
  kind: ContentSourceKind;
  label: string;
  origin: string;
  mimeType: string;
  byteSize: number;
  extractedText: string;
  extractionState: ExtractionState;
  extractionNote: string;
  provenance: Record<string, unknown>;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export const EXTRACTION_LABEL: Record<ExtractionState, string> = {
  extracted: "Text read",
  unsupported: "Cannot be read",
  not_configured: "Transcription not configured",
  failed: "Could not be read",
  pending: "Waiting",
};

/** What a file is, by its own type rather than by its name. */
export function kindForFile(file: { name: string; type: string }): ContentSourceKind {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (type === "text/markdown" || name.endsWith(".md")) return "markdown";
  if (type.startsWith("text/") || name.endsWith(".txt")) return "text";
  return "document";
}

/**
 * Can this file's text be read in the browser, right now, truthfully?
 *
 * Only plain text and markdown. Everything else gets a named reason: a
 * recording needs a transcription provider nobody has connected, and a PDF or
 * Word file needs an extractor this project does not have either.
 */
export function extractionPlan(kind: ContentSourceKind): {
  readable: boolean;
  state: ExtractionState;
  note: string;
} {
  if (kind === "text" || kind === "markdown" || kind === "linkedin" || kind === "article") {
    return { readable: true, state: "extracted", note: "" };
  }
  /* A link is kept as a reference. Studio does not fetch web pages, so it
     must never look as though the page was read. */
  if (kind === "url") {
    return {
      readable: false,
      state: "not_configured",
      note: "Studio did not open this link, so the page text was not read. The link is kept as a reference. Paste the text to use it as voice.",
    };
  }
  if (kind === "audio" || kind === "video") {
    return {
      readable: false,
      state: "not_configured",
      note: "No transcription provider is connected, so this recording is held as a reference but nothing was transcribed from it.",
    };
  }
  return {
    readable: false,
    state: "unsupported",
    note: "Trust Tai cannot read this file type yet. Paste the text instead and it will be used as a voice reference.",
  };
}

/** One plain line a person can read about where a source came from. */
export function provenanceLine(source: ContentSource): string {
  const when = new Date(source.createdAt);
  const date = Number.isNaN(when.getTime())
    ? "unknown date"
    : when.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const size = source.byteSize > 0 ? `${Math.max(1, Math.round(source.byteSize / 1024))} KB` : "";
  return [source.origin || "unknown origin", `added ${date}`, size].filter(Boolean).join(" · ");
}


/** Only a source with real text can influence a draft. */
export function usableAsVoice(source: ContentSource): boolean {
  return source.extractionState === "extracted" && source.extractedText.trim().length > 0;
}

/** Bounded reference excerpts. Reference evidence, never a body of content. */
export function voiceExcerpts(
  sources: ContentSource[],
  limits: { perSource: number; total: number } = { perSource: 2400, total: 12000 },
): { label: string; kind: ContentSourceKind; excerpt: string }[] {
  const out: { label: string; kind: ContentSourceKind; excerpt: string }[] = [];
  let budget = limits.total;
  for (const source of sources) {
    if (!usableAsVoice(source) || budget <= 0) continue;
    const excerpt = source.extractedText.trim().slice(0, Math.min(limits.perSource, budget));
    budget -= excerpt.length;
    out.push({ label: source.label, kind: source.kind, excerpt });
  }
  return out;
}
