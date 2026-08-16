/**
 * Conductor V3 verification — factory execution coverage and learning.
 *
 * Two things are proved here.
 *
 * 1. Execution coverage is real and bounded: the Scout and Roadmap adapters
 *    cross only their own room's service, unsupported operations stay
 *    non-routable, and approval is still required for anything consequential.
 * 2. The outcome loop is honest: measurements come from the owning room's own
 *    record, one result never becomes a rule, contradictory evidence lowers
 *    confidence, a person's correction outranks inference, and no lesson ever
 *    grants permission.
 *
 * Only the outermost IO is replaced — the real adapters, real registry and
 * real learning rules run.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { accessContext, can, type Permission } from "@/domain/access";
import type { ControlledAction, ExecutionReceipt } from "@/domain/conductor-control";
import type { ActionObservation, LearningRecord } from "@/domain/outcomes";
import {
  ADAPTER_CAPABILITIES,
  capabilityFor,
  isSupportedOperation,
} from "@/domain/adapter-registry";
import { learningGrantsExecution, metricClassOf } from "@/domain/outcomes";

/* -------------------------------------------------------------- room spies */

const scoutDiscover = vi.fn(async (..._args: any[]) => ({ runId: "run-1", saved: 4, rejected: 1, returned: 5 }));
const scoutFeedback = vi.fn(async (..._args: any[]) => undefined);
const scoutRuns = vi.fn(async () => [
  { id: "run-1", query: "fintech", status: "succeeded", resultCount: 4 },
]);

vi.mock("@/data/supabase/scout-service", () => ({
  scoutService: {
    discover: (...args: unknown[]) => scoutDiscover(...args),
    feedback: (...args: unknown[]) => scoutFeedback(...args),
    runs: (...args: unknown[]) => scoutRuns(...(args as [])),
  },
}));

const roadmapCreate = vi.fn(async () => ({ roadmap: { id: "rm-1", title: "Acme" } }));
const roadmapAddDecision = vi.fn(async () => ({ id: "dec-1" }));
const roadmapDetail = vi.fn(async () => ({
  roadmap: { id: "rm-1", title: "Acme" },
  decisions: [{ id: "dec-1", question: "Which sequence?" }],
}));
const roadmapResolve = vi.fn();

vi.mock("@/data/supabase/roadmap-service", () => ({
  roadmapService: {
    create: (...args: unknown[]) => roadmapCreate(...(args as [])),
    addDecision: (...args: unknown[]) => roadmapAddDecision(...(args as [])),
    detail: (...args: unknown[]) => roadmapDetail(...(args as [])),
    resolveDecision: (...args: unknown[]) => roadmapResolve(...(args as [])),
  },
}));

const commsListDrafts = vi.fn(async () => [{ id: "draft-1" }]);
vi.mock("@/data/supabase/comms-service", () => ({
  commsService: {
    listDrafts: (...args: unknown[]) => commsListDrafts(...(args as [])),
    saveDraft: vi.fn(),
    list: vi.fn(async () => []),
    send: vi.fn(),
  },
}));

const projectGet = vi.fn(async () => ({
  id: "proj-1",
  name: "Delivery",
  blockedBecause: "Waiting on Ana",
}));
vi.mock("@/data/supabase/projects-service", () => ({
  projectsService: {
    get: (...args: unknown[]) => projectGet(...(args as [])),
    update: vi.fn(),
    routeWork: vi.fn(),
  },
}));

vi.mock("@/data/supabase/conductor-learning-service", () => ({
  loadObservations: async () => [],
  loadLearning: async () => [],
  recordObservation: async (row: ActionObservation) => row,
  recordLearning: async (row: LearningRecord) => row,
}));

const { SCOUT_ADAPTERS } = await import("./adapters-scout");
const { ROADMAP_ADAPTERS } = await import("./adapters-roadmap");
const { ROOM_ADAPTERS, operationGap } = await import("./adapters");
const { observeAction, canObserve } = await import("./outcome-observer");
const { runObservationPass } = await import("./outcome-service");
const { distillLearning, relevantLearning, confidenceFor, phraseLesson } = await import(
  "./learning"
);

