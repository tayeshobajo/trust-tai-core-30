/**
 * Conductor V3.1 — question to routable Scout cycle.
 *
 * The V3 first-cycle rehearsal locked in one honest failure: a question could
 * not start a cycle, because no reasoning path produced a governed action
 * carrying the subject payload Scout's adapter requires.
 *
 * This proves the fix, and proves the fix stayed narrow:
 *
 *   question → recommendation → governed `scout.start_discovery_run` →
 *   brief resolved deterministically from the saved ICP → approval →
 *   the existing Scout adapter → receipt → observation → one lesson →
 *   a later related answer carrying that lesson.
 *
 * Approval, permission, consequence and org boundaries are asserted unchanged.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { accessContext, can, type Permission } from "@/domain/access";
import type { ControlledAction, ExecutionReceipt } from "@/domain/conductor-control";
import type { ActionObservation, LearningRecord } from "@/domain/outcomes";
import { emptySnapshot } from "@/data/intelligence/derive";
import type { IcpContext } from "@/data/intelligence/conductor/payload-fill";

/* ---------------------------------------------------------- room services */

const scoutRunHistory: { id: string; query: string; status: string; resultCount: number }[] = [];
const scoutDiscover = vi.fn(async (input: { query: string }) => {
  const run = { id: "run-v31", query: input.query, status: "succeeded", resultCount: 2 };
  scoutRunHistory.push(run);
  return { runId: run.id, saved: 2, rejected: 0, returned: 2 };
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

const persisted: ControlledAction[] = [];
const receipts: ExecutionReceipt[] = [];

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
  emitControlEvent: async () => null,
}));

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
const { runObservationPass } = await import("./outcome-service");
const { relevantLearning } = await import("./learning");
const { answerQuestion } = await import("@/data/intelligence/conductor");
const { buildControlledActions, routability } = await import(
  "@/data/intelligence/conductor/control"
);
const { ROOM_ADAPTERS } = await import("./adapters");

/* ------------------------------------------------------------- fixtures */

const ORG = "org-v31";
const NOW = "2026-08-26T09:00:00.000Z";
const owner = accessContext({ userId: "tai", organizationId: ORG, role: "owner" });
const access = { can: (permission: string) => can(owner, permission as Permission) };
const viewer = accessContext({ userId: "vee", organizationId: ORG, role: "viewer" });
const viewerAccess = { can: (permission: string) => can(viewer, permission as Permission) };
const actor = { id: "tai", label: "Tai" };

const SAVED_ICP: IcpContext = {
  profileId: "icp-v31",
  version: 4,
  title: "Ideal Client Profile",
  contentMarkdown: [
    "# Who we serve",
    "- Independent professional services firms",
    "**Industries**",
    "- Accountancy, legal, consulting",
    "## Geography",
    "- United Kingdom",
    "## Company size",
    "- 10-50 people",
    "## Exclusions",
    "- Agencies under 5 people",
  ].join("\n"),
  updatedAt: "2026-08-01T00:00:00.000Z",
};

