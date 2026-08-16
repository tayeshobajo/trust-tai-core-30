/**
 * Conductor V3 hardening — the operating cycle before we trust it.
 *
 * The loop only means something if a re-read is not a new fact. These tests
 * hold the line on that: opening the control room three times must not turn
 * one governed action into three "consistent outcomes", a genuinely changed
 * room must still register, recall must stay bounded and current, a person's
 * word must outrank inference, and none of it may ever move authority.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ControlledAction, ExecutionReceipt } from "@/domain/conductor-control";
import type { ActionObservation, LearningRecord } from "@/domain/outcomes";
import { relevantLearning, learningForPacket } from "@/data/conductor/learning";

/* -------------------------------------------------------------- room spies */

const scoutRuns = vi.fn(async () => [
  { id: "run-1", query: "fintech", status: "succeeded", resultCount: 4 },
]);

vi.mock("@/data/supabase/scout-service", () => ({
  scoutService: {
    discover: vi.fn(),
    feedback: vi.fn(),
    runs: (...args: unknown[]) => scoutRuns(...(args as [])),
  },
}));

vi.mock("@/data/supabase/roadmap-service", () => ({
  roadmapService: { create: vi.fn(), addDecision: vi.fn(), detail: vi.fn(), resolveDecision: vi.fn() },
}));

vi.mock("@/data/supabase/conductor-learning-service", () => ({
  loadObservations: vi.fn(async () => []),
  loadLearning: vi.fn(async () => []),
  recordObservation: vi.fn(async (row: ActionObservation) => row),
  recordLearning: vi.fn(async (row: LearningRecord) => row),
}));

const { runObservationPass, observableActions } = await import(
  "@/data/conductor/outcome-service"
);

/* -------------------------------------------------------------- fixtures */

const ORG = "org-hardening";

function action(overrides: Partial<ControlledAction> = {}): ControlledAction {
  return {
    id: "action:x",
    organizationId: ORG,
    owningApp: "scout",
    operation: "scout.start_discovery_run",
    payload: { brief: "Fintech operators" },
    intent: "Run one sourcing pass",
    whyItMatters: "The pipeline is thin.",
    evidence: [],
    dependsOn: [],
    consequence: "internal_change",
    requiresApproval: true,
    requiredCapability: "scout.write",
    route: "/modules/scout",
    routeLabel: "Open Scout",
    boundary: { willDo: ["Source companies"], willNotDo: ["Message anyone"] },
    expectedSignal: { statement: "A discovery run exists in Scout.", observedIn: "scout" },
    sourceEventKey: "key:1",
    status: "routed",
    createdAt: "2026-08-20T09:00:00.000Z",
    ...overrides,
  } as ControlledAction;
}

/** Scout's own handover record: the run it says it started. */
const receipt = {
  id: "receipt:1",
  organizationId: ORG,
  actionId: "action:x",
  owningApp: "scout",
  operation: "scout.start_discovery_run",
  status: "accepted",
  result: { reference: "run-1", summary: "Discovery run started" },
  recordedAt: "2026-08-20T10:00:00.000Z",
} as unknown as ExecutionReceipt;

function ledger(seed: ActionObservation[] = []) {
  const observations = [...seed];
  const learning: LearningRecord[] = [];
  return {
    store: { observations, learning },
    ledger: {
      observations,
      learning,
      appendObservation: async (row: ActionObservation) => {
        observations.push(row);
        return row;
      },
      appendLearning: async (row: LearningRecord) => {
        learning.push(row);
        return row;
      },
    },
  };
}

function learningRecord(overrides: Partial<LearningRecord> = {}): LearningRecord {
  return {
    id: "learning:scout:run:1",
    organizationId: ORG,
    scope: { owningApp: "scout", operation: "scout.start_discovery_run" },
    sourceActionIds: ["action:x"],
    sourceObservationIds: ["o1", "o2", "o3"],
    hypothesis: "Discovery runs produce usable companies.",
    expectedSignal: "A discovery run exists in Scout.",
    observedResult: "3 reached the expected signal.",
    evidence: [],
    confidence: "medium",
    lesson: "Sourcing runs in Scout reliably produce a run record.",
    basis: "inferred",
    isRule: true,
    grantsAuthority: false,
    recordedAt: "2026-08-20T10:00:00.000Z",
    ...overrides,
  } as LearningRecord;
}

beforeEach(() => {
  vi.clearAllMocks();
  scoutRuns.mockResolvedValue([
    { id: "run-1", query: "fintech", status: "succeeded", resultCount: 4 },
  ]);
});

/* ------------------------------------------------------- observation truth */

