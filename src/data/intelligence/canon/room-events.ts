/**
 * Room events that can close a case, by exact reference only.
 *
 * A room already records the decisions that matter: a project completed, a
 * decision resolved, a prospect qualified, a handover made, a commitment
 * closed. When one of those lands on the very entity an open case referenced,
 * and after that case was decided, the case has an answer without anyone
 * retyping it.
 *
 * This is not a new decision framework. There is no inference: no entity link,
 * no outcome. The rooms keep owning their work, and nothing here executes.
 */

import type { ActivityEvent, ActivityName } from "@/domain/activity";
import type { EntityRef } from "@/domain/entities";
import type { IntelligenceCase, PatternOutcome } from "@/domain/intelligence-canon";

import { checkableKinds } from "./outcome-checks";

/**
 * The bounded set. Each entry names a canonical room event and the observation
 * kinds it genuinely settles. Anything not listed is left to the deterministic
 * snapshot check or to a person.
 */
export const CLOSING_ROOM_EVENTS: {
  name: ActivityName;
  clears: string[];
  because: string;
}[] = [
  {
    name: "project.completed",
    clears: ["project_delayed", "project_blocked", "no_active_project"],
    because: "The project this reading was about was completed in Projects.",
  },
  {
    name: "project.started",
    clears: ["no_active_project"],
    because: "Work on this started in Projects after the decision.",
  },
  {
    name: "decision.decision_resolved",
    clears: ["open_decisions", "roadmap_direction_undecided"],
    because: "The decision this reading was waiting on was resolved.",
  },
  {
    name: "prospect.qualified",
    clears: ["strong_fit_unreviewed"],
    because: "The company this reading was about was reviewed and qualified in Scout.",
  },
  {
    name: "prospect.handed_over",
    clears: ["pipeline_unrouted", "strong_fit_unreviewed"],
    because: "Scout handed this company on, so it is no longer sitting unrouted.",
  },
  {
    name: "task.completed",
    clears: ["commitment_overdue"],
    because: "The commitment this reading was about was completed.",
  },
];

function sameEntity(a: EntityRef, b: EntityRef): boolean {
  return a.type === b.type && a.id === b.id;
}

/** Whether the event lands on an entity the case actually referenced. */
function touchesCase(event: ActivityEvent, entry: IntelligenceCase): boolean {
  if (entry.entities.length === 0) return false;
  const refs = [event.subject, ...(event.related ?? [])];
  return entry.entities.some((entity) => refs.some((ref) => sameEntity(ref, entity)));
}

export interface RoomEventOutcome {
  caseId: string;
  patternId: string;
  because: string;
  activityId: string;
  hoursToOutcome: number;
}

/**
 * Every open case a canonical room event has genuinely answered. Cases with no
 * exact link are left alone, which is the common and correct answer.
 */
export function roomEventOutcomes(input: {
  cases: IntelligenceCase[];
  events: ActivityEvent[];
}): RoomEventOutcome[] {
  const out: RoomEventOutcome[] = [];

  for (const entry of input.cases) {
    const kinds = checkableKinds(entry.patternId);
    if (kinds.length === 0) continue;
    const decidedAt = Date.parse(entry.decidedAt);
    if (Number.isNaN(decidedAt)) continue;

    for (const event of input.events) {
      const rule = CLOSING_ROOM_EVENTS.find((row) => row.name === event.name);
      if (!rule) continue;
      if (!rule.clears.some((kind) => kinds.includes(kind))) continue;
      const at = Date.parse(event.occurredAt);
      if (Number.isNaN(at) || at < decidedAt) continue;
      if (!touchesCase(event, entry)) continue;

      out.push({
        caseId: entry.id,
        patternId: entry.patternId,
        because: rule.because,
        activityId: event.id,
        hoursToOutcome: Math.max(0, Math.round((at - decidedAt) / 3_600_000)),
      });
      break;
    }
  }

  return out;
}

/** The outcome row a room event becomes. A room event only ever reads success. */
export function outcomeFromRoomEvent(input: {
  entry: IntelligenceCase;
  event: RoomEventOutcome;
  recordedBy: string;
  now: string;
}): Omit<PatternOutcome, "id"> {
  return {
    organizationId: input.entry.organizationId,
    patternId: input.entry.patternId,
    patternVersion: input.entry.patternVersion,
    caseId: input.entry.id,
    recommendation: input.entry.hypothesis,
    decision: "accepted",
    result: "success",
    resultBecause: input.event.because,
    hoursToOutcome: input.event.hoursToOutcome,
    ...(input.entry.correction ? { humanCorrection: input.entry.correction } : {}),
    recordedBy: input.recordedBy,
    recordedAt: input.now,
  };
}
