/**
 * Trust Tai OS, the lifecycle actions a person may take on one milestone.
 *
 * The milestone card shows one primary action and hides everything else in a
 * quiet overflow. That overflow must never offer a contradiction: approving an
 * approved milestone, rejecting a rejected one. This module is the single
 * answer to "what is genuinely valid from here", so the UI never invents it.
 *
 * Nothing here decides anything. It only says what a person is allowed to
 * choose next.
 */

import { MILESTONE_STATUSES, MILESTONE_STATUS_LABEL, type MilestoneStatus } from "./roadmap-intel";

export interface MilestoneAction {
  status: MilestoneStatus;
  /** The verb, as a person would say it out loud. */
  label: string;
}

const VERB: Record<MilestoneStatus, string> = {
  candidate: "Return to candidates",
  shortlisted: "Shortlist",
  approved: "Approve",
  rejected: "Reject",
  deferred: "Defer",
};

/** Every status except the one it already holds, in a stable reading order. */
export function milestoneActions(current: MilestoneStatus): MilestoneAction[] {
  return MILESTONE_STATUSES.filter((status) => status !== current).map((status) => ({
    status,
    label: VERB[status],
  }));
}

/** The confirmation line for a chosen action, so nothing moves silently. */
export function milestoneActionPrompt(status: MilestoneStatus): string {
  return `Mark this milestone ${MILESTONE_STATUS_LABEL[status].toLowerCase()}`;
}
