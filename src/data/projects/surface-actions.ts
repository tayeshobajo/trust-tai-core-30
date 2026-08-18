/**
 * The moves a project can make, in the room's own language.
 *
 * Projects speaks in six words — Ready, In progress, Blocked, Waiting,
 * In review, Complete — while the record underneath keeps execution states.
 * This module is the one translation, and it is pure: the same project always
 * offers the same moves with the same refusals, so a button on a card and a
 * write in the service can never disagree.
 */

import {
  checkTransition,
  EXECUTION_STATE_LABEL,
  type ExecutionProject,
  type ExecutionState,
} from "@/domain/projects";

import { SURFACE_STATUS_LABEL, surfaceStatus, type SurfaceStatus } from "./index-projection";

/** Which recorded state each spoken status writes. */
export const STATE_FOR_SURFACE: Record<SurfaceStatus, ExecutionState> = {
  ready: "not_started",
  in_progress: "in_flight",
  blocked: "blocked",
  waiting: "in_flight",
  in_review: "in_review",
  complete: "delivered",
};

/** The order the room offers moves in, which is the order work travels. */
export const SURFACE_ORDER: SurfaceStatus[] = [
  "ready",
  "in_progress",
  "waiting",
  "blocked",
  "in_review",
  "complete",
];

export interface SurfaceMoveChanges {
  state: ExecutionState;
  blockedBecause?: string;
  waitingOn?: string;
  nextMove?: string;
}

export interface SurfaceAction {
  target: SurfaceStatus;
  label: string;
  state: ExecutionState;
  /** True when this is where the work already is. */
  current: boolean;
  ok: boolean;
  /** Plain language: what this does, or why it is refused. */
  because: string;
  /** Blocked and Waiting are meaningless without a reason, so one is asked for. */
  needsReason: boolean;
  reasonPrompt?: string;
}

/**
 * Waiting and In progress are the same recorded state, so a same-state move
 * between them is legal even though the underlying transition is a no-op.
 */
function sameStateMove(from: SurfaceStatus, to: SurfaceStatus): boolean {
  return STATE_FOR_SURFACE[from] === STATE_FOR_SURFACE[to] && from !== to;
}

/** What to write for a spoken move. Reason is trimmed by the caller's UI. */
export function changesForSurface(target: SurfaceStatus, reason = ""): SurfaceMoveChanges {
  const state = STATE_FOR_SURFACE[target];
  const clean = reason.trim();
  if (target === "blocked") return { state, blockedBecause: clean };
  if (target === "waiting") return { state, waitingOn: clean };
  // Leaving the wait means the wait is over, and it must say so explicitly.
  return { state, waitingOn: "" };
}

/**
 * Every move this project could be asked to make, legal or not. Illegal ones
 * are kept and disabled with their reason: a person deserves to know why a
 * door is shut, not to find it missing.
 */
export function surfaceActions(
  project: ExecutionProject,
  reason = "",
): SurfaceAction[] {
  const from = surfaceStatus(project);

  return SURFACE_ORDER.map((target) => {
    const state = STATE_FOR_SURFACE[target];
    const needsReason = target === "blocked" || target === "waiting";
    const current = target === from;

    const base: Omit<SurfaceAction, "ok" | "because"> = {
      target,
      label: SURFACE_STATUS_LABEL[target],
      state,
      current,
      needsReason,
      ...(target === "blocked"
        ? { reasonPrompt: "What is blocking this?" }
        : target === "waiting"
          ? { reasonPrompt: "What is it waiting on?" }
          : {}),
    };

    if (current) {
      return { ...base, ok: false, because: `Already ${SURFACE_STATUS_LABEL[target]}.` };
    }

    if (needsReason && !reason.trim() && !(target === "blocked" && project.blockedBecause?.trim())) {
      return {
        ...base,
        ok: false,
        because:
          target === "blocked"
            ? "Say what is blocking it. A block nobody named cannot be cleared."
            : "Say what it is waiting on, so the wait can end.",
      };
    }

    if (sameStateMove(from, target)) {
      return { ...base, ok: true, because: `Records this as ${SURFACE_STATUS_LABEL[target]}.` };
    }

    const check = checkTransition(project, state, {
      ...(target === "blocked" && reason.trim() ? { blockedBecause: reason.trim() } : {}),
    });
    if (!check.ok) return { ...base, ok: false, because: check.because };

    return {
      ...base,
      ok: true,
      because: `Moves to ${SURFACE_STATUS_LABEL[target]} (${EXECUTION_STATE_LABEL[state]}).`,
    };
  });
}
