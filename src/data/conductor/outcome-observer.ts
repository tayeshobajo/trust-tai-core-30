/**
 * Signal evaluation (Conductor V3).
 *
 * An expected signal is only ever checked against the owning room's own
 * record. Where the room can be read, the result is `observed`. Where it
 * cannot, the result is `not_measurable` · never a guessed success.
 *
 * Nothing here claims causation. "The draft exists" is a fact about Comms; it
 * is not proof that the Conductor's suggestion caused anything to happen.
 */

import { commsService } from "@/data/supabase/comms-service";
import { projectsService } from "@/data/supabase/projects-service";
import { roadmapService } from "@/data/supabase/roadmap-service";
import { scoutService } from "@/data/supabase/scout-service";
import type { ControlledAction, ExecutionReceipt } from "@/domain/conductor-control";
import type { ActionObservation, ResultClassification, TruthClass } from "@/domain/outcomes";
import { metricClassOf, observationFingerprint, observationId } from "@/domain/outcomes";
import type { EvidenceRef } from "@/domain/confidence";
import type { ID } from "@/domain/entities";

export interface ObservationInput {
  action: ControlledAction;
  receipt?: ExecutionReceipt | undefined;
  organizationId: ID;
  now?: string;
}

interface Reading {
  result: ResultClassification;
  truth: TruthClass;
  evidence: EvidenceRef[];
  because: string;
  metricKey?: string;
}

const NOT_MEASURABLE = (because: string): Reading => ({
  result: "not_measurable",
  truth: "unknown",
  evidence: [],
  because,
});

/** Which room reads which signal. Anything absent is not measurable. */
const READERS: Record<
  string,
  (input: ObservationInput) => Promise<Reading>
> = {
  /* Comms, the draft either exists in Comms' own record or it does not. */
  async "comms.draft_reply"(input) {
    const relationshipId = String(input.action.payload?.["relationshipId"] ?? "");
    const reference = input.receipt?.result?.reference;
    if (!relationshipId) return NOT_MEASURABLE("No relationship was named, so Comms cannot be read.");
    const drafts = await commsService.listDrafts(relationshipId);
    const match = reference
      ? drafts.find((draft) => draft.id === reference)
: undefined;
    if (!match) {
      return {
        result: "signal_absent",
        truth: "observed",
        evidence: [{ label: "Comms holds no draft with that reference", kind: "computed" }],
        because: "Comms was readable and the prepared draft is not there.",
        metricKey: "comms.drafts_prepared",
      };
    }
    return {
      result: "signal_present",
      truth: "observed",
      evidence: [{ label: `Comms holds an unsent draft (${match.id})`, kind: "computed" }],
      because: "The draft is in Comms, unsent, waiting for a person.",
      metricKey: "comms.drafts_prepared",
    };
  },

  /* Projects, the blocker text is on the project record or it is not. */
  async "projects.record_blocker"(input) {
    const projectId = String(input.action.payload?.["projectId"] ?? "");
    const expected = String(input.action.payload?.["blocker"] ?? "").trim();
    if (!projectId) return NOT_MEASURABLE("No project was named, so Projects cannot be read.");
    const project = await projectsService.get(projectId, input.organizationId);
    if (!project) return NOT_MEASURABLE("That project is no longer readable in this organization.");
    const recorded = (project.blockedBecause ?? "").trim();
    if (recorded.length === 0) {
      return {
        result: "signal_absent",
        truth: "observed",
        evidence: [{ label: `${project.name} records no blocker`, kind: "computed" }],
        because: "Projects was readable and no blocker is recorded.",
        metricKey: "projects.blocker_age",
      };
    }
    return {
      result: recorded === expected ? "signal_present": "partial",
      truth: "observed",
      evidence: [{ label: `${project.name} records: ${recorded}`, kind: "computed" }],
      because:
        recorded === expected
          ? "Projects records exactly the blocker that was approved."
: "Projects records a blocker, though a person has since changed the wording.",
      metricKey: "projects.blocker_age",
    };
  },

  /* Scout, the discovery run exists in Scout's own run history. */
  async "scout.start_discovery_run"(input) {
    const reference = input.receipt?.result?.reference;
    if (!reference) return NOT_MEASURABLE("No discovery run reference was returned by Scout.");
    const runs = await scoutService.runs(input.organizationId);
    const match = runs.find((run) => run.id === reference);
    if (!match) {
      return {
        result: "signal_absent",
        truth: "observed",
        evidence: [{ label: "Scout's run history holds no such pass", kind: "computed" }],
        because: "Scout was readable and the run is not in its history.",
        metricKey: "scout.discovery_runs",
      };
    }
    return {
      result: (match.resultCount ?? 0) > 0 ? "signal_present": "partial",
      truth: "observed",
      evidence: [
        {
          label: `Scout run ${match.id} (${match.status}) saved ${match.resultCount ?? 0} companies`,
          kind: "computed",
        },
      ],
      because:
        (match.resultCount ?? 0) > 0
          ? "Scout ran the pass and saved companies it could verify."
: "Scout ran the pass but saved nothing it could verify.",
      metricKey: "scout.discovery_runs",
    };
  },

  /* Roadmap, the decision request is open in Roadmap's own record. */
  async "roadmap.request_decision"(input) {
    const roadmapId = String(input.action.payload?.["roadmapId"] ?? "");
    const reference = input.receipt?.result?.reference;
    if (!roadmapId) return NOT_MEASURABLE("No roadmap was named, so Roadmap cannot be read.");
    const detail = await roadmapService.detail(roadmapId, input.organizationId);
    if (!detail) return NOT_MEASURABLE("That roadmap is no longer readable in this organization.");
    const match = detail.decisions.find((decision) => decision.id === reference);
    if (!match) {
      return {
        result: "signal_absent",
        truth: "observed",
        evidence: [{ label: "Roadmap holds no such decision request", kind: "computed" }],
        because: "Roadmap was readable and the question is not there.",
        metricKey: "roadmap.decision_requests",
      };
    }
    return {
      result: "signal_present",
      truth: "observed",
      evidence: [{ label: `Roadmap holds an open question (${match.id})`, kind: "computed" }],
      because: "The question is open in Roadmap, waiting for a person to answer it.",
      metricKey: "roadmap.decision_requests",
    };
  },
};

