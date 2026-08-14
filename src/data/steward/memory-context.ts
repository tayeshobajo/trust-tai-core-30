/**
 * Choosing the small amount of memory that helps read one conversation.
 *
 * Handing a model everything Steward has ever believed makes it worse, not
 * better: it starts pattern-matching against strangers. So selection is
 * bounded and relevance-first — the people actually in the room, the projects
 * actually named, the corrections that actually touch them — and hard-capped
 * by `MEMORY_SELECTION_LIMITS`.
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
  type RelevantMemory,
} from "@/domain/steward-memory";

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

/** Decided first, then most recent. A person's word leads the list. */
function rank(beliefs: MemoryBelief[]): MemoryBelief[] {
  return [...beliefs].sort((left, right) => {
    if (left.tier !== right.tier) return left.tier === "decided" ? -1 : 1;
    return right.recordedAt.localeCompare(left.recordedAt);
  });
}

/**
 * The slice of memory worth showing this reading: beliefs about someone in the
 * room, or about a project the conversation is plausibly about.
 */
export function selectRelevantMemory(input: {
  beliefs: MemoryBelief[];
  conversation: NormalizedConversation;
  people: { name: string; title?: string }[];
  projects: { id: string; label: string }[];
  suppressedPatterns?: string[];
}): RelevantMemory {
  const keys = participantKeys(input.conversation);
  const suppressed = new Set(input.suppressedPatterns ?? []);
  const spoken = input.conversation.segments
    .map((segment) => segment.text)
    .join(" ")
    .toLowerCase();

  const relevant = input.beliefs.filter((belief) => {
    if (belief.meta.patternKey && suppressed.has(belief.meta.patternKey)) return false;
    const personKey = belief.meta.personKey;
    const counterpartKey = belief.meta.counterpartKey;
    if (personKey && keys.has(personKey)) return true;
    if (counterpartKey && keys.has(counterpartKey)) return true;
    const project = belief.meta.projectLabel;
    if (project && spoken.includes(project.toLowerCase())) return true;
    return false;
  });

  const ordered = rank(relevant);
  const decided = ordered
    .filter((belief) => belief.tier === "decided")
    .slice(0, MEMORY_SELECTION_LIMITS.decided)
    .map((belief) => `${belief.subjectLabel}: ${belief.statement}`);
  const inferred = ordered
    .filter((belief) => belief.tier !== "decided")
    .slice(0, MEMORY_SELECTION_LIMITS.inferred)
    .map((belief) => `${belief.subjectLabel}: ${belief.statement}`);

  const people = input.people
    .filter((person) => keys.size === 0 || keys.has(personKeyOf({ name: person.name })))
    .slice(0, MEMORY_SELECTION_LIMITS.people);

  const projects = input.projects
    .filter((project) => spoken.includes(project.label.toLowerCase()))
    .slice(0, MEMORY_SELECTION_LIMITS.projects);

  return {
    decided,
    inferred,
    people: people.length > 0 ? people : input.people.slice(0, MEMORY_SELECTION_LIMITS.people),
    projects: projects.length > 0 ? projects : input.projects.slice(0, MEMORY_SELECTION_LIMITS.projects),
  };
}

/**
 * Where this reading disagrees with something a person previously decided.
 *
 * Surfaced, not corrected. Memory being out of date is at least as likely as
 * the transcript being misread, and only a person can tell which happened.
 */
export function flagMemoryConflicts(input: {
  signals: InterpretedSignal[];
  beliefs: MemoryBelief[];
}): MemoryConflict[] {
  const decidedOwners = input.beliefs.filter(
    (belief) =>
      belief.tier === "decided" && belief.meta.facet === "owner" && belief.meta.corrected,
  );
  if (decidedOwners.length === 0) return [];

  const conflicts: MemoryConflict[] = [];
  for (const signal of input.signals) {
    const owner = (signal.ownerName ?? "").trim();
    if (!owner) continue;
    const ownerKey = personKeyOf({ name: owner });

    for (const belief of decidedOwners) {
      const rememberedName = belief.meta.corrected ?? "";
      if (!rememberedName) continue;
      const rememberedKey = personKeyOf({ name: rememberedName });
      if (rememberedKey === ownerKey) continue;
      /* Only a conflict when it is plainly about the same work. */
      const subject = (belief.meta.projectLabel ?? "").toLowerCase();
      if (!subject || !signal.normalizedMeaning.toLowerCase().includes(subject)) continue;

      conflicts.push({
        signalId: signal.id,
        facet: "owner",
        memorySays: `${rememberedName} carries this`,
        transcriptSays: `${owner} carries this`,
        because:
          "You corrected this once before. Steward is reading it differently now, so it is asking rather than assuming.",
      });
    }
  }
  return conflicts;
}
