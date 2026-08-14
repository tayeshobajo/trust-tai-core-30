/**
 * Judgment, checked as a person would check it.
 *
 * Every case here is about restraint: does Steward earn the interruption, does
 * it stay silent when nothing is owed, and can it always say why.
 */

import { describe, expect, it } from "vitest";

import { judge, collapse, clearedOpsChains, decidedClosures } from "./judgment";
import type { JudgmentInput } from "./judgment";
import type { Commitment } from "@/domain/steward";
import type { ExecutionProject } from "@/domain/projects";
import type { OpsEvent } from "@/domain/ops";
import type { MemoryBelief } from "@/domain/steward-memory";
import type { AttentionItem } from "@/domain/steward-judgment";

const ORG = "org-a";
const NOW = "2026-05-20T09:00:00.000Z";

const HENRY = { personKey: "henry@trusttai.com", name: "Henry", userId: "user-henry" };
const EMMANUEL = { personKey: "emmanuel@trusttai.com", name: "Emmanuel", userId: "user-emmanuel" };

function commitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: "c1",
    organizationId: ORG,
    conversationId: "conv-1",
    ownerName: "Henry",
    ownerEmail: "henry@trusttai.com",
    what: "Confirm the Bioptrics plan",
    status: "open",
    sourceKey: "conv-1:1",
    evidence: [{ label: "Said in the Bioptrics call", kind: "human" }],
    createdAt: "2026-05-15T09:00:00.000Z",
    updatedAt: "2026-05-15T09:00:00.000Z",
    ...overrides,
  };
}

function input(overrides: Partial<JudgmentInput> = {}): JudgmentInput {
  return {
    organizationId: ORG,
    now: NOW,
    viewer: HENRY,
    commitments: [],
    ...overrides,
  };
}

describe("needs you", () => {
  it("surfaces a promise another person is waiting on", () => {
    const read = judge(input({ commitments: [commitment({ beneficiary: "Emmanuel" })] }));
    expect(read.items).toHaveLength(1);
    expect(read.items[0]!.state).toBe("needs_you");
    expect(read.headline).toBe("One thing needs you.");
    expect(read.items[0]!.whyNow).toMatch(/Emmanuel is waiting on you/);
  });

  it("carries evidence and provenance on every surfaced item", () => {
    const read = judge(input({ commitments: [commitment({ beneficiary: "Emmanuel" })] }));
    const item = read.items[0]!;
    expect(item.evidence.length).toBeGreaterThan(0);
    expect(item.sourceApps).toContain("steward");
    expect(item.refs.commitmentId).toBe("c1");
    expect(item.refs.conversationId).toBe("conv-1");
    expect(item.tier).toBe("decided");
  });

  it("a blocked project the person carries needs them", () => {
    const project: ExecutionProject = {
      id: "p1",
      organizationId: ORG,
      name: "Bioptrics rollout",
      state: "blocked",
      ownerUserId: "user-henry",
      pointA: "Plan drafted",
      pointB: "Plan approved",
      blockedBecause: "Waiting on the signed scope.",
      evidence: [],
      dependencies: [],
      origin: { kind: "manual" },
      lastMovedAt: "2026-05-18T09:00:00.000Z",
      createdAt: "2026-05-01T09:00:00.000Z",
      updatedAt: "2026-05-18T09:00:00.000Z",
    };
    const read = judge(input({ projects: [project] }));
    expect(read.items[0]!.state).toBe("needs_you");
    expect(read.items[0]!.refs.projectId).toBe("p1");
  });
});

describe("waiting", () => {
  it("waiting on someone else is not a chase", () => {
    const read = judge(
      input({
        commitments: [commitment({ status: "waiting", updatedAt: "2026-05-19T09:00:00.000Z" })],
      }),
    );
    expect(read.items).toHaveLength(0);
    expect(read.headline).toBe("Nothing needs you right now.");
    expect(read.waiting[0]!.state).toBe("waiting");
    expect(read.waiting[0]!.nextMove).toBeUndefined();
  });

  it("a follow-up becomes meaningful once the wait is long enough", () => {
    const read = judge(
      input({
        commitments: [commitment({ status: "waiting", updatedAt: "2026-05-01T09:00:00.000Z" })],
      }),
    );
    expect(read.waiting[0]!.nextMove).toBeTruthy();
  });
});

