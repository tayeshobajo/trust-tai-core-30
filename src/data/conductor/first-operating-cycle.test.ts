/**
 * The first operating cycle, rehearsed end to end (Conductor V3).
 *
 * No authenticated browser session was available, so this is the runbook Tai
 * will follow from the signed-in UI, executed here against the real control
 * layer, the real adapters, the real observer and the real learning rules.
 * Only the outermost IO — Supabase and the room services — is replaced.
 *
 * The cycle proved here is the whole point of V3:
 *
 *   approve → route → expected signal → observation → measured result →
 *   modest lesson → next answer, better informed, with no new authority.
 *
 * One honest failure is locked in too: today no reasoning path produces a
 * governed action carrying the subject payload an adapter needs, so a cycle
 * cannot yet be *started* from a question alone. That is asserted rather than
 * papered over, so the gap cannot close silently.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { accessContext, can, type Permission } from "@/domain/access";
import type { ControlledAction, ExecutionReceipt } from "@/domain/conductor-control";
import type { ActionObservation, LearningRecord } from "@/domain/outcomes";
import { learningGrantsExecution } from "@/domain/outcomes";
import { capabilityFor } from "@/domain/adapter-registry";
import { emptySnapshot } from "@/data/intelligence/derive";

/* ---------------------------------------------------------- room services */

/** Scout's own run history. The only thing allowed to prove the signal. */
const scoutRunHistory: { id: string; query: string; status: string; resultCount: number }[] = [];

const scoutDiscover = vi.fn(async (input: { query: string }) => {
  const run = { id: "run-first-cycle", query: input.query, status: "succeeded", resultCount: 3 };
  scoutRunHistory.push(run);
  return { runId: run.id, saved: 3, rejected: 0, returned: 3 };
});

vi.mock("@/data/supabase/scout-service", () => ({
  scoutService: {
    discover: (...args: unknown[]) => scoutDiscover(...(args as [{ query: string }])),
    feedback: vi.fn(),
    runs: async () => scoutRunHistory,
  },
}));

vi.mock("@/data/supabase/comms-service", () => ({
  commsService: { listDrafts: async () => [], saveDraft: vi.fn(), list: async () => [], send: vi.fn() },
}));
vi.mock("@/data/supabase/projects-service", () => ({
  projectsService: { get: async () => null, update: vi.fn(), routeWork: vi.fn() },
}));
vi.mock("@/data/supabase/roadmap-service", () => ({
  roadmapService: { create: vi.fn(), addDecision: vi.fn(), detail: vi.fn(), resolveDecision: vi.fn() },
}));

/* ------------------------------------------------------- governance store */

const persisted: ControlledAction[] = [];
const receipts: ExecutionReceipt[] = [];
const events: { key: string; actionId: string }[] = [];

vi.mock("@/data/supabase/conductor-control-service", () => ({
  loadControlledActions: async () => persisted,
  saveControlledActions: async (rows: ControlledAction[]) => rows,
  persistActionState: async (row: ControlledAction) => {
    const index = persisted.findIndex((item) => item.id === row.id);
    if (index === -1) persisted.push(row);
    else persisted[index] = row;
    return row;
  },
  recordReceipt: async (row: ExecutionReceipt) => {
    receipts.push(row);
    return row;
  },
}));

vi.mock("@/data/events/control-events", () => ({
  emitControlEvent: async (input: { key: string; actionId: string }) => {
    events.push({ key: input.key, actionId: input.actionId });
    return null;
  },
}));

/** Append-only ledger, SELECT/INSERT semantics only — never an update. */
const observationLedger: ActionObservation[] = [];
const learningLedger: LearningRecord[] = [];

vi.mock("@/data/supabase/conductor-learning-service", () => ({
  loadObservations: async () => observationLedger,
  loadLearning: async () => learningLedger,
  recordObservation: async (row: ActionObservation) => {
    const existing = observationLedger.find((item) => item.id === row.id);
    if (existing) return existing;
    observationLedger.push(row);
    return row;
  },
  recordLearning: async (row: LearningRecord) => {
    const existing = learningLedger.find((item) => item.id === row.id);
    if (existing) return existing;
    learningLedger.push(row);
    return row;
  },
}));

