/**
 * Trust Tai OS, the one line delivery projection.
 *
 * One compact read that bridges direction and delivery for a single
 * milestone: is delivery moving, which project carries it, how far through the
 * acceptance conditions we are, and what target date a person recorded.
 *
 * Laws:
 *   1. Every segment is derived from an owning store. Projects owns the
 *      execution state and the project identity, Roadmap owns the conditions
 *      and the target date. Nothing here stores anything.
 *   2. Unknown is never zero. Conditions that could not be read say so; they
 *      never read as "0 of 0".
 *   3. No health, risk, confidence or "on track" language is invented. Only
 *      the recorded execution state is named.
 *   4. Absence that a person can legitimately correct is reported as such, so
 *      the surface can offer the existing correction path (Canon 16).
 */

import { criteriaProgress, type AcceptanceCriterion } from "./milestone-criteria";
import { EXECUTION_STATE_LABEL, type ExecutionState } from "./projects";
import type { RoadmapMilestone } from "./roadmap-intel";

/** The carrying project, as Projects records it. */
export interface DeliveryProject {
  name: string;
  state: ExecutionState;
}

export interface DeliveryProjection {
  /** The segments in reading order, already worded. */
  segments: string[];
  /** The whole line, segments joined for a single compact read. */
  line: string;
  /** True when no project is carrying this milestone yet. */
  unowned: boolean;
  /** Set when a person could legitimately record the missing target date. */
  missing: "target-date" | null;
}

export const NO_CARRIER = "No project is carrying this work yet";
export const CRITERIA_UNREADABLE = "Acceptance conditions could not be read";
export const NO_CONDITIONS = "No acceptance conditions yet";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-09-11` reads as `Sep 11`. An unreal date is simply not shown. */
export function shortTargetDate(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const month = Number(raw.slice(5, 7));
  const day = Number(raw.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${MONTHS[month - 1]} ${day}`;
}

export function deliveryProjection(input: {
  milestone: RoadmapMilestone;
  /** The project carrying this milestone, or null when nothing does. */
  project: DeliveryProject | null;
  /**
   * The acceptance conditions for this milestone, or null when they could not
   * be read. Null and an empty list are deliberately different facts.
   */
  criteria: AcceptanceCriterion[] | null;
}): DeliveryProjection {
  const { milestone, project, criteria } = input;
  const segments: string[] = [];

  if (project) {
    segments.push(EXECUTION_STATE_LABEL[project.state]);
    if (project.name.trim()) segments.push(project.name.trim());
  } else {
    segments.push(NO_CARRIER);
  }

  if (criteria === null) {
    segments.push(CRITERIA_UNREADABLE);
  } else {
    const rows = criteria.filter((row) => row.milestoneId === milestone.id);
    if (rows.length === 0) {
      segments.push(NO_CONDITIONS);
    } else {
      const { done, total } = criteriaProgress(rows);
      segments.push(
        `${done} of ${total} acceptance ${total === 1 ? "condition" : "conditions"} met`,
      );
    }
  }

  const target = shortTargetDate(milestone.success?.targetDate ?? null);
  if (target) segments.push(`target ${target}`);

  return {
    segments,
    line: segments.join(" · "),
    unowned: !project,
    missing: target ? null : "target-date",
  };
}
