/**
 * Choosing the small amount of memory that helps read one conversation.
 *
 * Handing a model everything Steward has ever believed makes it worse, not
 * better: it starts pattern-matching against strangers. So selection is
 * bounded and relevance-first — the people actually in the room, the people
 * actually talked about, the projects actually named — scored, ranked, and
 * hard-capped by `MEMORY_SELECTION_LIMITS`.
 *
 * People do not speak in identifiers. Someone says "Tai" when memory holds
 * "Tai Nguyen", or "the Bioptrics thing" when the project is "Bioptrics
 * launch". Matching here is deliberately forgiving about that, and deliberately
 * strict about everything else: a loose match earns a lower score, never a free
 * pass, and every selected belief carries the plain sentence explaining why it
 * was chosen.
 *
 * Memory is offered as context, never as an override. When memory and the
 * transcript disagree, the disagreement is surfaced to a person rather than
 * silently resolved.
 */

import { personKeyOf } from "@/domain/steward";
import type { NormalizedConversation } from "@/domain/steward";
import type { InterpretedSignal } from "@/domain/steward-semantic";
import {
  MEMORY_SELECTION_LIMITS,
  type MemoryBelief,
  type MemoryConflict,
  type MemoryUsage,
  type RelevantMemory,
} from "@/domain/steward-memory";

/* ------------------------------------------------------------ reading loosely */

const SMALL_WORDS =
  /^(the|a|an|and|or|of|for|to|with|on|in|at|by|from|this|that|it|is|are|be|our|their|his|her)$/i;

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !SMALL_WORDS.test(word));
}

/** How much of the shorter phrase turns up in the longer one, 0 to 1. */
export function phraseOverlap(phrase: string, haystack: string): number {
  const left = tokens(phrase);
  if (left.length === 0) return 0;
  const right = new Set(tokens(haystack));
  const hits = left.filter((word) => right.has(word)).length;
  return hits / left.length;
}

/**
 * Was this person talked about, even if they were not in the room?
 *
 * A full name counts outright. A distinctive first name counts too, because
 * people say "Tai will send it", not "Tai Nguyen will send it" — but a very
 * short first name is ignored rather than guessed at.
 */
export function personMentioned(name: string, spoken: string): "named" | "first_name" | null {
  const clean = name.trim().toLowerCase();
  if (!clean) return null;
  if (spoken.includes(clean)) return "named";
  const first = clean.split(/\s+/)[0] ?? "";
  if (first.length < 3) return null;
  return new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(spoken)
    ? "first_name"
    : null;
}

function participantKeys(conversation: NormalizedConversation): Set<string> {
  const keys = new Set<string>();
  for (const person of conversation.participants) {
    const byEmail = personKeyOf({ email: person.email ?? null });
    if (byEmail) keys.add(byEmail);
    const byName = personKeyOf({ name: person.name });
    if (byName) keys.add(byName);
  }
  return keys;
}

/* ------------------------------------------------------------------ scoring */

/** The strength of the tie between one belief and one conversation. */
interface Relevance {
  score: number;
  because: string;
}

/** A project named outright beats one merely alluded to. */
const PROJECT_STRONG = 0.75;
const PROJECT_LOOSE = 0.5;

function relevanceOf(input: {
  belief: MemoryBelief;
  participants: Set<string>;
  participantNames: string[];
  spoken: string;
}): Relevance | null {
  const { belief, participants, spoken } = input;
  const reasons: string[] = [];
  let score = 0;

  const personKey = belief.meta.personKey ?? "";
  const counterpartKey = belief.meta.counterpartKey ?? "";
  const personName = belief.meta.personName ?? belief.subjectLabel;
  const counterpartName = belief.meta.counterpartName ?? "";

  if (personKey && participants.has(personKey)) {
    score += 5;
    reasons.push(`${personName} was in this conversation`);
  } else if (personName) {
    const mention = personMentioned(personName, spoken);
    if (mention === "named") {
      score += 4;
      reasons.push(`${personName} was named in this conversation`);
    } else if (mention === "first_name") {
      score += 2;
      reasons.push(`someone called ${personName.split(/\s+/)[0]} came up`);
    }
  }

  if (counterpartKey && participants.has(counterpartKey)) {
    score += 3;
    reasons.push(`${counterpartName || "the other person"} was in this conversation`);
  } else if (counterpartName && personMentioned(counterpartName, spoken)) {
    score += 2;
    reasons.push(`${counterpartName} came up`);
  }

  const project = belief.meta.projectLabel ?? "";
  if (project) {
    const overlap = phraseOverlap(project, spoken);
    if (overlap >= PROJECT_STRONG) {
      score += 3;
      reasons.push(`${project} was talked about`);
    } else if (overlap >= PROJECT_LOOSE) {
      score += 1;
      reasons.push(`something close to ${project} came up`);
    }
  }

  if (score === 0) return null;

  /* A person's own word is worth more than something Steward worked out. */
  if (belief.tier === "decided") {
    score += 3;
    reasons.push("you decided this yourself");
  }

  return { score, because: `${reasons.join(", ")}.` };
}

function usageOf(belief: MemoryBelief, relevance: Relevance): MemoryUsage {
  return {
    beliefId: belief.id,
    subjectLabel: belief.subjectLabel,
    statement: belief.statement,
    tier: belief.tier,
    facet: belief.meta.facet,
    because: relevance.because.charAt(0).toUpperCase() + relevance.because.slice(1),
  };
}

/**
 * The slice of memory worth showing this reading: beliefs about someone in the
 * room, someone talked about, or work the conversation is plausibly about.
 */