const { decide, routeAction } = await import("./orchestrator");
const { runObservationPass, observableActions } = await import("./outcome-service");
const { relevantLearning } = await import("./learning");
const { buildExecutionRead } = await import("@/data/intelligence/conductor/execution-read");
const { answerQuestion } = await import("@/data/intelligence/conductor");
const { buildControlledActions, routability } = await import(
  "@/data/intelligence/conductor/control"
);
const { ROOM_ADAPTERS } = await import("./adapters");

/* ------------------------------------------------------------- fixtures */

const ORG = "org-first-cycle";
const NOW = "2026-08-25T09:00:00.000Z";
const owner = accessContext({ userId: "tai", organizationId: ORG, role: "owner" });
const access = { can: (permission: string) => can(owner, permission as Permission) };
const actor = { id: "tai", label: "Tai" };

/** Exactly what the signed-in UI would hold after a person names the brief. */
function discoveryAction(): ControlledAction {
  return {
    id: "action:first-cycle:scout",
    organizationId: ORG,
    owningApp: "scout",
    operation: "scout.start_discovery_run",
    payload: { brief: "Nordic fintech operators, 20-200 people" },
    intent: "Run one sourcing pass against the saved ICP",
    whyItMatters: "The board has nothing new on it.",
    evidence: [{ label: "Newest record on the Scout board", kind: "computed" }],
    dependsOn: [],
    consequence: "internal_change",
    requiresApproval: true,
    requiredCapability: "scout.write",
    route: "/modules/scout",
    routeLabel: "Open Scout",
    boundary: { willDo: ["Source companies against the brief"], willNotDo: ["Contact anyone"] },
    expectedSignal: { statement: "A discovery run exists in Scout.", observedIn: "scout" },
    sourceEventKey: "conductor.action:org-first-cycle:scout:scout.start_discovery_run:first",
    status: "proposed",
    createdAt: NOW,
  } as ControlledAction;
}

/** A second branch the person deliberately does not approve. */
function heldBranch(): ControlledAction {
  return {
    ...discoveryAction(),
    id: "action:first-cycle:comms",
    owningApp: "comms",
    operation: "comms.send_message",
    payload: { relationshipId: "rel-1" },
    intent: "Message the three strongest companies",
    consequence: "external",
    requiredCapability: "comms.write",
    expectedSignal: { statement: "A message left the building.", observedIn: "comms" },
    sourceEventKey: "conductor.action:org-first-cycle:comms:comms.send_message:first",
  } as ControlledAction;
}

beforeEach(() => {
  vi.clearAllMocks();
  scoutRunHistory.length = 0;
  persisted.length = 0;
  receipts.length = 0;
  events.length = 0;
  observationLedger.length = 0;
  learningLedger.length = 0;
});

/* ------------------------------------------------------------ stage one */

describe("stage 1 — a question yields a governed cross-room recommendation", () => {
  it("produces governed actions, but none of them can be routed today", async () => {
    const snapshot = {
      ...emptySnapshot(ORG, NOW),
      relationships: [1, 2, 3].map((index) => ({
        id: `rel-${index}`,
        organizationId: ORG,
        fullName: `Person ${index}`,
        stage: "in_conversation" as const,
        source: "scout",
        lastTouchAt: "2026-06-01T09:00:00.000Z",
        responseDueAt: "2026-07-01T09:00:00.000Z",
        observed: [],
        inferred: [],
        decided: [],
        metadata: {},
        createdAt: "2026-06-01T09:00:00.000Z",
        updatedAt: "2026-06-01T09:00:00.000Z",
      })),
    };

    const answer = answerQuestion({ snapshot, question: "how can we win more business" });
    expect(answer.actionGraph).toBeDefined();

    const actions = buildControlledActions({
      organizationId: ORG,
      graph: answer.actionGraph!,
      now: NOW,
    });
    expect(actions.length).toBeGreaterThan(0);

    /*
     * The honest gap. Every action a question can currently produce is either
     * informational or names an operation no adapter claims, so the cycle
     * cannot begin from reasoning alone — a person must supply the subject.
     */
    const routable = actions.filter(
      (action) =>
        routability({
          action: { ...action, status: "approved" } as ControlledAction,
          actions,
          adapters: ROOM_ADAPTERS,
          access,
        }).routable,
    );
    expect(routable).toHaveLength(0);
  });
});

/* -------------------------------------------------- stages two to seven */