describe("newly unblocked", () => {
  function opsEvent(overrides: Partial<OpsEvent>): OpsEvent {
    return {
      id: "a1",
      name: "ops.blocked",
      organizationId: ORG,
      summary: "Deploy blocked on failing QA.",
      at: "2026-05-16T09:00:00.000Z",
      idempotencyKey: "k1",
      chainKey: "chain-1",
      canonicalProjectId: "p1",
      destinationUrl: "https://ops.trusttai.com/runs/1",
      humanDecision: false,
      subjectLabel: "Bioptrics rollout",
      ...overrides,
    };
  }

  const project: ExecutionProject = {
    id: "p1",
    organizationId: ORG,
    name: "Bioptrics rollout",
    state: "in_flight",
    ownerUserId: "user-henry",
    pointA: "Built",
    pointB: "Shipped",
    evidence: [],
    dependencies: [],
    origin: { kind: "manual" },
    lastMovedAt: "2026-05-18T09:00:00.000Z",
    createdAt: "2026-05-01T09:00:00.000Z",
    updatedAt: "2026-05-18T09:00:00.000Z",
  };

  it("reads a cleared Ops chain as newly unblocked", () => {
    const events = [
      opsEvent({}),
      opsEvent({
        id: "a2",
        name: "ops.qa_passed",
        summary: "QA passed on the latest run.",
        at: "2026-05-19T09:00:00.000Z",
      }),
    ];
    expect(clearedOpsChains(events, NOW)).toHaveLength(1);
    const read = judge(input({ projects: [project], opsEvents: events }));
    expect(read.items[0]!.state).toBe("newly_unblocked");
    expect(read.items[0]!.whyNow).toMatch(/QA passed/);
  });

  it("an unresolved blocker is not an unblocking", () => {
    expect(clearedOpsChains([opsEvent({})], NOW)).toHaveLength(0);
  });
});

describe("promise at risk", () => {
  it("a passed due date a person set puts the promise at risk", () => {
    const read = judge(
      input({ commitments: [commitment({ dueAt: "2026-05-18T09:00:00.000Z" })] }),
    );
    expect(read.items[0]!.state).toBe("promise_at_risk");
    expect(read.items[0]!.whyNow).toMatch(/passed 2 days ago/);
  });

  it("vague timing never invents urgency", () => {
    const read = judge(
      input({ commitments: [commitment({ dueText: "sometime soon", dueAt: undefined })] }),
    );
    expect(read.items).toHaveLength(0);
    expect(read.headline).toBe("Nothing needs you right now.");
  });
});

describe("suppression", () => {
  it("kept and released work never surfaces", () => {
    const read = judge(
      input({
        commitments: [
          commitment({ id: "c1", status: "kept", beneficiary: "Emmanuel" }),
          commitment({ id: "c2", status: "released", beneficiary: "Emmanuel" }),
        ],
      }),
    );
    expect(read.items).toHaveLength(0);
  });

  it("a human decision beats a stale reading", () => {
    const memory: MemoryBelief[] = [
      {
        id: "b1",
        organizationId: ORG,
        subjectKey: "henry@trusttai.com",
        subjectLabel: "Henry",
        statement: "Henry marked the Bioptrics plan as kept.",
        tier: "decided",
        authority: "human",
        evidence: [],
        recordedBy: "henry@trusttai.com",
        recordedAt: "2026-05-19T09:00:00.000Z",
        meta: { kind: "commitment_pattern", facet: "commitment", commitmentId: "c1", outcome: "marked_kept" },
      },
    ];
    expect(decidedClosures(memory).has("c1")).toBe(true);
    const read = judge(input({ commitments: [commitment({ beneficiary: "Emmanuel" })], memory }));
    expect(read.items).toHaveLength(0);
  });

  it("dismissed context does not become attention", () => {
    const first = judge(input({ commitments: [commitment({ beneficiary: "Emmanuel" })] }));
    const key = first.items[0]!.patternKey;
    const read = judge(
      input({
        commitments: [commitment({ beneficiary: "Emmanuel" })],
        suppressedPatternKeys: [key],
      }),
    );
    expect(read.items).toHaveLength(0);
  });

  it("another organization's work is invisible", () => {
    const read = judge(
      input({ commitments: [commitment({ organizationId: "org-b", beneficiary: "Emmanuel" })] }),
    );
    expect(read.items).toHaveLength(0);
  });

  it("an unrelated person's promise is not this person's attention", () => {
    const read = judge(
      input({
        commitments: [
          commitment({ ownerName: "Tai", ownerEmail: "tai@trusttai.com", beneficiary: "Dana" }),
        ],
      }),
    );
    expect(read.items).toHaveLength(0);
  });
});

