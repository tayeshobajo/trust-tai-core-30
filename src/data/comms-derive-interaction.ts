/**
 * Reading a captured conversation.
 *
 * Tai tells Comms what happened in his own words. This module proposes the
 * structure hiding in that sentence: what was learned, what was promised, and
 * what should happen next. It is deterministic, cue based, and deliberately
 * conservative.
 *
 * Nothing here is truth. Every derived line is a suggestion a person confirms
 * before it is written, so Comms never quietly invents a fact.
 */

import type { ISODateTime } from "@/domain/entities";

export type SuggestionKind = "learned" | "commitment" | "next_move";

export interface DerivedSuggestion {
  id: string;
  kind: SuggestionKind;
  text: string;
  /** The words in the capture that led here, quoted back for review. */
  because: string;
  owner?: "us" | "them";
  due?: ISODateTime;
}

export interface DerivedInteraction {
  /** A one line headline for the timeline. */
  summary: string;
  suggestions: DerivedSuggestion[];
}

const DAY = 86_400_000;

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");
}

function truncate(value: string, max = 140): string {
  const trimmed = clean(value);
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/** Dates only when the sentence actually names one. Never a guessed deadline. */
export function dueFromText(sentence: string, now: Date = new Date()): ISODateTime | undefined {
  const lower = sentence.toLowerCase();
  const at = (offsetDays: number) => {
    const date = new Date(now.getTime() + offsetDays * DAY);
    date.setHours(17, 0, 0, 0);
    return date.toISOString();
  };

  if (/\btomorrow\b/.test(lower)) return at(1);
  if (/\btoday\b/.test(lower)) return at(0);
  if (/\bnext week\b/.test(lower)) return at(7);
  if (/\bthis week\b/.test(lower)) return at(3);
  if (/\bnext month\b/.test(lower)) return at(30);

  const weekday = WEEKDAYS.findIndex((day) => new RegExp(`\\b${day}\\b`).test(lower));
  if (weekday >= 0) {
    const delta = (weekday - now.getDay() + 7) % 7 || 7;
    return at(delta);
  }
  return undefined;
}

const COMMITMENT_US =
  /\b(i'?ll|i will|we'?ll|we will|i'?m going to|we'?re going to|i promised|we promised|i said i would|we said we would|i agreed to|we agreed to|let me)\b/i;
const COMMITMENT_THEM =
  /\b(they'?ll|they will|he'?ll|she'?ll|he will|she will|they promised|they agreed to|they'?re going to)\b/i;
const LEARNED =
  /\b(they (are|is|were|have|has|want|need|care|mentioned|said|told|prefer)|he (is|said|wants|prefers)|she (is|said|wants|prefers)|their team|they'?re|budget|hiring|launch|raising|moving to)\b/i;
const NEXT_MOVE = /\b(next step|next move|follow up|follow-up|circle back|check in|reconnect)\b/i;

/**
 * Read a natural language capture and propose structure.
 * An empty suggestion list is a perfectly good answer.
 */
export function deriveInteraction(
  input: string,
  now: Date = new Date(),
): DerivedInteraction {
  const body = input.trim();
  if (!body) return { summary: "", suggestions: [] };

  const lines = sentences(body);
  const suggestions: DerivedSuggestion[] = [];
  const seen = new Set<string>();

  function push(entry: Omit<DerivedSuggestion, "id">) {
    const key = `${entry.kind}:${entry.text.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push({ ...entry, id: `${entry.kind}-${suggestions.length}` });
  }

  for (const line of lines) {
    const because = truncate(line, 160);

    if (COMMITMENT_US.test(line)) {
      const due = dueFromText(line, now);
      push({
        kind: "commitment",
        text: truncate(line),
        because,
        owner: "us",
        ...(due ? { due } : {}),
      });
      continue;
    }

    if (COMMITMENT_THEM.test(line)) {
      const due = dueFromText(line, now);
      push({
        kind: "commitment",
        text: truncate(line),
        because,
        owner: "them",
        ...(due ? { due } : {}),
      });
      continue;
    }

    if (NEXT_MOVE.test(line)) {
      push({ kind: "next_move", text: truncate(line), because });
      continue;
    }

    if (LEARNED.test(line)) {
      push({ kind: "learned", text: truncate(line), because });
    }
  }

  return { summary: truncate(lines[0] ?? body, 120), suggestions };
}