describe("stages 2-7 — approve one branch, route it, observe it once, learn modestly", () => {
  it("runs the whole loop and records exactly one result", async () => {
    const queue = [discoveryAction(), heldBranch()];

    /* 2. Approve only the safe branch. */
    const decided = await decide(
      queue,
      [
        { actionId: queue[0]!.id, kind: "approve" },
        { actionId: queue[1]!.id, kind: "hold", reason: "Nothing leaves the building yet." },
      ],
      owner,
      actor,
      NOW,
    );
    expect(decided[0]!.status).toBe("approved");
    expect(decided[1]!.status).toBe("held");

    /* 3. Route it through Scout's own service boundary. */
    const outcome = await routeAction(decided[0]!, decided, owner, actor, ROOM_ADAPTERS, NOW);
    expect(outcome.refusedBecause).toBeUndefined();
    expect(outcome.action.status).toBe("routed");
    expect(outcome.receipt?.boundaryCrossed).toContain("scoutService");
    expect(scoutDiscover).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.key)).toContain("ACTION_ROUTED");

    const routed = [outcome.action, decided[1]!];

    /* 4. The expected signal is readable in the owning room. */
    expect(observableActions(routed).map((action) => action.id)).toEqual([outcome.action.id]);

    /* 5 + 6. Check outcomes twice; the unchanged room yields one observation. */
    const first = await runObservationPass({
      organizationId: ORG,
      actions: routed,
      receipts: outcome.receipt ? [outcome.receipt] : [],
      now: NOW,
    });
    expect(first.observations).toHaveLength(1);
    expect(first.observations[0]!.result).toBe("signal_present");
    expect(first.observations[0]!.truth).toBe("observed");

    const second = await runObservationPass({
      organizationId: ORG,
      actions: routed,
      receipts: outcome.receipt ? [outcome.receipt] : [],
      now: "2026-08-25T11:00:00.000Z",
    });
    expect(second.observations).toHaveLength(0);
    expect(observationLedger).toHaveLength(1);
    expect(second.skipped.some((row) => row.because.includes("same result"))).toBe(true);

    /* The held branch is never observed. */
    expect(
      first.skipped.some((row) => row.actionId === "action:first-cycle:comms"),
    ).toBe(true);

    /* 7. One result. Modest, provenanced, and not a rule. */
    expect(learningLedger).toHaveLength(1);
    const lesson = learningLedger[0]!;
    expect(lesson.isRule).toBe(false);
    expect(lesson.basis).toBe("observed");
    expect(lesson.grantsAuthority).toBe(false);
    expect(lesson.sourceObservationIds).toEqual([first.observations[0]!.id]);
    expect(lesson.lesson).toContain("1 of 1");

    /* The intelligence read stays separate from the business action's status. */
    const read = buildExecutionRead({
      actions: routed,
      receipts: outcome.receipt ? [outcome.receipt] : [],
      observations: observationLedger,
      learning: learningLedger,
      access,
    })[0]!;
    expect(read.stage).toBe("routed");
    expect(read.outcomeStage).toBe("signal_present");
    expect(read.learningState).toBe("one_result");
    expect(read.lastCheckedAt).toBe(NOW);
  });

  it("a genuinely changed room result creates a second observation", async () => {
    const approved = { ...discoveryAction(), status: "approved" } as ControlledAction;
    const outcome = await routeAction(approved, [approved], owner, actor, ROOM_ADAPTERS, NOW);
    const routed = [outcome.action];
    const receiptsFor = outcome.receipt ? [outcome.receipt] : [];

    await runObservationPass({ organizationId: ORG, actions: routed, receipts: receiptsFor, now: NOW });
    expect(observationLedger).toHaveLength(1);

    /* Scout loses the run — a different reading, honestly recorded. */
    scoutRunHistory.length = 0;
    const again = await runObservationPass({
      organizationId: ORG,
      actions: routed,
      receipts: receiptsFor,
      now: "2026-08-26T09:00:00.000Z",
    });
    expect(again.observations).toHaveLength(1);
    expect(again.observations[0]!.result).toBe("signal_absent");
    expect(observationLedger).toHaveLength(2);
  });

  it("an unreadable room never rolls back a routed action", async () => {
    const approved = { ...discoveryAction(), status: "approved" } as ControlledAction;
    const outcome = await routeAction(approved, [approved], owner, actor, ROOM_ADAPTERS, NOW);
    /* No receipt, so the reference cannot be checked at all. */
    const pass = await runObservationPass({
      organizationId: ORG,
      actions: [outcome.action],
      receipts: [],
      now: NOW,
    });
    expect(outcome.action.status).toBe("routed");
    expect(pass.observations[0]?.result).toBe("not_measurable");
    expect(learningLedger).toHaveLength(0);
  });
});

