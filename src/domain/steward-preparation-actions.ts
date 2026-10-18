/**
 * Bounded AI preparation for a canonical business task — the honest catalog.
 *
 * The existing agent runner completes agent-assigned tasks and records
 * completion for them. That behavior is correct for legacy agent tasks and
 * must never run against a canonical human task: a text artifact is not task
 * delivery, and no run may grant verified credit or auto-complete board work.
 *
 * Until a durable canonical run bridge exists (see
 * docs/steward-canonical-run-bridge.DRAFT.md — proposed, UNAPPLIED), every
 * action here is shown as unavailable with the precise reason. Nothing in
 * this module starts a run, fakes progress or weakens the risk classifier.
 */

import type { BoardTask } from "./cmd-tasks";

export interface PreparationAction {
  id: "prepare_brief" | "draft_roadmap" | "prepare_handoff" | "review_output";
  label: string;
  summary: string;
}

export const PREPARATION_ACTIONS: readonly PreparationAction[] = [
  {
    id: "prepare_brief",
    label: "Prepare a task brief",
    summary: "A reviewable brief from this task's recorded context. Not delivery.",
  },
  {
    id: "draft_roadmap",
    label: "Draft a roadmap outline",
    summary: "A draft outline for a person to reshape. Never a published roadmap.",
  },
  {
    id: "prepare_handoff",
    label: "Prepare a mockup handoff",
    summary: "A handoff note for design work. It does not build the mockup or the site.",
  },
  {
    id: "review_output",
    label: "Review an attached output",
    summary: "A second read of a recorded output link, when one exists.",
  },
] as const;

export interface PreparationAvailability {
  action: PreparationAction;
  /** True only when the task carries enough recorded context to prepare from. */
  offered: boolean;
  because: string;
}

/** The bridge between bounded preparation and a canonical task does not exist yet. */
export const CANONICAL_RUN_BRIDGE = {
  available: false,
  because:
    "AI preparation for canonical tasks is unavailable: the existing runner completes agent-assigned tasks and must never auto-complete shared board work. A reviewed durable run bridge is proposed in docs/steward-canonical-run-bridge.DRAFT.md and has not been applied.",
} as const;

/**
 * Which actions are even offerable for this task, given only what is recorded.
 * "Offered" still means disabled until the bridge exists — it separates
 * "no context to prepare from" from "backend contract pending".
 */
export function preparationAvailability(
  task: Pick<BoardTask, "context_links" | "notes" | "acceptance_criteria">,
): PreparationAvailability[] {
  const hasContext =
    task.context_links.length > 0 ||
    (task.notes ?? "").trim().length > 0 ||
    task.acceptance_criteria.length > 0;
  const hasOutputLink = task.context_links.some(
    (link) => link.kind === "output" || link.kind === "deliverable",
  );
  return PREPARATION_ACTIONS.map((action) => {
    if (!hasContext) {
      return {
        action,
        offered: false,
        because: "No recorded context, notes or acceptance criteria to prepare from.",
      };
    }
    if (action.id === "review_output" && !hasOutputLink) {
      return {
        action,
        offered: false,
        because: "No recorded output link to review.",
      };
    }
    return { action, offered: true, because: CANONICAL_RUN_BRIDGE.because };
  });
}
