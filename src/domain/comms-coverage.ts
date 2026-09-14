/**
 * Question coverage, deterministic.
 *
 * A reply that answers three of four questions is not a good reply, it is an
 * unfinished one. This module reads the source material and names every
 * explicit question and every actionable request in it, with the character
 * position it was found at, so a question buried late in a long email is
 * provably accounted for rather than quietly cut off.
 *
 * Everything here is rule-based and says so. It is evidence handed to the
 * judgment pass, never a claim that a model read anything.
 */

export type CoverageStatus = "answered" | "partly_answered" | "missing" | "pending_confirmation";

export interface SourceAsk {
  id: string;
  /** The sentence as it was written. */
  text: string;
  /** Character offset in the source. Proof a late question was read. */
  offset: number;
  kind: "question" | "request";
  /** Where it came from, in plain words. */
  source: string;
}

export interface AskCoverage extends SourceAsk {
  status: CoverageStatus;
  /** Why the status was given, in one sentence. Deterministic wording. */
  because: string;
}

export interface CoverageReport {
  asks: AskCoverage[];
  answered: number;
  outstanding: number;
  /** True only when nothing is missing and nothing is half-answered. */
  complete: boolean;
  method: "deterministic";
}

const REQUEST_PATTERNS: RegExp[] = [
  /\b(can|could|would)\s+you\b/i,
  /\bplease\b/i,
  /\blet me know\b/i,
  /\bsend (me|us|over|through)\b/i,
  /\bconfirm\b/i,
  /\b(we|i) (need|want) to know\b/i,
  /\bwould like\b/i,
  /\bget back to (me|us)\b/i,
];

const PENDING_PATTERNS: RegExp[] = [
  /\bwill (confirm|check|find out|come back)\b/i,
  /\bcoming back to you\b/i,
  /\bonce (i|we) (have|know)\b/i,
  /\bnot confirmed yet\b/i,
];

const STOP_WORDS = new Set([
  "about","after","again","against","all","also","and","any","are","because","been","before","being",
  "between","both","but","can","could","did","does","doing","down","during","each","for","from","further",
  "had","has","have","having","her","here","hers","him","his","how","into","its","itself","just","more",
  "most","not","now","off","once","only","other","our","ours","out","over","own","please","same","she",
  "should","some","such","than","that","the","their","theirs","them","then","there","these","they","this",
  "those","through","too","under","until","very","was","were","what","when","where","which","while","who",
  "whom","why","will","with","would","you","your","yours",
]);

/** Sentences with the offset each one starts at, so position survives. */
function sentencesWithOffsets(text: string): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "." || char === "?" || char === "!" || char === "\n") {
      const raw = text.slice(start, index + 1);
      const trimmed = raw.trim();
      if (trimmed) out.push({ text: trimmed, offset: start + (raw.length - raw.trimStart().length) });
      start = index + 1;
    }
  }
  const tail = text.slice(start);
  if (tail.trim()) {
    out.push({ text: tail.trim(), offset: start + (tail.length - tail.trimStart().length) });
  }
  return out;
}

/** Content words a reply would have to echo to be answering this ask. */
export function askKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
  return Array.from(new Set(words));
}

/**
 * Every explicit question and actionable request in the source, in the order
 * they were written. Position is kept: an ask at character 1,400 is as real
 * as one in the first line.
 */
export function extractAsks(source: string, label = "source"): SourceAsk[] {
  const asks: SourceAsk[] = [];
  for (const sentence of sentencesWithOffsets(source)) {
    const isQuestion = sentence.text.trimEnd().endsWith("?");
    const isRequest = !isQuestion && REQUEST_PATTERNS.some((rule) => rule.test(sentence.text));
    if (!isQuestion && !isRequest) continue;
    asks.push({
      id: `ask-${asks.length + 1}`,
      text: sentence.text,
      offset: sentence.offset,
      kind: isQuestion ? "question" : "request",
      source: label,
    });
  }
  return asks;
}

/**
 * How a draft answers each ask, by lexical evidence only.
 *
 * Two or more of the ask's content words appearing in the draft reads as
 * answered, one reads as partly answered, none reads as missing. A draft that
 * openly says an answer is coming resolves the obligation as pending, which
 * keeps the underlying question open rather than closing it.
 */
export function coverageForDraft(asks: SourceAsk[], draft: string): CoverageReport {
  const body = draft.toLowerCase();
  const covered: AskCoverage[] = asks.map((ask) => {
    const keywords = askKeywords(ask.text);
    const hits = keywords.filter((word) => body.includes(word));
    const pending = PENDING_PATTERNS.some((rule) => rule.test(draft)) && hits.length > 0;

    if (pending) {
      return {
        ...ask,
        status: "pending_confirmation",
        because: "The draft says an answer is still coming. The question stays open.",
      };
    }
    if (hits.length >= 2) {
      return {
        ...ask,
        status: "answered",
        because: `The draft picks this up: ${hits.slice(0, 3).join(", ")}.`,
      };
    }
    if (hits.length === 1) {
      return {
        ...ask,
        status: "partly_answered",
        because: `Only "${hits[0]}" is picked up. The rest of the ask is unanswered.`,
      };
    }
    return {
      ...ask,
      status: "missing",
      because: "Nothing in the draft addresses this.",
    };
  });

  const answered = covered.filter((entry) => entry.status === "answered").length;
  return {
    asks: covered,
    answered,
    outstanding: covered.length - answered,
    complete: covered.length > 0 && answered === covered.length,
    method: "deterministic",
  };
}