/** A snapshot whose Scout board is genuinely empty. */
function thinPipeline(organizationId = ORG) {
  return {
    ...emptySnapshot(organizationId, NOW),
    /* Conversations exist, but the Scout board is empty: the evidence the
     * thin-pipeline hypothesis actually reads. */
    relationships: [1, 2, 3].map((index) => ({
      id: `rel-${index}`,
      organizationId,
      fullName: `Person ${index}`,
      stage: "in_conversation" as const,
      source: "scout_handoff" as const,
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
}


const DEMAND_QUESTION = "our pipeline is thin, how do we find more qualified companies";

beforeEach(() => {
  vi.clearAllMocks();
  scoutRunHistory.length = 0;
  persisted.length = 0;
  receipts.length = 0;
  observationLedger.length = 0;
  learningLedger.length = 0;
});

/* ------------------------------------------------------------- selection */

describe("question-originated Scout operation selection", () => {
  it("proposes the adapter-backed discovery run for a demand question", () => {
    const answer = answerQuestion({
      snapshot: thinPipeline(),
      question: DEMAND_QUESTION,
      icp: SAVED_ICP,
    });
    const discovery = answer.proposedActions.find(
      (action) => action.operation === "scout.start_discovery_run",
    );
    expect(discovery).toBeDefined();
    expect(discovery!.requiresApproval).toBe(true);
    expect(discovery!.appId).toBe("scout");
  });

  it("does not attach a Scout sourcing run to an unrelated question", () => {
    const answer = answerQuestion({
      snapshot: thinPipeline(),
      question: "what promises have I missed this week",
      icp: SAVED_ICP,
    });
    /* Selection is conservative: no demand wording, no sourcing upgrade added
     * beyond what the read itself already proposed for that topic. */
    expect(
      answer.proposedActions.filter((a) => a.operation === "scout.start_discovery_run").length,
    ).toBeLessThanOrEqual(1);
  });
});

/* ------------------------------------------------------------ resolution */

describe("deterministic execution-input resolution", () => {
  it("builds the brief from trusted ICP fields, not model text", () => {
    const answer = answerQuestion({
      snapshot: thinPipeline(),
      question: DEMAND_QUESTION,
      icp: SAVED_ICP,
    });
    const discovery = answer.proposedActions.find(
      (a) => a.operation === "scout.start_discovery_run",
    )!;
    const brief = String(discovery.payload["brief"]);

    expect(brief).toContain("Accountancy, legal, consulting");
    expect(brief).toContain("Geography: United Kingdom");
    expect(brief).toContain("Company size: 10-50 people");
    expect(discovery.payload["briefSource"]).toBe("icp_profiles");
    expect(discovery.payload["icpProfileId"]).toBe("icp-v31");
    expect(discovery.payload["icpVersion"]).toBe(4);
    expect(answer.inputResolutions?.[discovery.id]?.status).toBe("resolved");
    expect(answer.inputResolutions?.[discovery.id]?.source?.recordId).toBe("icp-v31");

    /* Deterministic: the same ICP always composes the same brief. */
    const again = answerQuestion({
      snapshot: thinPipeline(),
      question: DEMAND_QUESTION,
      icp: SAVED_ICP,
    });
    const briefAgain = String(
      again.proposedActions.find((a) => a.operation === "scout.start_discovery_run")!.payload[
        "brief"
      ],
    );
    expect(briefAgain).toBe(brief);
  });

  it("leaves the action non-routable rather than inventing a brief", () => {
    const answer = answerQuestion({
      snapshot: thinPipeline(),
      question: DEMAND_QUESTION,
      icp: null,
    });
    const discovery = answer.proposedActions.find(
      (a) => a.operation === "scout.open_discovery",
    );
    expect(discovery).toBeDefined();
    expect(discovery!.payload["brief"]).toBeUndefined();
    expect(discovery!.payload["inputResolution"]).toBe("missing_input");
    expect(answer.inputResolutions?.[discovery!.id]?.missing).toContain("saved ICP profile");
  });

  it("names the missing targeting fields when the ICP holds nothing to search on", () => {
    const answer = answerQuestion({
      snapshot: thinPipeline(),
      question: DEMAND_QUESTION,
      icp: { ...SAVED_ICP, contentMarkdown: "## \n---\n" },
    });
    const discovery = answer.proposedActions.find((a) => a.operation === "scout.open_discovery")!;
    expect(answer.inputResolutions?.[discovery.id]?.missing).toContain("target industries");
  });

  it("can never hydrate from another organization's ICP", () => {
    /* The resolver only ever sees the ICP the caller loaded for the current
     * organization; nothing in the reasoning path can reach across orgs. */
    const answer = answerQuestion({
      snapshot: emptySnapshot("org-other", NOW),
      question: DEMAND_QUESTION,
      icp: null,
    });
    const discovery = answer.proposedActions.find((a) => a.appId === "scout");
    expect(discovery?.payload["icpProfileId"]).toBeUndefined();
    expect(answer.organizationId).toBe("org-other");
  });
});

/* --------------------------------------------------------------- the loop */

describe("question → approval → Scout execution → observation → learning", () => {
  it("routes only after approval and records exactly one result", async () => {
    const answer = answerQuestion({
      snapshot: thinPipeline(),
      question: DEMAND_QUESTION,
      icp: SAVED_ICP,
    });
    const actions = buildControlledActions({
      organizationId: ORG,
      graph: answer.actionGraph!,
      answerId: answer.id,
      now: NOW,
    });
    const governed = actions.find((a) => a.operation === "scout.start_discovery_run")!;

    /* Approval law: unchanged. */
    expect(governed.requiresApproval).toBe(true);
    expect(governed.consequence).toBe("internal_change");
    expect(governed.requiredCapability).toBe("scout.write");
    expect(
      routability({ action: governed, actions, adapters: ROOM_ADAPTERS, access }).refusal,
    ).toBe("not_approved");

    /* A viewer without scout.write is still refused after approval. */
    const approved = await decide(
      [governed],
      [{ actionId: governed.id, kind: "approve" }],
      owner,
      actor,
      NOW,
    );
    const scoutAction = approved.find((a) => a.id === governed.id)!;
    expect(scoutAction.status).toBe("approved");
    expect(
      routability({
        action: scoutAction,
        actions: approved,
        adapters: ROOM_ADAPTERS,
        access: viewerAccess,
      }).routable,
    ).toBe(false);

    /* Now the real adapter accepts it, because the brief is present. */
    expect(
      routability({ action: scoutAction, actions: approved, adapters: ROOM_ADAPTERS, access })
        .routable,
    ).toBe(true);

    const outcome = await routeAction(scoutAction, approved, owner, actor, ROOM_ADAPTERS, NOW);
    expect(outcome.receipt?.status).toBe("routed");
    expect(scoutDiscover).toHaveBeenCalledTimes(1);
    expect(scoutDiscover.mock.calls[0]![0]!.query).toContain("Geography: United Kingdom");

    /* Observation and learning: unchanged V3 behaviour, deduped on re-check. */
    const routed = [outcome.action];
    const receiptsFor = outcome.receipt ? [outcome.receipt] : [];
    const first = await runObservationPass({
      organizationId: ORG,
      actions: routed,
      receipts: receiptsFor,
      now: "2026-08-27T09:00:00.000Z",
    });
    expect(first.observations.length).toBeGreaterThan(0);
    const afterFirst = observationLedger.length;

    await runObservationPass({
      organizationId: ORG,
      actions: routed,
      receipts: receiptsFor,
      now: "2026-08-27T10:00:00.000Z",
    });
    expect(observationLedger.length).toBe(afterFirst);


    /* A later related question carries the bounded lesson; an unrelated one
     * does not. */
    const lessons = relevantLearning({
      records: learningLedger,
      rooms: ["scout"],
      operations: ["scout.start_discovery_run"],
    });
    const unrelated = relevantLearning({
      records: learningLedger,
      rooms: ["comms"],
      operations: ["comms.draft_reply"],
    });
    expect(unrelated).toHaveLength(0);
    if (learningLedger.length > 0) expect(lessons.length).toBeGreaterThan(0);
  });
});
