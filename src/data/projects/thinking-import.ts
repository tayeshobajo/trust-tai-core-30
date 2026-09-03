/**
 * Turning a thinking room into reviewable project knowledge.
 *
 * A private ChatGPT or Claude thread cannot be read from its URL, so the
 * honest path is: a person pastes or uploads the part that matters, and the
 * OS proposes candidate knowledge from it. Nothing here becomes canon. Every
 * candidate arrives as Needs review, carrying the source it came from, and a
 * person is the only thing that can confirm it.
 */

import type {
  KnowledgeInput,
  KnowledgeSection,
  ThinkingSource,
} from "@/domain/project-intelligence";

export interface ImportCandidate {
  section: KnowledgeSection;
  body: string;
  /** Rough, and labelled as rough. Never used to skip a person. */
  confidence: number;
}

interface Cue {
  section: KnowledgeSection;
  confidence: number;
  test: (line: string) => boolean;
}

const CUES: Cue[] = [
  {
    section: "decision",
    confidence: 0.7,
    test: (line) =>
      /^(decision|decided)\b|\bwe (decided|agreed|will go with)\b|\blocked in\b/i.test(line),
  },
  {
    section: "constraint",
    confidence: 0.7,
    test: (line) => /^(constraint|rule)\b|\b(do not|don't|never|must not|cannot) \w+/i.test(line),
  },
  {
    section: "requirement",
    confidence: 0.6,
    test: (line) => /^(requirement|req)\b|\b(must|has to|needs to|should) \w+/i.test(line),
  },
  {
    section: "objective",
    confidence: 0.6,
    test: (line) => /^(objective|goal|outcome)\b|\bthe goal is\b/i.test(line),
  },
  { section: "why", confidence: 0.5, test: (line) => /^(why|because|rationale)\b/i.test(line) },
  {
    section: "open_question",
    confidence: 0.6,
    test: (line) =>
      line.trim().endsWith("?") || /^(open question|question|tbd|unclear)\b/i.test(line),
  },
  {
    section: "idea",
    confidence: 0.4,
    test: (line) => /^(idea|maybe|consider|what if)\b/i.test(line),
  },
];

function clean(raw: string): string {
  return raw
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .replace(/^\s*(?:#+)\s*/, "")
    .replace(/^\s*(?:you said:|chatgpt said:|assistant:|user:|me:)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

const MAX_CANDIDATES = 40;

/**
 * Deterministic, cue based, and deliberately conservative: a line only becomes
 * a candidate when it reads like something a person asserted.
 */
export function parseThinkingImport(text: string): ImportCandidate[] {
  const seen = new Set<string>();
  const out: ImportCandidate[] = [];

  for (const raw of text.split(/\r?\n+/)) {
    const line = clean(raw);
    if (line.length < 12 || line.length > 400) continue;
    const cue = CUES.find((entry) => entry.test(line));
    if (!cue) continue;
    const key = `${cue.section}:${line.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ section: cue.section, body: line, confidence: cue.confidence });
    if (out.length >= MAX_CANDIDATES) break;
  }

  return out;
}

/** Candidates become knowledge inputs that always point back at the source. */
export function knowledgeInputsFrom(
  candidates: ImportCandidate[],
  source: ThinkingSource,
): KnowledgeInput[] {
  return candidates.map((candidate) => ({
    section: candidate.section,
    body: candidate.body,
    origin: "thinking_room" as const,
    reviewState: "needs_review" as const,
    sourceReference: source.id,
    sourceLabel: source.title,
    confidence: candidate.confidence,
  }));
}

/** Plain language for what the person is about to get. */
export function importSummary(candidates: ImportCandidate[]): string {
  if (candidates.length === 0)
    return "Nothing in that text reads like a decision, a constraint or an open question yet.";
  const counts = new Map<KnowledgeSection, number>();
  for (const candidate of candidates)
    counts.set(candidate.section, (counts.get(candidate.section) ?? 0) + 1);
  const parts = [...counts.entries()].map(
    ([section, count]) => `${count} ${section.replace(/_/g, " ")}`,
  );
  return `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} found: ${parts.join(", ")}. Each one waits for you to confirm it.`;
}
