/**
 * Obligations: every question and request the client actually made, and
 * whether the draft genuinely answers it.
 *
 * The correction this module exists to make: keyword overlap is not an
 * answer. `comms-coverage.ts` counts shared words, which means a draft that
 * merely repeats the question scores as if it had answered it. That heuristic
 * is retained here only as a CANDIDATE hint, clearly labelled, and it can
 * never by itself mark an obligation answered.
 *
 * The status a person sees comes from a semantic reading, and every semantic
 * claim is checked against the real text before it is believed:
 *
 *   - the obligation must be one this system extracted, with an anchor that
 *     verifies against the source it claims to come from,
 *   - an "answered", "partly answered" or "pending" verdict must quote the
 *     passage of the draft that does the answering, and that quote must
 *     actually appear in that exact draft version,
 *   - a quote that merely restates the question is not an answer,
 *   - anything unverifiable becomes "uncertain". Uncertain stays uncertain;
 *     it is never rounded up to answered, and it never clears approval.
 *
 * Nothing here invents an answer to clear a checklist.
 */

import { extractAsks, type SourceAsk } from "./comms-coverage";

/* ------------------------------------------------------------------ types */

export type ObligationKind = "question" | "request";

export type ObligationStatus =
  | "answered"
  | "partly_answered"
  | "pending_confirmation"
  | "missing"
  | "uncertain";

export type ObligationMethod = "semantic" | "lexical_candidate";

export type ObligationConfidence = "high" | "medium" | "low";

/** Where an obligation sits in the source it came from. */
export interface SourceAnchor {
  sourceId: string;
  start: number;
  end: number;
  quote: string;
}

/** Where an answer sits in one exact draft version. */
export interface DraftAnchor {
  versionId: string;
  start: number;
  end: number;
  quote: string;
}

export interface Obligation {
  id: string;
  kind: ObligationKind;
  excerpt: string;
  anchor: SourceAnchor;
  /** The lexical heuristic's opinion. A hint for the reviewer, never proof. */
  lexicalCandidate?: "looks_addressed" | "no_overlap";
}

export interface ObligationVerdict {
  obligationId: string;
  kind: ObligationKind;
  excerpt: string;
  anchor: SourceAnchor;
  status: ObligationStatus;
  method: ObligationMethod;
  confidence: ObligationConfidence;
  answer: DraftAnchor | null;
  because: string;
  /** Set when a model claim was rejected, naming why. */
  rejected?: string;
}

export interface ObligationCoverage {
  verdicts: ObligationVerdict[];
  answered: number;
  outstanding: number;
  uncertain: number;
  /** True only when every obligation is answered. Pending is not complete. */
  complete: boolean;
  /** True only when nothing is missing and nothing is uncertain. */
  settled: boolean;
  note: string;
}

/* ------------------------------------------------------------- extraction */

/**
 * Candidate obligations from one source, anchored by character offset. This
 * is the deterministic pass: it finds the asks, it does not judge answers.
 */
export function obligationsFromSource(input: {
  sourceId: string;
  text: string;
  label?: string;
}): Obligation[] {
  const asks: SourceAsk[] = extractAsks(input.text, input.label ?? "source");
  return asks.map((ask, index) => {
    const start = ask.offset >= 0 ? ask.offset : 0;
    return {
      id: `${input.sourceId}:${index + 1}`,
      kind: ask.kind,
      excerpt: ask.text,
      anchor: {
        sourceId: input.sourceId,
        start,
        end: start + ask.text.length,
        quote: ask.text,
      },
    } satisfies Obligation;
  });
}

/* ---------------------------------------------------------------- anchors */

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Find a quoted passage in the text it claims to come from. A claimed offset
 * is honoured only when the text at that offset really is the quote; anything
 * else falls back to a genuine search, first exact, then whitespace-tolerant.
 * Returns null when the quote is not in the text at all.
 */
