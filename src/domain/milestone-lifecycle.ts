/**
 * Trust Tai OS, the everyday milestone lifecycle.
 *
 * Outcome -> Target date -> Acceptance criteria -> Evidence -> Human decision.
 *
 * This module only reads. It derives where a milestone stands from truth that
 * already exists (the success definition Roadmap stores and the acceptance
 * checklist a person ticks), says plainly what is still missing, and names the
 * one action that resolves it so a page never dead ends.
 *
 * Two laws hold here and are enforced by tests:
 *   1. Progress is derived from acceptance criteria only. Attached proof never
 *      counts towards it.
 *   2. A full checklist is readiness, never a decision. Nothing in this module
 *      completes a milestone, and roadmap approval (status `approved` at
 *      `decided` tier) means the milestone was selected into the roadmap, not
 *      that delivery was accepted. No completion truth exists yet.
 */

import { criteriaProgress, type AcceptanceCriterion } from "./milestone-criteria";
import { acceptanceSummary, isAccepted } from "./milestone-acceptance";
import type { RoadmapMilestone } from "./roadmap-intel";

/** Where the milestone stands, in the order a person works through it. */
export type LifecycleStep = "outcome" | "criteria" | "acceptance" | "accepted";

/** What a person can do next, when something is missing. */
export type LifecycleFix = "outcome" | "criteria" | null;

export interface MilestoneLifecycle {
  step: LifecycleStep;
  /** The step, as a person would name it. */
  stepLabel: string;
  /** Derived from acceptance criteria only. */
  progress: { done: number; total: number; met: boolean };
  /** Compact read, for example "1/3". Empty when there is no checklist yet. */
  progressLabel: string;
  /** True only when a person may make the final call now. */
  ready: boolean;
  /** True once a person has explicitly accepted the delivered work. */
  accepted: boolean;
  /** One plain line for the current state. */
  headline: string;
  /** What still has to be true, or null when nothing does. */
  remaining: string | null;
  /** The action that resolves `remaining`, on this same surface. */
  fix: LifecycleFix;
  /** The label for that action. */
  fixLabel: string | null;
}

const STEP_LABEL: Record<LifecycleStep, string> = {
  outcome: "Describe success",
  criteria: "Work through the conditions",
  acceptance: "Ready for acceptance",
  accepted: "Accepted",
};

export const ACCEPTANCE_READY =
  "Every condition is checked. This is ready for your acceptance.";

export function milestoneLifecycle(
  milestone: RoadmapMilestone,
  criteria: AcceptanceCriterion[],
): MilestoneLifecycle {
  const rows = criteria.filter((row) => row.milestoneId === milestone.id);
  const progress = criteriaProgress(rows);
  const progressLabel = progress.total > 0 ? `${progress.done}/${progress.total}` : "";
  const outcome = milestone.success?.outcome?.trim() ?? "";

  const base = { progress, progressLabel, accepted: isAccepted(milestone) };

  if (milestone.acceptance) {
    return {
      ...base,
      step: "accepted",
      stepLabel: STEP_LABEL.accepted,
      ready: false,
      headline: acceptanceSummary(milestone.acceptance),
      remaining: milestone.acceptance.note?.trim() || null,
      fix: null,
      fixLabel: null,
    };
  }

  if (!outcome) {
    return {
      ...base,
      step: "outcome",
      stepLabel: STEP_LABEL.outcome,
      ready: false,
      headline: "Nobody has said what success looks like yet.",
      remaining: "Describe the outcome, and a target date if there is one.",
      fix: "outcome",
      fixLabel: "Describe the outcome",
    };
  }

  if (progress.total === 0) {
    return {
      ...base,
      step: "criteria",
      stepLabel: STEP_LABEL.criteria,
      ready: false,
      headline: "No conditions have been written yet.",
      remaining: "Write the conditions that have to be true before this is done.",
      fix: "criteria",
      fixLabel: "Add a condition",
    };
  }

  if (!progress.met) {
    const left = progress.total - progress.done;
    return {
      ...base,
      step: "criteria",
      stepLabel: STEP_LABEL.criteria,
      ready: false,
      headline: `${progress.done} of ${progress.total} conditions met.`,
      remaining:
        left === 1
          ? "One condition still has to be true and checked by a person."
          : `${left} conditions still have to be true and checked by a person.`,
      fix: "criteria",
      fixLabel: null,
    };
  }

  return {
    ...base,
    step: "acceptance",
    stepLabel: STEP_LABEL.acceptance,
    ready: true,
    headline: ACCEPTANCE_READY,
    remaining: null,
    fix: null,
    fixLabel: null,
  };
}
