/**
 * What the Conductor room can honestly say about itself, in numbers.
 *
 * Every count here is read from the governed action ledger and its receipts
 * the same records the approval queue works from. Nothing is a second copy of
 * a room's truth, and nothing is inferred: an action that has been handed over
 * is reported as handed over, never as done.
 */

import type { ControlledAction, ExecutionReceipt } from "@/domain/conductor-control";
import type { Recommendation } from "@/domain/intelligence-engine";

export const CONDUCTOR_ROOM_LABEL: Record<string, string> = {
  scout: "Scout",
  comms: "Comms",
  roadmap: "Roadmap",
  projects: "Projects",
  ops: "Ops",
  studio: "Studio",
  steward: "Steward",
  activity: "Activity",
};

export function roomLabel(appId: string): string {
  return CONDUCTOR_ROOM_LABEL[appId] ?? appId;
}

export interface ConductorGlance {
  /** Readings offered for judgment right now. */
  recommendations: number;
  /** Bounded steps sitting at "proposed", waiting on a person. */
  authorizations: number;
  /** Handed to a room and not yet reported finished by that room. */
  executing: number;
  /** Held by a person: deliberately paused, not forgotten. */
  waiting: number;
  /** Reported complete by the owning room, or measured against its signal. */
  completed: number;
}

const EXECUTING: ReadonlySet<string> = new Set(["routed", "accepted", "executing"]);
const COMPLETED: ReadonlySet<string> = new Set(["completed", "measured"]);

export function conductorGlance(input: {
  actions: ControlledAction[];
  recommendations: Recommendation[];
}): ConductorGlance {
  const { actions, recommendations } = input;
  return {
    recommendations: recommendations.length,
    authorizations: actions.filter((a) => a.status === "proposed" && a.requiresApproval).length,
    executing: actions.filter((a) => EXECUTING.has(a.status)).length,
    waiting: actions.filter((a) => a.status === "held").length,
    completed: actions.filter((a) => COMPLETED.has(a.status)).length,
  };
}

export interface NeedsTaiItem {
  id: string;
  /** What the person is being asked to judge, in their language. */
  label: string;
  roomLabel: string;
  route: string;
}

/**
 * Only things that genuinely need a human decision: a bounded step awaiting
 * authorisation, or a reading whose recommendation is a choice rather than a
 * task. Work already moving is not listed, it is not waiting on anyone.
 */
export function needsTai(input: {
  actions: ControlledAction[];
  recommendations: Recommendation[];
  limit?: number;
}): NeedsTaiItem[] {
  const limit = input.limit ?? 4;
  const fromActions = input.actions
    .filter((action) => action.status === "proposed" && action.requiresApproval)
    .map((action) => ({
      id: action.id,
      label: action.intent,
      roomLabel: roomLabel(action.owningApp),
      route: action.route,
    }));

  const fromReadings = input.recommendations.map((recommendation) => ({
    id: recommendation.id,
    label: recommendation.headline,
    roomLabel: roomLabel(recommendation.destination.appId),
    route: recommendation.destination.route,
  }));

  const seen = new Set<string>();
  return [...fromActions, ...fromReadings]
    .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
    .slice(0, limit);
}

export interface MovedItem {
  id: string;
  label: string;
  roomLabel: string;
  at: string;
  /** Said plainly: a refusal is as real a movement as a handover. */
  outcome: "handed over" | "refused" | "failed";
}

const RECEIPT_OUTCOME: Record<string, MovedItem["outcome"]> = {
  routed: "handed over",
  refused: "refused",
  failed: "failed",
};

/** The last few things that actually moved, newest first. */
export function recentlyMoved(input: {
  receipts: ExecutionReceipt[];
  actions: ControlledAction[];
  limit?: number;
}): MovedItem[] {
  const byId = new Map(input.actions.map((action) => [action.id, action]));
  return [...input.receipts]
    .sort((a, b) => b.routedAt.localeCompare(a.routedAt))
    .slice(0, input.limit ?? 3)
    .map((receipt) => ({
      id: receipt.id,
      label: receipt.result?.label ?? byId.get(receipt.actionId)?.intent ?? receipt.boundaryCrossed,
      roomLabel: roomLabel(receipt.owningApp),
      at: receipt.routedAt,
      outcome: RECEIPT_OUTCOME[receipt.status] ?? "handed over",
    }));
}

/** The top few readings shown by default. The rest stay one disclosure away. */
export function leadRecommendations(
  recommendations: Recommendation[],
  limit = 3,
): Recommendation[] {
  return recommendations.slice(0, limit);
}
