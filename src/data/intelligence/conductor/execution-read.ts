/**
 * The factory execution read, pure (Conductor V3).
 *
 * One honest view of a cross-room plan: what is waiting for a decision, what
 * is approved, what can actually be routed right now, what cannot and why,
 * what was routed, what the owning room has confirmed, what the expected
 * signal was, what was observed, and whether there is enough evidence to have
 * learned anything.
 *
 * No database, no room service: arithmetic over data already loaded, so the
 * rules can be tested exactly as they are enforced.
 */

import type {
  ActionLifecycleState,
  ControlledAction,
  ExecutionReceipt,
} from "@/domain/conductor-control";
import { LIFECYCLE_LABEL, isRoutableConsequence } from "@/domain/conductor-control";
import { capabilityFor } from "@/domain/adapter-registry";
import type { ActionObservation, LearningRecord, MetricClass } from "@/domain/outcomes";
import { RESULT_LABEL, metricClassOf } from "@/domain/outcomes";
import { canObserve } from "@/data/conductor/outcome-observer";

export type ExecutionStage =
  | "ready_to_approve"
  | "approved_not_routed"
  | "routable_now"
  | "not_routable"
  | "routed"
  | "confirmed"
  | "held"
  | "closed";

export interface ActionExecutionRead {
  action: ControlledAction;
  stage: ExecutionStage;
  stateLabel: string;
  /** Plain sentence: where this stands and why. */
  because: string;
  adapterId?: string;
  boundary?: string;
  expectedSignal: string;
  /** Whether the expected signal can be checked at all today. */
  measurable: boolean;
  observation?: ActionObservation;
  observedResult?: string;
  metricKey?: string;
  metricClass?: MetricClass;
  receipt?: ExecutionReceipt;
  learning?: LearningRecord;
  /** Honest answer to "have we learned anything from this yet?" */
  learningState: "not_yet" | "one_result" | "pattern" | "human_corrected";
  /**
   * The intelligence layer's own lifecycle, kept deliberately separate from
   * the business action's status. Knowing that a signal is absent says nothing
   * about whether the owning room considers its work complete.
   */
  outcomeStage:
    | "not_observed"
    | "not_measurable"
    | "signal_present"
    | "signal_absent"
    | "partial"
    | "inconclusive";
  /** When this action was last checked, if it ever was. */
  lastCheckedAt?: string;
}

function stageFor(
  action: ControlledAction,
  access: { can: (permission: string) => boolean },
): { stage: ExecutionStage; because: string } {
  const state = action.status;
  const capability = capabilityFor(action.owningApp, action.operation);

  if (state === "held") {
    return {
      stage: "held",
      because: action.approval?.reason
        ? `Held: ${action.approval.reason}`
        : "Held. Nothing has been handed to the owning room.",
    };
  }
  if (state === "rejected" || state === "withdrawn" || state === "measured") {
    return { stage: "closed", because: LIFECYCLE_LABEL[state] };
  }
  if (state === "proposed") {
    return { stage: "ready_to_approve", because: "Waiting for your decision." };
  }
  if (state === "accepted" || state === "executing" || state === "completed") {
    return {
      stage: "confirmed",
      because: `${action.owningApp} confirmed this: ${LIFECYCLE_LABEL[state].toLowerCase()}.`,
    };
  }
  if (state === "routed") {
    return {
      stage: "routed",
      because: `Handed to ${action.owningApp}. Only ${action.owningApp} can take it further.`,
    };
  }

  /* approved or failed: can it move? */
  if (!capability?.supported) {
    return {
      stage: "not_routable",
      because:
        capability?.because ??
        `${action.owningApp} exposes no safe service for "${action.operation}", so nothing may claim it was carried out.`,
    };
  }
  if (!isRoutableConsequence(action.consequence)) {
    return {
      stage: "not_routable",
      because:
        "This leaves the building. A person does it in the owning room, never the Conductor.",
    };
  }
  if (!access.can(String(action.requiredCapability))) {
    return {
      stage: "not_routable",
      because: `Routing this still needs ${action.requiredCapability} in ${action.owningApp}.`,
    };
  }
  const waiting = action.dependsOn.length > 0;
  if (state === "failed") {
    return {
      stage: "approved_not_routed",
      because: "The last handover failed. It can be retried.",
    };
  }
  return {
    stage: waiting ? "approved_not_routed" : "routable_now",
    because: waiting
      ? "Approved, waiting on the actions it depends on."
      : `Approved and ready to hand to ${action.owningApp}.`,
  };
}