describe("collapse", () => {
  it("two readings of the same work become one richer judgment", () => {
    const base: AttentionItem = {
      id: "x",
      forPersonKey: HENRY.personKey,
      forName: "Henry",
      state: "needs_you",
      headline: "Confirm the Bioptrics plan",
      whyNow: "Emmanuel is waiting.",
      refs: { commitmentId: "c1" },
      evidence: [{ label: "Said in the call", kind: "human" }],
      sourceApps: ["steward"],
      tier: "decided",
      destination: { appId: "steward", label: "Open in Steward", route: "/modules/steward" },
      order: 2000,
      patternKey: "k",
    };
    const stronger: AttentionItem = {
      ...base,
      id: "y",
      state: "newly_unblocked",
      evidence: [{ label: "QA passed", kind: "provider" }],
      sourceApps: ["ops"],
      order: 4000,
    };
    const merged = collapse([base, stronger]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.state).toBe("newly_unblocked");
    expect(merged[0]!.evidence).toHaveLength(2);
    expect(merged[0]!.sourceApps.sort()).toEqual(["ops", "steward"]);
  });
});

describe("perspective", () => {
  it("the same truth reads differently for each person", () => {
    const rows = [commitment({ beneficiary: "Emmanuel" })];
    const henry = judge(input({ commitments: rows, viewer: HENRY }));
    const emmanuel = judge(input({ commitments: rows, viewer: EMMANUEL }));

    expect(henry.items[0]!.state).toBe("needs_you");
    expect(emmanuel.items).toHaveLength(0);
    expect(emmanuel.waiting[0]!.state).toBe("waiting");
    expect(emmanuel.waiting[0]!.waitingOn?.name).toBe("Henry");
    expect(emmanuel.headline).toBe("Nothing needs you right now.");
  });
});

describe("ordering and shape", () => {
  it("orders deterministically and caps what may interrupt", () => {
    const rows = [
      commitment({ id: "c1", beneficiary: "Emmanuel" }),
      commitment({ id: "c2", beneficiary: "Dana", dueAt: "2026-05-10T09:00:00.000Z" }),
      commitment({ id: "c3", beneficiary: "Tai", dueAt: "2026-05-18T09:00:00.000Z" }),
      commitment({ id: "c4", beneficiary: "Ana" }),
      commitment({ id: "c5", beneficiary: "Sam" }),
    ];
    const first = judge(input({ commitments: rows }));
    const second = judge(input({ commitments: [...rows].reverse() }));

    expect(first.items).toHaveLength(3);
    expect(first.deferred).toBe(2);
    expect(first.items.map((item) => item.id)).toEqual(second.items.map((item) => item.id));
    expect(first.items[0]!.state).toBe("promise_at_risk");
  });

  it("nothing needs you is a first-class answer", () => {
    const read = judge(input());
    expect(read.headline).toBe("Nothing needs you right now.");
    expect(read.items).toHaveLength(0);
    expect(read.waiting).toHaveLength(0);
  });
});