/* -------------------------------------------------------------- fixtures */

const ORG = "org-v3";
const NOW = "2026-08-20T09:00:00.000Z";
const owner = accessContext({ userId: "u1", organizationId: ORG, role: "owner" });
const access = { can: (permission: string) => can(owner, permission as Permission) };
const context = {
  organizationId: ORG,
  actor: { id: "u1", label: "Tai" },
  approvedBy: { id: "u1", label: "Tai" },
  now: NOW,
};

function action(overrides: Partial<ControlledAction>): ControlledAction {
  return {
    id: "action:x",
    organizationId: ORG,
    owningApp: "scout",
    operation: "scout.start_discovery_run",
    payload: { brief: "Fintech operators in the Nordics" },
    intent: "Run one sourcing pass",
    whyItMatters: "The pipeline is thin.",
    evidence: [{ label: "Observed in Scout", kind: "computed" }],
    dependsOn: [],
    consequence: "internal_change",
    requiresApproval: true,
    requiredCapability: "scout.write",
    route: "/modules/scout",
    routeLabel: "Open Scout",
    boundary: { willDo: ["Source companies"], willNotDo: ["Message anyone"] },
    expectedSignal: { statement: "A discovery run exists in Scout.", observedIn: "scout" },
    sourceEventKey: "conductor.action:org-v3:scout:scout.start_discovery_run:brief",
    status: "approved",
    createdAt: NOW,
    ...overrides,
  } as ControlledAction;
}