/** Operations the system can honestly measure today. */
export function measurableOperations(): string[] {
  return Object.keys(READERS);
}

export function canObserve(operation: string): boolean {
  return operation in READERS;
}

/**
 * Read one governed action's expected signal from the owning room.
 * Never fabricates: an unreadable room yields `not_measurable`.
 */
export async function observeAction(input: ObservationInput): Promise<ActionObservation> {
  const at = input.now ?? new Date().toISOString();
  const reader = READERS[input.action.operation];
  const reading: Reading = reader
    ? await reader(input).catch((error: Error) =>
        NOT_MEASURABLE(`The owning room could not be read: ${error.message}`),
      )
: NOT_MEASURABLE(
        `Nothing in ${input.action.owningApp} can prove "${input.action.expectedSignal.statement}" yet.`,
      );

  const measured = reading.result !== "not_measurable" && reading.result !== "unknown";
  const metricKey = reading.metricKey;

  /*
   * Identity is the reading, not the clock: re-checking an unchanged room
   * yields the same id, so a refresh can never inflate the evidence count.
   */
  const outcomeStatus = measured ? ("measured" as const): ("inconclusive" as const);
  const fingerprint = observationFingerprint({
    actionId: input.action.id,
    result: reading.result,
    truth: reading.truth,
    outcomeStatus,
    metricKey,
    evidence: reading.evidence,
  });

  return {
    id: observationId(input.action.id, fingerprint),
    organizationId: input.organizationId,
    actionId: input.action.id,
...(input.action.recommendationId ? { recommendationId: input.action.recommendationId }: {}),
...(input.action.answerId ? { answerId: input.action.answerId }: {}),
...(input.action.planId ? { planId: input.action.planId }: {}),
    owningApp: input.action.owningApp,
    operation: input.action.operation,
    expectedSignal: input.action.expectedSignal,
...(input.action.routedAt ? { observationWindow: { from: input.action.routedAt } }: {}),
    observedEvidence: reading.evidence,
    result: reading.result,
    truth: reading.truth,
    confidence: measured ? "high": "unknown",
...(metricKey ? { metricKey, metricClass: metricClassOf(metricKey)! }: {}),
    outcomeStatus,
    measuredAt: at,
...(measured ? { observedAt: at }: {}),
    provenance: {
      appId: "conductor",
      actor: { type: "system", id: "conductor.outcome_observer", label: reading.because },
      observedAt: at,
      confidence: reading.truth === "observed" ? "observed": "inferred",
    },
  };
}