export function locateQuote(
  text: string,
  quote: string,
  claimedStart?: number | null,
): { start: number; end: number; quote: string } | null {
  const needle = quote.trim();
  if (!needle || !text) return null;

  if (
    typeof claimedStart === "number" &&
    claimedStart >= 0 &&
    text.slice(claimedStart, claimedStart + needle.length) === needle
  ) {
    return { start: claimedStart, end: claimedStart + needle.length, quote: needle };
  }

  const exact = text.indexOf(needle);
  if (exact >= 0) return { start: exact, end: exact + needle.length, quote: needle };

  // Whitespace-tolerant: models reflow line breaks when they quote.
  const flatText = collapse(text);
  const flatNeedle = collapse(needle);
  if (!flatNeedle) return null;
  const flatAt = flatText.indexOf(flatNeedle);
  if (flatAt < 0) return null;

  // Map the flattened hit back onto real offsets by walking the original.
  let seen = 0;
  let realStart = -1;
  let lastWasSpace = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    const isSpace = /\s/.test(character);
    if (isSpace) {
      if (lastWasSpace) continue;
      lastWasSpace = true;
    } else {
      lastWasSpace = false;
    }
    if (seen === flatAt && realStart < 0) realStart = index;
    seen += 1;
    if (seen === flatAt + flatNeedle.length) {
      if (realStart < 0) realStart = index;
      return { start: realStart, end: index + 1, quote: text.slice(realStart, index + 1) };
    }
  }
  return null;
}

/* ------------------------------------------------------------ restatement */

