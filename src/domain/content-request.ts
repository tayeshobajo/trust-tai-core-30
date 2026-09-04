/**
 * Trust Tai OS, the Content Engine command layer (Maya).
 *
 * A person should be able to say what they want in plain language. This
 * module turns that sentence into an interpreted plan they can see and
 * correct before anything runs. Every setting carries how it was decided:
 * inferred from the words, set by hand, or simply not stated.
 *
 * The interpretation is deterministic on purpose. Reading a request back to
 * a person is not the moment to guess with a model, and a chip a person can
 * edit is more honest than a hidden assumption.
 */

/** How a setting came to be. Shown, so nothing looks more certain than it is. */
export type SettingOrigin = "inferred" | "explicit" | "default";

export interface RequestSetting {
  value: string;
  origin: SettingOrigin;
}

export interface ContentRequestSettings {
  audience: RequestSetting;
  length: RequestSetting;
  structure: RequestSetting;
  angle: RequestSetting;
  searchIntent: RequestSetting;
  cta: RequestSetting;
  imageDirection: RequestSetting;
  voice: RequestSetting;
}

export interface InterpretedRequest {
  prompt: string;
  keyword: string;
  count: number;
  settings: ContentRequestSettings;
  /** Everything the person said that is not captured by a chip above. */
  instructions: string;
}

export const MAX_POSTS = 12;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function unset(): RequestSetting {
  return { value: "", origin: "default" };
}

function inferred(value: string): RequestSetting {
  return { value: value.trim(), origin: "inferred" };
}

/** How many posts were asked for, bounded so a typo cannot run away. */
export function readCount(prompt: string): number | null {
  const digits = /\b(\d{1,2})\s+(?:hit\s+)?(?:blog\s+)?(?:posts?|articles?|pieces?)\b/i.exec(prompt);
  if (digits?.[1]) {
    const value = Number(digits[1]);
    if (value >= 1) return Math.min(value, MAX_POSTS);
  }
  const words = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:hit\s+)?(?:blog\s+)?(?:posts?|articles?|pieces?)\b/i.exec(
    prompt,
  );
  const word = words?.[1]?.toLowerCase();
  if (word && NUMBER_WORDS[word]) return NUMBER_WORDS[word]!;
  return null;
}

/** The topic the cluster is built around. */
export function readKeyword(prompt: string): string {
  const match =
    /\b(?:around|about|on the topic of|on)\s+([^.,;\n]+)/i.exec(prompt) ??
    /\bkeyword[:\s]+([^.,;\n]+)/i.exec(prompt);
  const raw = match?.[1] ?? "";
  return raw
    .replace(/\b(please|thanks)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function readLength(prompt: string): RequestSetting {
  const range = /\b(\d[\d,]{2,5})\s*(?:-|to|–)\s*(\d[\d,]{2,5})\s*words\b/i.exec(prompt);
  if (range) return inferred(`${range[1]} to ${range[2]} words`);
  const single = /\b(?:about|around|roughly)?\s*(\d[\d,]{2,5})\s*words\b/i.exec(prompt);
  if (single) return inferred(`about ${single[1]} words`);
  return unset();
}

function readAudience(prompt: string): RequestSetting {
  const match = /\b(?:write for|for)\s+((?:founder|owner|operator|leader|business|team|cmo|ceo)[^.,;\n]*)/i.exec(
    prompt,
  );
  return match?.[1] ? inferred(match[1]) : unset();
}

function readStructure(prompt: string): RequestSetting {
  const notes: string[] = [];
  if (/story[- ]led|story openings?|open with a story/i.test(prompt)) notes.push("story-led openings");
  if (/framework/i.test(prompt)) notes.push("practical frameworks");
  if (/avoid generic|no generic|avoid ai/i.test(prompt)) notes.push("no generic headings");
  if (/checklist|step[- ]by[- ]step/i.test(prompt)) notes.push("step by step");
  return notes.length ? inferred(notes.join(", ")) : unset();
}

function readAngle(prompt: string): RequestSetting {
  return /distinct angle|different angle|unique angle/i.test(prompt)
    ? inferred("a distinct angle per article")
    : unset();
}

function readSearchIntent(prompt: string): RequestSetting {
  if (/\bcommercial intent|buying intent\b/i.test(prompt)) return inferred("commercial");
  if (/\bhow[- ]to|informational\b/i.test(prompt)) return inferred("informational");
  return unset();
}

function readCta(prompt: string): RequestSetting {
  const match = /\bcta[:\s]+([^.;\n]+)/i.exec(prompt);
  return match?.[1] ? inferred(match[1]) : unset();
}

function readImageDirection(prompt: string): RequestSetting {
  const match = /\b(?:featured[- ]image|image)\s+(?:direction|style|brief)[:\s]*([^.;\n]*)/i.exec(prompt);
  if (match) return inferred(match[1]?.trim() || "a distinct featured image direction per article");
  if (/featured[- ]image/i.test(prompt)) return inferred("a distinct featured image direction per article");
  return unset();
}

function readVoice(prompt: string): RequestSetting {
  if (/linkedin/i.test(prompt)) return inferred("Tai voice, LinkedIn writing as reference");
  if (/my (?:writing|voice)|voice reference/i.test(prompt)) return inferred("Tai voice, own writing as reference");
  return { value: "Tai voice", origin: "default" };
}

/**
 * Read a plain-language request.
 *
 * Nothing here is a promise about quality. It is only what the sentence
 * appears to ask for, offered back so a person can correct it.
 */
export function interpretRequest(prompt: string): InterpretedRequest {
  const text = prompt.trim();
  return {
    prompt: text,
    keyword: readKeyword(text),
    count: readCount(text) ?? 10,
    settings: {
      audience: readAudience(text),
      length: readLength(text),
      structure: readStructure(text),
      angle: readAngle(text),
      searchIntent: readSearchIntent(text),
      cta: readCta(text),
      imageDirection: readImageDirection(text),
      voice: readVoice(text),
    },
    instructions: text,
  };
}

/** The one-line plan a person confirms before the run starts. */
export function planLine(request: InterpretedRequest, activeSources: number): string {
  const parts = [
    `${request.count} post${request.count === 1 ? "" : "s"}`,
    request.keyword || "topic not set",
  ];
  for (const setting of [
    request.settings.audience,
    request.settings.length,
    request.settings.structure,
  ]) {
    if (setting.value) parts.push(setting.value);
  }
  parts.push(request.settings.voice.value || "Tai voice");
  parts.push(
    activeSources === 0
      ? "no sources selected"
      : `${activeSources} source${activeSources === 1 ? "" : "s"} in use`,
  );
  return parts.join(" · ");
}

/** What blocks a run, said plainly rather than by disabling a button silently. */
export function requestBlockers(request: InterpretedRequest): string[] {
  const blockers: string[] = [];
  if (!request.prompt.trim()) blockers.push("Say what you would like written.");
  if (!request.keyword.trim()) blockers.push("Set the topic this cluster is built around.");
  if (request.count < 1 || request.count > MAX_POSTS) {
    blockers.push(`Studio writes between 1 and ${MAX_POSTS} posts in one run.`);
  }
  return blockers;
}