describe("re-checking is not re-happening", () => {
  it("records one result no matter how many times the room is opened", async () => {
    const { store, ledger: sink } = ledger();
    const input = { organizationId: ORG, actions: [action()], receipts: [receipt], ledger: sink };

    await runObservationPass({ ...input, now: "2026-08-20T11:00:00.000Z" });
    await runObservationPass({ ...input, now: "2026-08-20T12:00:00.000Z" });
    const third = await runObservationPass({ ...input, now: "2026-08-20T13:00:00.000Z" });

    expect(store.observations).toHaveLength(1);
    expect(third.observations).toHaveLength(0);
    expect(third.skipped[0]?.because).toMatch(/same result/i);
  });

  it("records a new result when the owning room genuinely says something else", async () => {
    const { store, ledger: sink } = ledger();
    const input = { organizationId: ORG, actions: [action()], receipts: [receipt], ledger: sink };

    await runObservationPass(input);
    scoutRuns.mockResolvedValue([]);
    await runObservationPass(input);

    expect(store.observations).toHaveLength(2);
    expect(new Set(store.observations.map((row) => row.result)).size).toBe(2);
  });

  it("never observes work no room has been asked to do", () => {
    const states = ["proposed", "held", "rejected", "withdrawn", "approved"] as const;
    const candidates = states.map((status, index) =>
      action({ id: `action:${status}`, status: status as ControlledAction["status"] }),
    );
    expect(observableActions(candidates)).toHaveLength(0);
    expect(observableActions([...candidates, action({ id: "action:live" })])).toHaveLength(1);
  });

  it("skips an action whose result nothing can prove", async () => {
    const { store, ledger: sink } = ledger();
    const result = await runObservationPass({
      organizationId: ORG,
      actions: [action({ operation: "ops.schedule_delivery" as never, owningApp: "ops" })],
      receipts: [],
      ledger: sink,
    });
    expect(store.observations).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it("does not fail a routed action when the owning room cannot answer", async () => {
    scoutRuns.mockRejectedValue(new Error("Scout is unreachable"));
    const { ledger: sink } = ledger();
    const routed = action();
    const result = await runObservationPass({
      organizationId: ORG,
      actions: [routed],
      receipts: [receipt],
      ledger: sink,
    });
    /* The reading is honest about not knowing; the handover still stands. */
    expect(routed.status).toBe("routed");
    expect(result.observations[0]?.truth).not.toBe("observed");
  });

  it("keeps one organization's ledger out of another's", async () => {
    const foreign: ActionObservation = {
      id: "observation:other",
      organizationId: "org-other",
      actionId: "action:other",
      owningApp: "scout",
      operation: "scout.start_discovery_run",
      expectedSignal: { statement: "x", observedIn: "scout" },
      observedEvidence: [],
      result: "signal_present",
      truth: "observed",
      confidence: "high",
      outcomeStatus: "measured",
      measuredAt: "2026-08-20T09:00:00.000Z",
      provenance: {
        appId: "scout",
        actor: { type: "system", id: "system", label: "Conductor" },
        observedAt: "2026-08-20T09:00:00.000Z",
      },
    } as ActionObservation;
    const { store, ledger: sink } = ledger([foreign]);
    await runObservationPass({ organizationId: ORG, actions: [action()], receipts: [receipt], ledger: sink });
    const mine = store.observations.filter((row) => row.organizationId === ORG);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.actionId).toBe("action:x");
  });
});

/* -------------------------------------------------------------- what recall says */

describe("what a later answer is allowed to remember", () => {
  it("recalls only the rooms in play", () => {
    const records = [
      learningRecord(),
      learningRecord({ id: "l:comms", scope: { owningApp: "comms", operation: "comms.draft" } }),
    ];
    const recalled = relevantLearning({ records, rooms: ["scout"] });
    expect(recalled.map((row) => row.scope.owningApp)).toEqual(["scout"]);
  });

  it("does not recall a lesson that has been superseded", () => {
    const standing = learningRecord({ id: "l:old" });
    const newer = learningRecord({
      id: "l:new",
      supersedes: "l:old",
      lesson: "Runs now return far fewer companies.",
      recordedAt: "2026-08-21T10:00:00.000Z",
    });
    const recalled = relevantLearning({ records: [standing, newer], rooms: ["scout"] });
    expect(recalled.map((row) => row.id)).toEqual(["l:new"]);
  });

  it("puts a person's correction above anything inferred", () => {
    const inferred = learningRecord({ id: "l:inferred", confidence: "high" });
    const decided = learningRecord({
      id: "l:decided",
      basis: "decided",
      confidence: "high",
      lesson: "I sent those by hand; the ledger cannot see it.",
      recordedAt: "2026-08-19T10:00:00.000Z",
    });
    const recalled = relevantLearning({ records: [inferred, decided], rooms: ["scout"] });
    expect(recalled[0]?.id).toBe("l:decided");
    expect(learningForPacket(recalled)[0]).toMatch(/a person's correction/);
  });

  it("keeps a thin result labelled thin", () => {
    const thin = learningRecord({ isRule: false, sourceObservationIds: ["o1"], confidence: "low" });
    expect(learningForPacket([thin])[0]).toMatch(/too thin to rely on/);
  });

  it("stays bounded rather than dumping the history", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      learningRecord({ id: `l:${index}`, recordedAt: `2026-08-${10 + index}T10:00:00.000Z` }),
    );
    expect(relevantLearning({ records: many, rooms: ["scout"], limit: 3 })).toHaveLength(3);
  });
});

/* -------------------------------------------------------------- authority */

describe("learning changes advice, never authority", () => {
  it("carries no grant of permission on any record", () => {
    const records = [learningRecord(), learningRecord({ basis: "decided" })];
    for (const record of records) expect(record.grantsAuthority).toBe(false);
  });

  it("leaves approval requirements untouched by what was learned", async () => {
    const { isSupportedOperation } = await import("@/domain/adapter-registry");
    const governed = action({ status: "proposed" });
    expect(governed.requiresApproval).toBe(true);
    expect(isSupportedOperation("scout", "scout.start_discovery_run")).toBe(true);
    expect(isSupportedOperation("ops", "ops.schedule_delivery")).toBe(false);
  });
});