function words(value: string): string[] {
  return collapse(value.toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Words that only frame a question rather than answer it. */
const ECHO_FRAMING = new Set([
  "asked",
  "asking",
  "about",
  "regarding",
  "mentioned",
  "question",
  "questions",
  "wanted",
  "know",
  "your",
  "just",
  "also",
  "that",
  "this",
]);

/**
 * True when the claimed answer is really just the question again. This is what
 * catches the failure the lexical heuristic could not: near-identical wording,
 * and a passage that is itself still a question.
 */
export function isRestatement(obligation: string, answer: string): boolean {
  const askWords = words(obligation);
  const answerWords = words(answer);
  if (askWords.length === 0 || answerWords.length === 0) return false;

  const askSet = new Set(askWords);
  const shared = answerWords.filter((word) => askSet.has(word)).length;
  const covered = shared / askSet.size;

  /* What the "answer" adds that the ask did not already say. Framing words
     like "you asked about" are not new information, so they do not rescue an
     echo. With nothing genuinely new, this is the question again. */
  const novel = answerWords.filter(
    (word) => !askSet.has(word) && word.length > 3 && !ECHO_FRAMING.has(word),
  );

  const echo = covered >= 0.7 && novel.length === 0;
  const stillAsking = /\?\s*$/.test(answer.trim()) && covered >= 0.6;
  return echo || stillAsking;
}

/* ------------------------------------------------- verifying model output */

export interface RawObligationVerdict {
  obligationId?: unknown;
  status?: unknown;
  answerQuote?: unknown;
  answerStart?: unknown;
  because?: unknown;
  confidence?: unknown;
}

const STATUSES: ObligationStatus[] = [
  "answered",
  "partly_answered",
  "pending_confirmation",
  "missing",
  "uncertain",
];

const NEEDS_ANSWER: ObligationStatus[] = ["answered", "partly_answered", "pending_confirmation"];

function readConfidence(value: unknown): ObligationConfidence {
  return value === "high" || value === "medium" ? value : "low";
}

function uncertain(
  obligation: Obligation,
  because: string,
  rejected?: string,
): ObligationVerdict {
  return {
    obligationId: obligation.id,
    kind: obligation.kind,
    excerpt: obligation.excerpt,
    anchor: obligation.anchor,
    status: "uncertain",
    method: "semantic",
    confidence: "low",
    answer: null,
    because,
    ...(rejected ? { rejected } : {}),
  };
}

/**
 * Turn a semantic pass's claims into verdicts that can be trusted, by
 * checking each one against the draft text it refers to. Obligations the
 * model did not mention come back uncertain, never answered.
 */
export function verifyObligationVerdicts(input: {
  obligations: Obligation[];
  draftText: string;
  versionId: string;
  raw: RawObligationVerdict[];
}): ObligationVerdict[] {
  const byId = new Map(input.obligations.map((obligation) => [obligation.id, obligation]));
  const claims = new Map<string, RawObligationVerdict>();
  for (const claim of input.raw) {
    const id = typeof claim.obligationId === "string" ? claim.obligationId : "";
    // An id we never issued is a hallucinated obligation. Drop it.
    if (id && byId.has(id) && !claims.has(id)) claims.set(id, claim);
  }

  return input.obligations.map((obligation) => {
    const claim = claims.get(obligation.id);
    if (!claim) {
      return uncertain(
        obligation,
        "The review did not report on this one, so it is still open.",
      );
    }

    const status = STATUSES.find((candidate) => candidate === claim.status);
    if (!status) {
      return uncertain(obligation, "The review's answer for this one could not be read.");
    }

    const because =
      typeof claim.because === "string" && claim.because.trim()
        ? claim.because.trim()
        : "No reason was given.";

    if (status === "missing") {
      return {
        obligationId: obligation.id,
        kind: obligation.kind,
        excerpt: obligation.excerpt,
        anchor: obligation.anchor,
        status: "missing",
        method: "semantic",
        confidence: readConfidence(claim.confidence),
        answer: null,
        because,
      };
    }

    if (status === "uncertain") return uncertain(obligation, because);

    if (!NEEDS_ANSWER.includes(status)) return uncertain(obligation, because);

    const quote = typeof claim.answerQuote === "string" ? claim.answerQuote : "";
    const located = locateQuote(
      input.draftText,
      quote,
      typeof claim.answerStart === "number" ? claim.answerStart : null,
    );
    if (!located) {
      return uncertain(
        obligation,
        "The review said this was handled but could not point at the words that do it.",
        "The quoted passage is not in this draft.",
      );
    }

    if (isRestatement(obligation.excerpt, located.quote)) {
      return uncertain(
        obligation,
        "The draft repeats the question rather than answering it.",
        "The quoted passage restates the ask.",
      );
    }

    return {
      obligationId: obligation.id,
      kind: obligation.kind,
      excerpt: obligation.excerpt,
      anchor: obligation.anchor,
      status,
      method: "semantic",
      confidence: readConfidence(claim.confidence),
      answer: {
        versionId: input.versionId,
        start: located.start,
        end: located.end,
        quote: located.quote,
      },
      because,
    };
  });
}

/* ---------------------------------------------------------------- summary */

/** Count the verdicts and say, in one sentence, where the reply stands. */
export function summarizeObligations(verdicts: ObligationVerdict[]): ObligationCoverage {
  const answered = verdicts.filter((verdict) => verdict.status === "answered").length;
  const uncertainCount = verdicts.filter((verdict) => verdict.status === "uncertain").length;
  const outstanding = verdicts.length - answered;
  const complete = verdicts.length > 0 && answered === verdicts.length;
  const settled =
    verdicts.length > 0 &&
    verdicts.every(
      (verdict) => verdict.status === "answered" || verdict.status === "pending_confirmation",
    );

  const note =
    verdicts.length === 0
      ? "No questions or requests were found in the source material."
      : complete
        ? `All ${verdicts.length} asks are answered.`
        : `${answered} of ${verdicts.length} asks are answered.${
            uncertainCount > 0
              ? ` ${uncertainCount} could not be judged and ${uncertainCount === 1 ? "stays" : "stay"} open.`
              : ""
          }`;

  return { verdicts, answered, outstanding, uncertain: uncertainCount, complete, settled, note };
}

/**
 * The lexical heuristic, kept for what it is worth: a hint that a reviewer
 * may want to look somewhere. It is attached to the obligation, marked as a
 * candidate, and never consulted when deciding coverage.
 */
export function lexicalHint(obligation: Obligation, draftText: string): Obligation {
  const askWords = new Set(words(obligation.excerpt).filter((word) => word.length > 3));
  if (askWords.size === 0) return obligation;
  const draftWords = new Set(words(draftText));
  let shared = 0;
  for (const word of askWords) if (draftWords.has(word)) shared += 1;
  return { ...obligation, lexicalCandidate: shared >= 2 ? "looks_addressed" : "no_overlap" };
}
