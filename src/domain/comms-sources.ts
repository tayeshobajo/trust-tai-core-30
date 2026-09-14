/**
 * Review source material: what Comms can actually read, and what it says
 * plainly that it cannot.
 *
 * The law here is honesty about extraction. A source is "parsed" only when
 * real text was actually recovered from it. Every other outcome keeps its own
 * name and its own sentence:
 *
 *   - unsupported: the format is real but Comms has no reader for it yet,
 *   - unreadable: the format is supported but nothing legible came out,
 *   - empty:      the file or paste carries no text at all.
 *
 * Nothing here guesses at a PDF, a scan, or a spreadsheet. A reviewer who
 * attaches one sees an explicit "not read" row, and coverage over that source
 * is never claimed. Sources are context only; nothing in this module ever
 * becomes an outbound attachment.
 */

/* ------------------------------------------------------------------ types */

export type SourceKind = "pasted_text" | "text_file" | "markdown_file" | "other_file";

export type SourceStatus = "parsed" | "unsupported" | "unreadable" | "empty";

export interface ReviewSourceInput {
  label?: string;
  filename?: string | null;
  mediaType?: string | null;
  /** The text the browser recovered, if any. */
  text?: string | null;
}

export interface ClassifiedSource {
  label: string;
  kind: SourceKind;
  filename: string | null;
  mediaType: string | null;
  status: SourceStatus;
  /** One plain sentence a person can act on. Always present. */
  statusNote: string;
  /** Only ever set when status is "parsed". */
  content: string | null;
  charCount: number;
  checksum: string;
}

/** A bounded piece of a long source, with the offsets it occupies. */
export interface SourceSegment {
  index: number;
  start: number;
  end: number;
  text: string;
}

/* ------------------------------------------------------------- extensions */

const TEXT_EXTENSIONS = [".txt", ".text", ".log"];
const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdown"];

const TEXT_MEDIA = ["text/plain", "text/markdown", "text/x-markdown", "application/markdown"];

/** Formats a person will reasonably try, each with its own honest sentence. */
const UNSUPPORTED_NOTES: { match: RegExp; note: string }[] = [
  {
    match: /\.pdf$|application\/pdf/i,
    note: "Comms cannot read PDFs yet, so nothing from this file was used. Paste the relevant text instead.",
  },
  {
    match: /\.docx?$|officedocument|msword/i,
    note: "Comms cannot read Word documents yet, so nothing from this file was used. Paste the relevant text instead.",
  },
  {
    match: /\.(png|jpe?g|gif|webp|heic)$|^image\//i,
    note: "Comms cannot read images or screenshots yet, so nothing in this one was used. Type out what it shows.",
  },
  {
    match: /\.(xlsx?|csv|numbers)$|spreadsheet|excel/i,
    note: "Comms cannot read spreadsheets yet, so nothing from this file was used. Paste the relevant rows instead.",
  },
  {
    match: /\.(eml|msg)$|message\/rfc822/i,
    note: "Comms cannot read exported email files yet, so nothing from this one was used. Paste the message text instead.",
  },
];

function lower(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function endsWithAny(name: string, endings: string[]): boolean {
  return endings.some((ending) => name.endsWith(ending));
}

/* ----------------------------------------------------------------- hashing */

/**
 * A stable, dependency-free content hash (FNV-1a, 64 bit, hex). It is an
 * idempotency key for duplicate uploads, never a security primitive.
 */
export function sourceChecksum(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Normalise line endings and trailing space without touching the words. */
export function normalizeSourceText(input: string): string {
  return input.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

/* ------------------------------------------------------------ classifying */

/**
 * Decide, honestly, what this source is and whether it was read. Pasted text
 * and text/markdown files are genuinely parsed. Everything else keeps a
 * status that says so.
 */
export function classifySource(input: ReviewSourceInput): ClassifiedSource {
  const filename = input.filename?.trim() ? input.filename.trim() : null;
  const mediaType = input.mediaType?.trim() ? input.mediaType.trim() : null;
  const name = lower(filename);
  const media = lower(mediaType);
  const text = normalizeSourceText(input.text ?? "");

  const pasted = !filename;
  const isMarkdown = endsWithAny(name, MARKDOWN_EXTENSIONS) || media.includes("markdown");
  const isPlainText =
    endsWithAny(name, TEXT_EXTENSIONS) || TEXT_MEDIA.includes(media) || media.startsWith("text/");

  const kind: SourceKind = pasted
    ? "pasted_text"
    : isMarkdown
      ? "markdown_file"
      : isPlainText
        ? "text_file"
        : "other_file";

  const label =
    input.label?.trim() || filename || (pasted ? "Pasted conversation" : "Attached file");

  const base = {
    label,
    kind,
    filename,
    mediaType,
    charCount: text.length,
    checksum: sourceChecksum(`${kind}:${filename ?? ""}:${text}`),
  };

  if (kind === "other_file") {
    // Tested separately: the patterns anchor on the end of a filename, which
    // a joined probe string would never reach.
    const matched = UNSUPPORTED_NOTES.find(
      (entry) => entry.match.test(name) || entry.match.test(media),
    );
    return {
      ...base,
      status: "unsupported",
      statusNote:
        matched?.note ??
        "Comms has no reader for this file type, so nothing in it was used. Paste the relevant text instead.",
      content: null,
      charCount: 0,
    };
  }

  if (!text) {
    return {
      ...base,
      status: pasted ? "empty" : "unreadable",
      statusNote: pasted
        ? "Nothing was pasted, so there is nothing to read."
        : "This file is a supported type but no readable text came out of it. Paste the text instead.",
      content: null,
      charCount: 0,
    };
  }

  return {
    ...base,
    status: "parsed",
    statusNote: `Read in full: ${text.length} characters.`,
    content: text,
  };
}

/* ----------------------------------------------------------- segmentation */

const SEGMENT_TARGET = 3000;

/**
 * Split a long source at paragraph boundaries, keeping every character
 * accounted for by its offsets. The manifest is the proof that the whole
 * source was covered: segments are contiguous and end at the source's length.
 */
export function segmentSource(text: string, target = SEGMENT_TARGET): SourceSegment[] {
  if (!text) return [];
  if (text.length <= target) {
    return [{ index: 0, start: 0, end: text.length, text }];
  }

  const segments: SourceSegment[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + target, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      const breakAt = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
      // Only honour a boundary that leaves a reasonably full segment.
      if (breakAt > target * 0.4) end = start + breakAt + 1;
    }
    segments.push({ index: segments.length, start, end, text: text.slice(start, end) });
    start = end;
  }
  return segments;
}

/** Are the segments contiguous and complete over the source? */
export function segmentsCoverSource(text: string, segments: SourceSegment[]): boolean {
  if (!text) return segments.length === 0;
  let cursor = 0;
  for (const segment of segments) {
    if (segment.start !== cursor) return false;
    cursor = segment.end;
  }
  return cursor === text.length;
}

/** The one-line truth about what a set of sources gave the review. */
export function sourceCoverageNote(sources: ClassifiedSource[]): string {
  if (sources.length === 0) return "No source material was provided.";
  const read = sources.filter((source) => source.status === "parsed");
  const notRead = sources.length - read.length;
  if (notRead === 0) {
    return read.length === 1
      ? "One source, read in full."
      : `${read.length} sources, all read in full.`;
  }
  if (read.length === 0) {
    return `None of the ${sources.length} sources could be read, so this review has no source material behind it.`;
  }
  return `${read.length} of ${sources.length} sources were read. ${notRead} could not be, and nothing in ${notRead === 1 ? "it" : "them"} was used.`;
}