export function selectRelevantMemory(input: {
  beliefs: MemoryBelief[];
  conversation: NormalizedConversation;
  people: { name: string; title?: string }[];
  projects: { id: string; label: string }[];
  suppressedPatterns?: string[];
}): RelevantMemory {
  const participants = participantKeys(input.conversation);
  const participantNames = input.conversation.participants.map((person) => person.name);
  const suppressed = new Set(input.suppressedPatterns ?? []);
  const spoken = input.conversation.segments
    .map((segment) => segment.text)
    .join(" ")
    .toLowerCase();

  const scored: { belief: MemoryBelief; relevance: Relevance }[] = [];
  for (const belief of input.beliefs) {
    if (belief.meta.retired) continue;
    if (belief.meta.patternKey && suppressed.has(belief.meta.patternKey)) continue;
    /* Outcome rows are bookkeeping about feedback, not beliefs about work. */
    if (belief.meta.outcome && !belief.meta.corrected) continue;
    const relevance = relevanceOf({ belief, participants, participantNames, spoken });
    if (!relevance) continue;
    scored.push({ belief, relevance });
  }

  scored.sort((left, right) => {
    if (right.relevance.score !== left.relevance.score) {
      return right.relevance.score - left.relevance.score;
    }
    return right.belief.recordedAt.localeCompare(left.belief.recordedAt);
  });

  /* One statement per subject and facet: the strongest tie wins, the rest are noise. */
  const takenSlots = new Set<string>();
  const decidedRows: { belief: MemoryBelief; relevance: Relevance }[] = [];
  const inferredRows: { belief: MemoryBelief; relevance: Relevance }[] = [];

  for (const row of scored) {
    const slot = `${row.belief.subjectKey}|${row.belief.meta.facet}`;
    if (takenSlots.has(slot)) continue;
    if (row.belief.tier === "decided") {
      if (decidedRows.length >= MEMORY_SELECTION_LIMITS.decided) continue;
      decidedRows.push(row);
    } else {
      if (inferredRows.length >= MEMORY_SELECTION_LIMITS.inferred) continue;
      inferredRows.push(row);
    }
    takenSlots.add(slot);
  }

  const line = (row: { belief: MemoryBelief }) =>
    `${row.belief.subjectLabel}: ${row.belief.statement}`;

  const people = input.people
    .filter((person) => {
      if (participants.size === 0) return true;
      if (participants.has(personKeyOf({ name: person.name }))) return true;
      return personMentioned(person.name, spoken) !== null;
    })
    .slice(0, MEMORY_SELECTION_LIMITS.people);

  const projects = input.projects
    .filter((project) => phraseOverlap(project.label, spoken) >= PROJECT_STRONG)
    .slice(0, MEMORY_SELECTION_LIMITS.projects);

  return {
    decided: decidedRows.map(line),
    inferred: inferredRows.map(line),
    /* Nobody recognisable? Fall back to the roster rather than to silence. */
    people: people.length > 0 ? people : input.people.slice(0, MEMORY_SELECTION_LIMITS.people),
    projects,
    used: [...decidedRows, ...inferredRows].map((row) => usageOf(row.belief, row.relevance)),
    consideredCount: input.beliefs.filter((belief) => !belief.meta.retired).length,
  };
}

/* ------------------------------------------------------------- disagreement */

/**
 * Where this reading disagrees with something a person previously decided.
 *
 * Surfaced, not corrected. Memory being out of date is at least as likely as
 * the transcript being misread, and only a person can tell which happened. The
 * belief is carried along so the person's answer can supersede it directly.
 */
export function flagMemoryConflicts(input: {
  signals: InterpretedSignal[];
  beliefs: MemoryBelief[];
}): MemoryConflict[] {
  const decidedOwners = input.beliefs.filter(
    (belief) =>
      belief.tier === "decided" &&
      belief.meta.facet === "owner" &&
      belief.meta.corrected &&
      !belief.meta.retired,
  );
  if (decidedOwners.length === 0) return [];

  const conflicts: MemoryConflict[] = [];
  const seen = new Set<string>();

  for (const signal of input.signals) {
    const owner = (signal.ownerName ?? "").trim();
    if (!owner) continue;
    const ownerKey = personKeyOf({ name: owner });

    for (const belief of decidedOwners) {
      const rememberedName = belief.meta.corrected ?? "";
      if (!rememberedName) continue;
      if (personKeyOf({ name: rememberedName }) === ownerKey) continue;

      /*
       * Same work, said differently. A named project is the clearest tie; when
       * there is none, the remembered sentence and the reading have to overlap
       * substantially before Steward will call it a disagreement.
       */
      const project = belief.meta.projectLabel ?? "";
      const meaning = signal.normalizedMeaning;
      const sameWork = project
        ? phraseOverlap(project, meaning) >= PROJECT_STRONG
        : phraseOverlap(belief.statement, meaning) >= PROJECT_STRONG;
      if (!sameWork) continue;

      const key = `${signal.id}|${belief.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      conflicts.push({
        signalId: signal.id,
        facet: "owner",
        memorySays: `${rememberedName} carries this`,
        transcriptSays: `${owner} carries this`,
        because:
          "You corrected this once before. Steward is reading it differently now, so it is asking rather than assuming.",
        beliefId: belief.id,
        beliefStatement: belief.statement,
        subjectKey: belief.subjectKey,
        subjectLabel: belief.subjectLabel,
        ...(belief.meta.patternKey ? { patternKey: belief.meta.patternKey } : {}),
        memoryRecordedBy: belief.recordedBy,
        memoryRecordedAt: belief.recordedAt,
        transcriptStatement: `${owner} carries this, not ${rememberedName}.`,
      });
    }
  }
  return conflicts;
}
