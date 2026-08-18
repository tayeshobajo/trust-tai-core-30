/**
 * Who may act, and the plain sentence explaining why not.
 *
 * One rule set, read by both the interface and the write path, so the screen
 * can never offer an action the write path will refuse, and a refusal always
 * arrives with a reason a person can act on.
 */

import type { StewardTask } from "@/domain/steward-accountability";

export interface StewardActor {
  userId: string;
  canManage: boolean;
}

export interface AuthorityRead {
  allowed: boolean;
  /** Null only when the action is allowed. */
  because: string | null;
}

const ALLOWED: AuthorityRead = { allowed: true, because: null };

function refuse(because: string): AuthorityRead {
  return { allowed: false, because };
}

/** Completing a task in Steward. Only meeting-only promises qualify. */
export function completeAuthority(task: StewardTask, actor: StewardActor): AuthorityRead {
  if (task.state === "complete") return refuse("This is already recorded as complete.");
  if (task.owner.kind === "agent") {
    return refuse(
      "Agent work is completed by Paperclip. Steward shows it as done once Paperclip reports it.",
    );
  }
  if (task.completionPath !== "steward") {
    return refuse(
      task.completionBecause ?? "This task is completed in the room that owns its truth.",
    );
  }
  if (!actor.canManage && task.owner.userId !== actor.userId) {
    return refuse(
      `${task.owner.name} carries this. Only they, or an owner or admin, can mark it complete.`,
    );
  }
  return ALLOWED;
}

/** Changing who carries a task. */
export function reassignAuthority(task: StewardTask, actor: StewardActor): AuthorityRead {
  if (!actor.canManage) {
    return refuse("Only an owner or admin can change who carries work.");
  }
  if (task.origin !== "commitment") {
    return refuse(
      "This task is owned by another room. Change its owner there and Steward will follow.",
    );
  }
  return ALLOWED;
}

/** Changing a due date. Delivery dates belong to the room that owns them. */
export function dueDateAuthority(task: StewardTask, actor: StewardActor): AuthorityRead {
  if (task.origin !== "commitment") {
    return refuse("Dates on delivery work are set in the room that owns it.");
  }
  if (!actor.canManage && task.owner.userId !== actor.userId) {
    return refuse(`${task.owner.name} carries this. Only they, or an owner or admin, can move it.`);
  }
  return ALLOWED;
}