function observation(overrides: Partial<ActionObservation>): ActionObservation {
  return {
    id: `observation:${Math.random()}`,
    organizationId: ORG,
    actionId: "action:x",
    owningApp: "scout",
    operation: "scout.start_discovery_run",
    expectedSignal: { statement: "A discovery run exists in Scout.", observedIn: "scout" },
    observedEvidence: [{ label: "Scout run 1", kind: "computed" }],
    result: "signal_present",
    truth: "observed",
    confidence: "high",
    outcomeStatus: "measured",
    measuredAt: NOW,
    provenance: { appId: "conductor", actor: { type: "system", id: "obs" }, observedAt: NOW },
    ...overrides,
  } as ActionObservation;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ------------------------------------------------------ execution coverage */

describe("Scout execution adapters", () => {
  it("routes a discovery run through Scout's own service and nothing else", async () => {
    const [discovery] = SCOUT_ADAPTERS;
    const receipt = await discovery!.route(action({}), context);

    expect(scoutDiscover).toHaveBeenCalledTimes(1);
    expect(scoutDiscover.mock.calls[0]![0]).toMatchObject({
      organizationId: ORG,
      query: "Fintech operators in the Nordics",
    });
    /* Not one other room was touched. */
    expect(roadmapCreate).not.toHaveBeenCalled();
    expect(scoutFeedback).not.toHaveBeenCalled();
    expect(receipt.status).toBe("routed");
    expect(receipt.resultingState).toBe("routed");
    expect(receipt.result?.reference).toBe("run-1");
    expect(receipt.boundaryCrossed).toContain("scoutService.discover");
  });

  it("records a human fit correction as calibration, never as an ICP rewrite", async () => {
    const [, feedback] = SCOUT_ADAPTERS;
    const receipt = await feedback!.route(
      action({
        operation: "scout.record_fit_correction",
        payload: { prospectId: "pros-1", humanFit: "red", reason: "Wrong segment" },
      }),
      context,
    );
    expect(scoutFeedback).toHaveBeenCalledTimes(1);
    expect(scoutFeedback.mock.calls[0]![0]).toMatchObject({
      prospectId: "pros-1",
      decision: "fit_override",
      humanFit: "red",
    });
    expect(scoutDiscover).not.toHaveBeenCalled();
    expect(receipt.status).toBe("routed");
  });

  it("refuses a discovery run with no approved brief", async () => {
    const [discovery] = SCOUT_ADAPTERS;
    const bare = action({ payload: {} });
    expect(discovery!.canRoute(bare, access).routable).toBe(false);
    const receipt = await discovery!.route(bare, context);
    expect(scoutDiscover).not.toHaveBeenCalled();
    expect(receipt.status).toBe("refused");
    expect(receipt.resultingState).toBe("approved");
  });
});

describe("Roadmap execution adapters", () => {
  it("creates a draft shell through roadmapService.create only", async () => {
    const [shell] = ROADMAP_ADAPTERS;
    const receipt = await shell!.route(
      action({
        owningApp: "roadmap",
        operation: "roadmap.create_shell",
        requiredCapability: "roadmap.write",
        payload: { subjectKind: "client", subjectId: "cl-1", objective: "Grow the account" },
      }),
      context,
    );
    expect(roadmapCreate).toHaveBeenCalledTimes(1);
    expect(roadmapResolve).not.toHaveBeenCalled();
    expect(receipt.result?.reference).toBe("rm-1");
  });

  it("raises an open question and never records an answer", async () => {
    const [, decision] = ROADMAP_ADAPTERS;
    const receipt = await decision!.route(
      action({
        owningApp: "roadmap",
        operation: "roadmap.request_decision",
        requiredCapability: "roadmap.write",
        payload: { roadmapId: "rm-1", question: "Which sequence?", whyItMatters: "Timing." },
      }),
      context,
    );
    expect(roadmapAddDecision).toHaveBeenCalledTimes(1);
    expect(roadmapResolve).not.toHaveBeenCalled();
    expect(receipt.result?.reference).toBe("dec-1");
    expect(receipt.boundaryCrossed).toContain("never an answer");
  });
});

describe("the capability registry", () => {
  it("keeps consequential Scout and Roadmap work behind approval", () => {
    for (const operation of [
      "scout.start_discovery_run",
      "scout.record_fit_correction",
      "roadmap.create_shell",
      "roadmap.request_decision",
    ]) {
      const capability = ADAPTER_CAPABILITIES.find((row) => row.operation === operation)!;
      expect(capability.supported).toBe(true);
      expect(capability.requiresApproval).toBe(true);
      /* Routing is not completion: no adapter may claim more than routed. */
      expect(capability.claimableState).toBe("routed");
    }
  });

  it("names every unsupported operation and why, and no adapter claims it", () => {
    for (const capability of ADAPTER_CAPABILITIES.filter((row) => !row.supported)) {
      expect(capability.because).toBeTruthy();
      expect(capability.adapterId).toBeUndefined();
      const claimant = ROOM_ADAPTERS.find((adapter) => adapter.supports(capability.operation));
      expect(claimant).toBeUndefined();
    }
  });

  it("leaves decided Roadmap truth and outbound Scout contact non-routable", () => {
    expect(isSupportedOperation("roadmap", "roadmap.resolve_decision")).toBe(false);
    expect(isSupportedOperation("roadmap", "roadmap.change_sequencing")).toBe(false);
    expect(isSupportedOperation("scout", "scout.contact_prospect")).toBe(false);
    expect(operationGap("scout", "scout.contact_prospect")).toContain("never messages");
  });

  it("declares an adapter for every supported row", () => {
    for (const capability of ADAPTER_CAPABILITIES.filter((row) => row.supported)) {
      expect(ROOM_ADAPTERS.some((adapter) => adapter.id === capability.adapterId)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------ observation */

describe("signal observation", () => {
  it("reads a Scout run from Scout's own history and links back to the action", async () => {
    const routed = action({ status: "routed", routedAt: NOW, recommendationId: "rec-9" });
    const receipt = { result: { reference: "run-1" } } as ExecutionReceipt;
    const result = await observeAction({
      action: routed,
      receipt,
      organizationId: ORG,
      now: NOW,
    });
    expect(result.result).toBe("signal_present");
    expect(result.truth).toBe("observed");
    expect(result.actionId).toBe(routed.id);
    expect(result.recommendationId).toBe("rec-9");
    expect(result.observedEvidence.length).toBeGreaterThan(0);
  });

  it("fabricates nothing when the owning room cannot prove the signal", async () => {
    const unmeasurable = action({
      owningApp: "studio",
      operation: "studio.publish",
      status: "routed",
    });
    expect(canObserve("studio.publish")).toBe(false);
    const result = await observeAction({ action: unmeasurable, organizationId: ORG, now: NOW });
    expect(result.result).toBe("not_measurable");
    expect(result.confidence).toBe("unknown");
    expect(result.outcomeStatus).toBe("inconclusive");
    expect(result.observedEvidence).toHaveLength(0);
  });

  it("reports an absent signal rather than guessing, when the room is readable", async () => {
    commsListDrafts.mockResolvedValueOnce([]);
    const result = await observeAction({
      action: action({
        owningApp: "comms",
        operation: "comms.draft_reply",
        status: "routed",
        payload: { relationshipId: "rel-1", body: "hi" },
      }),
      receipt: { result: { reference: "draft-1" } } as ExecutionReceipt,
      organizationId: ORG,
      now: NOW,
    });
    expect(result.result).toBe("signal_absent");
    expect(result.truth).toBe("observed");
  });

  it("observes nothing for an action that was never routed", async () => {
    const pass = await runObservationPass({
      organizationId: ORG,
      actions: [action({ status: "held" })],
      receipts: [],
      now: NOW,
      ledger: {
        observations: [],
        learning: [],
        appendObservation: async (row) => row,
        appendLearning: async (row) => row,
      },
    });
    expect(pass.observations).toHaveLength(0);
    expect(pass.skipped[0]!.because).toContain("nothing to observe");
    expect(scoutRuns).not.toHaveBeenCalled();
  });

  it("keeps organizations apart: another org's action reads its own room", async () => {
    const other = await runObservationPass({
      organizationId: "org-other",
      actions: [action({ organizationId: "org-other", status: "routed" })],
      receipts: [{ actionId: "action:x", result: { reference: "run-1" } } as ExecutionReceipt],
      now: NOW,
      ledger: {
        observations: [],
        learning: [],
        appendObservation: async (row) => row,
        appendLearning: async (row) => row,
      },
    });
    expect(scoutRuns).toHaveBeenCalledWith("org-other");
    expect(other.observations[0]!.organizationId).toBe("org-other");
  });
});

/* -------------------------------------------------------------- learning */

describe("learning rules", () => {
  const scope = { owningApp: "scout", operation: "scout.start_discovery_run" };

  it("treats one result as an observation, never a rule", () => {
    const record = distillLearning({
      organizationId: ORG,
      scope,
      scopeLabel: "Scout discovery",
      observations: [observation({})],
      now: NOW,
    })!;
    expect(record.isRule).toBe(false);
    expect(record.confidence).toBe("low");
    expect(record.lesson).toContain("Observed alongside, not shown to be the cause");
  });

  it("raises confidence once the same result repeats past the threshold", () => {
    const three = [observation({}), observation({}), observation({})];
    const record = distillLearning({
      organizationId: ORG,
      scope,
      scopeLabel: "Scout discovery",
      observations: three,
      now: NOW,
    })!;
    expect(record.isRule).toBe(true);
    expect(record.confidence).toBe("moderate");
    expect(confidenceFor({ consistent: 5, contradicting: 0 })).toBe("high");
  });

  it("lowers confidence when the evidence contradicts itself", () => {
    const mixed = [
      observation({}),
      observation({}),
      observation({ result: "signal_absent" }),
      observation({ result: "signal_absent" }),
    ];
    const record = distillLearning({
      organizationId: ORG,
      scope,
      scopeLabel: "Scout discovery",
      observations: mixed,
      now: NOW,
    })!;
    expect(record.isRule).toBe(false);
    expect(record.confidence).toBe("low");
    expect(record.lesson).toContain("mixed results");
  });

  it("lets a person's correction outrank and supersede an inferred lesson", () => {
    const inferred = distillLearning({
      organizationId: ORG,
      scope,
      scopeLabel: "Scout discovery",
      observations: [observation({}), observation({}), observation({})],
      now: NOW,
    })!;
    const corrected = distillLearning({
      organizationId: ORG,
      scope,
      scopeLabel: "Scout discovery",
      observations: [observation({})],
      prior: inferred,
      humanCorrection: {
        statement: "These runs look productive but none reach a real conversation.",
        by: "Tai",
        at: NOW,
      },
      now: "2026-08-21T09:00:00.000Z",
    })!;
    expect(corrected.basis).toBe("decided");
    expect(corrected.supersedes).toBe(inferred.id);

    /* And inference does not overturn it afterwards. */
    const after = distillLearning({
      organizationId: ORG,
      scope,
      scopeLabel: "Scout discovery",
      observations: [observation({}), observation({}), observation({})],
      prior: corrected,
      now: "2026-08-22T09:00:00.000Z",
    });
    expect(after).toBeUndefined();
  });

  it("never claims causality without causal evidence", () => {
    const phrasing = phraseLesson({
      scopeLabel: "Scout discovery",
      consistent: 3,
      contradicting: 0,
      outcome: "present",
      causal: false,
    });
    expect(phrasing).toContain("not shown to be the cause");
  });

  it("grants no authority, ever", () => {
    const record = distillLearning({
      organizationId: ORG,
      scope,
      scopeLabel: "Scout discovery",
      observations: [observation({}), observation({}), observation({})],
      now: NOW,
    })!;
    expect(record.grantsAuthority).toBe(false);
    expect(learningGrantsExecution(record)).toBe(false);
    /* A learned rule cannot make an unsupported operation routable. */
    expect(isSupportedOperation("scout", "scout.contact_prospect")).toBe(false);
    expect(capabilityFor("scout", "scout.start_discovery_run")!.requiresApproval).toBe(true);
  });

  it("recalls only relevant lessons, not the whole history", () => {
    const records: LearningRecord[] = [
      {
        ...(distillLearning({
          organizationId: ORG,
          scope,
          scopeLabel: "Scout discovery",
          observations: [observation({}), observation({}), observation({})],
          now: NOW,
        })!),
      },
      {
        ...(distillLearning({
          organizationId: ORG,
          scope: { owningApp: "comms", operation: "comms.draft_reply" },
          scopeLabel: "Comms drafts",
          observations: [
            observation({ owningApp: "comms", operation: "comms.draft_reply" }),
          ],
          now: NOW,
        })!),
      },
    ];
    const recalled = relevantLearning({ records, rooms: ["scout"] });
    expect(recalled).toHaveLength(1);
    expect(recalled[0]!.scope.owningApp).toBe("scout");
  });

  it("keeps provenance from action through observation to lesson", async () => {
    const routed = action({ status: "routed", routedAt: NOW, recommendationId: "rec-9" });
    const pass = await runObservationPass({
      organizationId: ORG,
      actions: [routed],
      receipts: [{ actionId: routed.id, result: { reference: "run-1" } } as ExecutionReceipt],
      now: NOW,
      ledger: {
        observations: [],
        learning: [],
        appendObservation: async (row) => row,
        appendLearning: async (row) => row,
      },
    });
    expect(pass.observations[0]!.recommendationId).toBe("rec-9");
    expect(pass.learning[0]!.sourceActionIds).toContain(routed.id);
    expect(pass.learning[0]!.sourceObservationIds).toContain(pass.observations[0]!.id);
  });
});

/* -------------------------------------------------------- factory metrics */

describe("factory metrics", () => {
  it("keeps output, leading indicators and business outcomes distinct", () => {
    expect(metricClassOf("scout.discovery_runs")).toBe("output");
    expect(metricClassOf("comms.replies")).toBe("leading");
    expect(metricClassOf("projects.delivered")).toBe("lagging");
    expect(metricClassOf("business.revenue")).toBe("lagging");
  });
});
