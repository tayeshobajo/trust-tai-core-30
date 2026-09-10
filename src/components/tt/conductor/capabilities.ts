/**
 * What this room is allowed to do, said in five lines.
 *
 * The last two lines are the boundary, not a feature list: the Conductor asks
 * before anything consequential moves, and the room that owns the change is
 * the one that carries it out.
 */

export const CONDUCTOR_CAN = [
  "Read across the suite",
  "Explain what it sees",
  "Recommend next steps",
  "Ask before anything consequential moves",
  "Authorise bounded actions",
] as const;

export const CONDUCTOR_CANNOT =
  "The Conductor owns no room's truth. It cannot change a project, send a message, move a roadmap or decide on your behalf. Approval is not completion, and routing is not completion: when you authorise a step, the owning room carries it out and reports back.";

export type { ConductorGlance, MovedItem, NeedsTaiItem } from "@/data/conductor/page-projection";