function outcomeStage(
  observation: ActionObservation | undefined,
  measurable: boolean,
): ActionExecutionRead["outcomeStage"] {
  if (!observation) return measurable ? "not_observed" : "not_measurable";
  if (observation.result === "not_measurable") return "not_measurable";
  if (observation.result === "unknown") return "inconclusive";
  if (observation.outcomeStatus === "inconclusive") return "inconclusive";
  return observation.result;
}

function learningState(
  observation: ActionObservation | undefined,
  learning: LearningRecord | undefined,
): ActionExecutionRead["learningState"] {
  if (learning?.basis === "decided") return "human_corrected";
  if (learning?.isRule) return "pattern";
  if (observation?.outcomeStatus === "measured") return "one_result";
  return "not_yet";
}

export interface ExecutionReadInput {
  actions: ControlledAction[];
  receipts: ExecutionReceipt[];
  observations: ActionObservation[];
  learning: LearningRecord[];
  access: { can: (permission: string) => boolean };
}

export function buildExecutionRead(input: ExecutionReadInput): ActionExecutionRead[] {
  const receiptByAction = new Map(input.receipts.map((receipt) => [receipt.actionId, receipt]));
  const observationByAction = new Map<string, ActionObservation>();
  for (const observation of input.observations) {
    const current = observationByAction.get(observation.actionId);
    if (!current || current.measuredAt < observation.measuredAt) {
      observationByAction.set(observation.actionId, observation);
    }
  }
  const superseded = new Set(
    input.learning.map((record) => record.supersedes).filter(Boolean) as string[],
  );
  const learningByScope = new Map<string, LearningRecord>();
  for (const record of input.learning) {
    if (superseded.has(record.id)) continue;
    const key = `${record.scope.owningApp}:${record.scope.operation}`;
    const current = learningByScope.get(key);
    if (!current || current.recordedAt < record.recordedAt) learningByScope.set(key, record);
  }

  return input.actions.map((action) => {
    const { stage, because } = stageFor(action, input.access);
    const capability = capabilityFor(action.owningApp, action.operation);
    const observation = observationByAction.get(action.id);
    const learning = learningByScope.get(`${action.owningApp}:${action.operation}`);
    const metricKey = observation?.metricKey;

    return {
      action,
      stage,
      stateLabel: LIFECYCLE_LABEL[action.status as ActionLifecycleState],
      because,
      ...(capability?.adapterId ? { adapterId: capability.adapterId } : {}),
      ...(capability?.boundary ? { boundary: capability.boundary } : {}),
      expectedSignal: action.expectedSignal.statement,
      measurable: canObserve(action.operation),
      ...(observation ? { observation, observedResult: RESULT_LABEL[observation.result] } : {}),
      ...(metricKey ? { metricKey } : {}),
      ...(metricKey && metricClassOf(metricKey) ? { metricClass: metricClassOf(metricKey)! } : {}),
      ...(receiptByAction.get(action.id) ? { receipt: receiptByAction.get(action.id)! } : {}),
      ...(learning ? { learning } : {}),
      learningState: learningState(observation, learning),
      outcomeStage: outcomeStage(observation, canObserve(action.operation)),
      ...(observation ? { lastCheckedAt: observation.measuredAt } : {}),
    };
  });
}

/** One sentence for the whole plan. Never says "done". */
export function describeExecution(reads: ActionExecutionRead[]): string {
  if (reads.length === 0) return "Nothing is in the control loop right now.";
  const count = (stage: ExecutionStage) => reads.filter((read) => read.stage === stage).length;
  const parts: string[] = [];
  if (count("ready_to_approve")) parts.push(`${count("ready_to_approve")} waiting for you`);
  if (count("routable_now")) parts.push(`${count("routable_now")} ready to route`);
  if (count("routed")) parts.push(`${count("routed")} handed over`);
  if (count("confirmed")) parts.push(`${count("confirmed")} confirmed by the owning room`);
  if (count("not_routable")) parts.push(`${count("not_routable")} that no adapter can carry`);
  if (count("held")) parts.push(`${count("held")} held`);
  const measured = reads.filter((read) => read.observation?.outcomeStatus === "measured").length;
  const tail = measured > 0 ? ` ${measured} measured against their expected signal.` : "";
  return `${parts.join(", ")}.${tail}`;
}
