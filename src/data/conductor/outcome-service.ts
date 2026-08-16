/**
 * The closed loop, wired (Conductor V3).
 *
 * Reads routed actions, checks each expected signal against the owning room's
 * own record, appends the measurement, and — only where the evidence is
 * strong enough — appends a lesson.
 *
 * The whole point is restraint: nothing is measured that cannot be read,
 * nothing becomes a rule from one result, and a person's correction outranks
 * anything the system worked out for itself.
 */

import type { ControlledAction, ExecutionReceipt } from "@/domain/conductor-control";
import type { ActionObservation, LearningRecord } from "@/domain/outcomes";
import { scopeKey } from "@/domain/outcomes";
import type { ID } from "@/domain/entities";
import { capabilityFor } from "@/domain/adapter-registry";
import { canObserve, observeAction } from "./outcome-observer";
import { distillLearning, relevantLearning, learningForPacket } from "./learning";
import {
  loadLearning,
  loadObservations,
  recordLearning,
  recordObservation,
} from "@/data/supabase/conductor-learning-service";

/** States in which an owning room could plausibly show the signal. */
const OBSERVABLE_STATES = ["routed", "accepted", "executing", "completed"];

export interface ObserveRunInput {
  organizationId: ID;
  actions: ControlledAction[];
  receipts: ExecutionReceipt[];
  /** Corrections a person made, keyed by "room:operation". */
  humanCorrections?: Record<string, { statement: string; by: string; at: string }>;
  now?: string;
  /** Test seam: existing ledger, so the run can be exercised without Supabase. */
  ledger?: {
    observations: ActionObservation[];
    learning: LearningRecord[];
    appendObservation: (observation: ActionObservation) => Promise<ActionObservation>;
    appendLearning: (record: LearningRecord) => Promise<LearningRecord>;
  };
}

export interface ObserveRunResult {
  observations: ActionObservation[];
  learning: LearningRecord[];
  /** Actions skipped, and the honest reason. Never counted as failures. */
  skipped: { actionId: ID; because: string }[];
}

/**
 * One pass of observe → learn.
 *
 * Idempotent by content: an observation's id is the reading itself, so
 * re-checking an unchanged room resolves to the row already there instead of
 * adding a second identical result. A lesson identical to the standing one is
 * not written again either.
 */
export async function runObservationPass(input: ObserveRunInput): Promise<ObserveRunResult> {
  const now = input.now ?? new Date().toISOString();
  const ledger = input.ledger ?? {
    observations: await loadObservations(input.organizationId),
    learning: await loadLearning(input.organizationId),
    appendObservation: recordObservation,
    appendLearning: recordLearning,
  };

  const receiptByAction = new Map(input.receipts.map((receipt) => [receipt.actionId, receipt]));
  const known = new Map(ledger.observations.map((observation) => [observation.id, observation]));
  const observations: ActionObservation[] = [];
  const skipped: { actionId: ID; because: string }[] = [];

  for (const action of input.actions) {
    if (!OBSERVABLE_STATES.includes(action.status)) {
      skipped.push({
        actionId: action.id,
        because: "Nothing has been handed to the owning room, so there is nothing to observe.",
      });
      continue;
    }
    if (!canObserve(action.operation)) {
      skipped.push({
        actionId: action.id,
        because: `Nothing in ${action.owningApp} can prove "${action.expectedSignal.statement}" yet.`,
      });
      continue;
    }
    const observation = await observeAction({
      action,
      receipt: receiptByAction.get(action.id),
      organizationId: input.organizationId,
      now,
    });
    /* Same reading as one already recorded: nothing new happened, so nothing
     * new is written and nothing new is counted. */
    const existing = known.get(observation.id);
    if (existing) {
      skipped.push({
        actionId: action.id,
        because: "The owning room says exactly what it said last time; this is the same result, not a new one.",
      });
      continue;
    }
    const saved = await ledger.appendObservation(observation);
    known.set(saved.id, saved);
    observations.push(saved);
  }

  /* Distil per scope, so a lesson is about a room operation, not one event. */
  const all = [...known.values()];

  const scopes = new Map<string, { owningApp: string; operation: string }>();
  for (const observation of all) {
    scopes.set(scopeKey({ owningApp: observation.owningApp, operation: observation.operation }), {
      owningApp: observation.owningApp,
      operation: observation.operation,
    });
  }

  const learning: LearningRecord[] = [];
  for (const [key, scope] of scopes) {
    const scoped = all.filter(
      (observation) =>
        observation.owningApp === scope.owningApp && observation.operation === scope.operation,
    );
    const prior = ledger.learning
      .filter((record) => scopeKey(record.scope) === key)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
    const record = distillLearning({
      organizationId: input.organizationId,
      scope,
      scopeLabel: capabilityFor(scope.owningApp, scope.operation)?.label ?? scope.operation,
      observations: scoped,
      prior,
      humanCorrection: input.humanCorrections?.[key],
      now,
    });
    if (record) learning.push(await ledger.appendLearning(record));
  }

  return { observations, learning, skipped };
}

/**
 * Bounded recall for a reasoning packet: only lessons about the rooms in play,
 * strongest first, with their basis attached so thin evidence stays thin.
 */
export async function learningContext(input: {
  organizationId: ID;
  rooms: string[];
  limit?: number;
  records?: LearningRecord[];
}): Promise<string[]> {
  const records = input.records ?? (await loadLearning(input.organizationId));
  return learningForPacket(
    relevantLearning({
      records,
      rooms: input.rooms,
      ...(input.limit ? { limit: input.limit } : {}),
    }),
  );
}