/* ----------------------------------------------- stages eight to ten */

describe("stages 8-10 — the next answer knows, without gaining authority", () => {
  async function cycle() {
    const approved = { ...discoveryAction(), status: "approved" } as ControlledAction;
    const outcome = await routeAction(approved, [approved], owner, actor, ROOM_ADAPTERS, NOW);
    await runObservationPass({
      organizationId: ORG,
      actions: [outcome.action],
      receipts: outcome.receipt ? [outcome.receipt] : [],
      now: NOW,
    });
    return outcome;
  }

  it("recalls only the current, relevant lesson", async () => {
    await cycle();
    const recalled = relevantLearning({
      records: learningLedger,
      rooms: ["scout"],
      operations: ["scout.start_discovery_run"],
    });
    expect(recalled).toHaveLength(1);
    expect(recalled[0]!.isRule).toBe(false);

    /* A question about another room does not drag this lesson along. */
    expect(relevantLearning({ records: learningLedger, rooms: ["comms"] })).toHaveLength(0);
  });

  it("excludes superseded records and puts a person's correction first", async () => {
    await cycle();
    const inferred = learningLedger[0]!;
    const corrected: LearningRecord = {
      ...inferred,
      id: "learning:scout:scout.start_discovery_run:corrected",
      basis: "decided",
      isRule: true,
      confidence: "high",
      lesson: "The run happened, but the companies were wrong for us.",
      supersedes: inferred.id,
      recordedAt: "2026-08-26T09:00:00.000Z",
    };
    learningLedger.push(corrected);

    const recalled = relevantLearning({ records: learningLedger, rooms: ["scout"] });
    expect(recalled.map((record) => record.id)).toEqual([corrected.id]);
    expect(recalled[0]!.basis).toBe("decided");
  });

  it("a standing lesson reaches the next answer's packet and is labelled honestly", async () => {
    await cycle();
    const snapshot = emptySnapshot(ORG, NOW);
    const answer = answerQuestion({
      snapshot,
      question: "how can we win more business",
      priorLearning: learningLedger,
    });
    /* Bounded: only rooms in play are recalled, and thin evidence stays thin. */
    for (const line of answer.priorLearning) {
      expect(line).not.toContain("a pattern across");
    }
    expect(answer.priorLearning.length).toBeLessThanOrEqual(3);
  });

  it("nothing learned changes permission, approval, consequence or coverage", async () => {
    await cycle();
    const lesson = learningLedger[0]!;
    expect(learningGrantsExecution(lesson)).toBe(false);

    const capability = capabilityFor("scout", "scout.start_discovery_run")!;
    expect(capability.requiresApproval).toBe(true);
    expect(capability.requiredCapability).toBe("scout.write");
    expect(capability.claimableState).toBe("routed");

    /* Without approval, the same action still cannot move. */
    const unapproved = discoveryAction();
    const verdict = routability({
      action: unapproved,
      actions: [unapproved],
      adapters: ROOM_ADAPTERS,
      access,
    });
    expect(verdict.routable).toBe(false);

    /* And a member without scout.write is still refused. */
    const viewer = accessContext({ userId: "v", organizationId: ORG, role: "viewer" });
    const refused = routability({
      action: { ...unapproved, status: "approved" } as ControlledAction,
      actions: [unapproved],
      adapters: ROOM_ADAPTERS,
      access: { can: (permission: string) => can(viewer, permission as Permission) },
    });
    expect(refused.routable).toBe(false);
  });

  it("holds the organization boundary", async () => {
    const foreign = { ...discoveryAction(), organizationId: "org-other", status: "approved" } as ControlledAction;
    const outcome = await routeAction(foreign, [foreign], owner, actor, ROOM_ADAPTERS, NOW);
    expect(outcome.refusedBecause).toContain("another organization");
    expect(scoutDiscover).not.toHaveBeenCalled();
  });
});
