/**
 * Who may authorise a bounded action, room by room.
 *
 * The engine never executes, and not every person who can see a proposal is
 * the right person to approve it. Authorisation is a role question owned by
 * the room the change belongs to: approving a Comms send is not the same
 * permission as sequencing a capability in Roadmap.
 *
 * Fails closed. An unknown room, an unknown operation or a missing access
 * context all resolve to "not yours to approve".
 */

import { can, type AccessContext, type Permission } from "./access";
import type { ActionProposal } from "./intelligence-engine";

/** The write permission each room requires before a person may approve work in it. */
const APP_AUTHORIZE_PERMISSION: Record<string, Permission> = {
  scout: "scout.write",
  comms: "comms.write",
  roadmap: "roadmap.write",
  projects: "projects.write",
  steward: "steward.write",
  ops: "ops.read",
};

/**
 * Operations that ask for more than ordinary write access.
 *
 * Sequencing a capability commits the house to build order, so it needs the
 * same authority as deciding a roadmap tier.
 */
const OPERATION_PERMISSION: Record<string, Permission> = {
  "roadmap.sequence_capability": "roadmap.decide",
};

/** The permission a specific proposal requires. */
export function actionPermission(proposal: Pick<ActionProposal, "appId" | "operation">): Permission {
  return (
    OPERATION_PERMISSION[proposal.operation] ??
    APP_AUTHORIZE_PERMISSION[proposal.appId] ??
    /* An unmapped room is never approvable by an ordinary member. */
    "org.manage"
  );
}

export interface AuthorityVerdict {
  allowed: boolean;
  permission: Permission;
  /** Plain language, shown to the person when the answer is no. */
  because: string;
}

const ROOM_LABEL: Record<string, string> = {
  scout: "Scout",
  comms: "Comms",
  roadmap: "Roadmap",
  projects: "Projects",
  steward: "Steward",
  ops: "Ops",
};

/** May this person authorise this bounded action? */
export function canAuthorizeAction(
  access: AccessContext | null | undefined,
  proposal: Pick<ActionProposal, "appId" | "operation">,
): AuthorityVerdict {
  const permission = actionPermission(proposal);
  const allowed = can(access, permission);
  const room = ROOM_LABEL[proposal.appId] ?? proposal.appId;
  return {
    allowed,
    permission,
    because: allowed
      ? `Your role may authorise work in ${room}.`
      : permission === "roadmap.decide"
        ? "Sequencing build order is a leadership decision. Ask an owner, admin or lead to authorise it."
        : `Your role can read ${room} but not authorise changes there.`,
  };
}

/** Assert authority before recording an authorisation. Throws when refused. */
export function assertCanAuthorizeAction(
  access: AccessContext | null | undefined,
  proposal: Pick<ActionProposal, "appId" | "operation">,
): void {
  const verdict = canAuthorizeAction(access, proposal);
  if (!verdict.allowed) throw new Error(verdict.because);
}
