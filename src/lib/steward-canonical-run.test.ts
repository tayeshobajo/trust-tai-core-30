import { describe, expect, it } from "vitest";
import {
  authorizeRunWorkerCaller,
  authorizeWorkerEndpoint,
  digestArtifact,
  digestRequest,
  executeCanonicalRun,
  requestCanonicalRun,
  type CanonicalRun,
  type CanonicalRunInputSnapshotEntry,
  type CanonicalRunRepository,
  type CanonicalRunProvider,
} from "./steward-canonical-run.server";

const ORG = "org-a";
const ACTOR = "user-owner";
const TASK = "task-1";

function snapshotEntry(partial: Partial<CanonicalRunInputSnapshotEntry> = {}) {
  return {
    kind: "transcript",
    id: "conv-1",
    revision: 1,
    content: "stored transcript content",
    contentDigest: "digest-1",
    ...partial,
  };
}

function makeRun(partial: Partial<CanonicalRun> = {}): CanonicalRun {
  return {
    id: "run-1",
    organizationId: ORG,
    taskId: TASK,
    action: "prepare_brief",
    clientOperationId: "op-1",
    requestDigest: "d",
    inputSnapshot: [snapshotEntry()],
    status: "queued",
    artifactText: null,
    artifactDigest: null,
    evidenceRefs: [],
    requestedBy: ACTOR,
    attempts: 0,
    maxAttempts: 3,
    failureReason: null,
    claimToken: null,
    claimVersion: 0,
    ...partial,
  };
}

function makeRepo(
  overrides: Partial<CanonicalRunRepository> = {},
): CanonicalRunRepository & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async requestRun(input) {
      calls.push("requestRun");
      return {
        run: makeRun({
          requestDigest: input.digest,
          // In-memory repos persist the pre-resolved snapshot, mirroring the
          // SQL function's server-side resolution.
          inputSnapshot:
            input.snapshot ?? input.inputRefs.map((r) => snapshotEntry({ kind: r.kind, id: r.id })),
          clientOperationId: input.operationId,
        }),
        replayed: false,
      };
    },
    async claimRun() {
      calls.push("claimRun");
      return makeRun({ status: "running", attempts: 1, claimToken: "fence-1", claimVersion: 1 });
    },
    async completeRun(input) {
      calls.push(`completeRun:${input.claimToken}`);
      return makeRun({
        status: "complete",
        artifactText: input.artifactText,
        artifactDigest: digestArtifact(input.artifactText),
        evidenceRefs: input.evidenceRefs,
        claimToken: null,
      });
    },
    async failRun(input) {
      calls.push(`failRun:${input.claimToken}`);
      return makeRun({ status: "failed", failureReason: input.reason, claimToken: null });
    },
    async readInput() {
      return { content: "stored transcript content", revision: 1 };
    },
    async readTaskTitle() {
      return "Server-resolved task title";
    },
    ...overrides,
  };
}

const fakeProvider: CanonicalRunProvider = {
  async generate() {
    return { text: "draft brief artifact" };
  },
};

const baseRequest = {
  orgId: ORG,
  taskId: TASK,
  action: "prepare_brief" as const,
  operationId: "op-1",
  inputRefs: [{ kind: "transcript", id: "conv-1" }],
  actorId: ACTOR,
};

describe("requestCanonicalRun", () => {
  it("rejects actions outside the allowlist", async () => {
    const repo = makeRepo();
    const result = await requestCanonicalRun(repo, {
      ...baseRequest,
      action: "build_website" as never,
    });
    expect(result.kind).toBe("rejected");
    expect(repo.calls).not.toContain("requestRun");
  });

  it("rejects empty input selections", async () => {
    const repo = makeRepo();
    const result = await requestCanonicalRun(repo, { ...baseRequest, inputRefs: [] });
    expect(result.kind).toBe("rejected");
    expect(repo.calls).not.toContain("requestRun");
  });

  it("rejects inaccessible inputs before creating a run", async () => {
    const repo = makeRepo({
      async readInput() {
        return null;
      },
    });
    const result = await requestCanonicalRun(repo, baseRequest);
    expect(result.kind).toBe("rejected");
    expect(repo.calls).not.toContain("requestRun");
  });

  it("rejects empty input content", async () => {
    const repo = makeRepo({
      async readInput() {
        return { content: "  ", revision: 1 };
      },
    });
    const result = await requestCanonicalRun(repo, baseRequest);
    expect(result.kind).toBe("rejected");
  });

  it("persists resolved content and digest in the immutable snapshot", async () => {
    const repo = makeRepo();
    const result = await requestCanonicalRun(repo, baseRequest);
    expect(result.kind).toBe("queued");
    if (result.kind === "queued") {
      const entry = result.run.inputSnapshot[0]!;
      expect(entry.content).toBe("stored transcript content");
      expect(entry.contentDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.revision).toBe(1);
    }
  });

  it("binds the digest to org, task, requester, action and input identity", () => {
    const inputs = [snapshotEntry()];
    const a = digestRequest({
      orgId: ORG,
      taskId: TASK,
      requesterId: ACTOR,
      action: "prepare_brief",
      inputs,
    });
    expect(
      digestRequest({
        orgId: "org-b",
        taskId: TASK,
        requesterId: ACTOR,
        action: "prepare_brief",
        inputs,
      }),
    ).not.toBe(a);
    expect(
      digestRequest({
        orgId: ORG,
        taskId: "task-2",
        requesterId: ACTOR,
        action: "prepare_brief",
        inputs,
      }),
    ).not.toBe(a);
    expect(
      digestRequest({
        orgId: ORG,
        taskId: TASK,
        requesterId: "user-other",
        action: "prepare_brief",
        inputs,
      }),
    ).not.toBe(a);
    expect(
      digestRequest({
        orgId: ORG,
        taskId: TASK,
        requesterId: ACTOR,
        action: "draft_roadmap",
        inputs,
      }),
    ).not.toBe(a);
    expect(
      digestRequest({
        orgId: ORG,
        taskId: TASK,
        requesterId: ACTOR,
        action: "prepare_brief",
        inputs: [snapshotEntry({ contentDigest: "digest-2" })],
      }),
    ).not.toBe(a);
    // Ref order does not change the digest.
    const two = [snapshotEntry(), snapshotEntry({ kind: "task_notes", id: "t1" })];
    expect(
      digestRequest({
        orgId: ORG,
        taskId: TASK,
        requesterId: ACTOR,
        action: "prepare_brief",
        inputs: two,
      }),
    ).toBe(
      digestRequest({
        orgId: ORG,
        taskId: TASK,
        requesterId: ACTOR,
        action: "prepare_brief",
        inputs: [...two].reverse(),
      }),
    );
  });

  it("maps a payload-mismatch on the same operation to a conflict", async () => {
    const repo = makeRepo({
      async requestRun() {
        const err = new Error("operation_conflict") as Error & { code: string };
        err.code = "P0002";
        throw err;
      },
    });
    const result = await requestCanonicalRun(repo, baseRequest);
    expect(result.kind).toBe("conflict");
  });
});

describe("executeCanonicalRun", () => {
  it("returns not_claimed when another worker holds the run", async () => {
    const repo = makeRepo({
      async claimRun() {
        return null;
      },
    });
    const result = await executeCanonicalRun(repo, fakeProvider, {
      runId: "run-1",
      actorId: ACTOR,
    });
    expect(result.kind).toBe("not_claimed");
    expect(repo.calls.some((c) => c.startsWith("completeRun"))).toBe(false);
  });

  it("returns not_claimed when the claim carries no fencing token", async () => {
    const repo = makeRepo({
      async claimRun() {
        return makeRun({ status: "running", claimToken: null });
      },
    });
    const result = await executeCanonicalRun(repo, fakeProvider, {
      runId: "run-1",
      actorId: ACTOR,
    });
    expect(result.kind).toBe("not_claimed");
  });

  it("feeds the provider only the immutable snapshot, never a fresh source read", async () => {
    let seen: { kind: string; content: string; revision: number }[] = [];
    const spy: CanonicalRunProvider = {
      async generate(input) {
        seen = input.inputs;
        return { text: "artifact" };
      },
    };
    const repo = makeRepo({
      async claimRun() {
        return makeRun({
          status: "running",
          claimToken: "fence-9",
          claimVersion: 2,
          inputSnapshot: [snapshotEntry({ content: "SNAPSHOT content", revision: 3 })],
        });
      },
      async readInput() {
        return { content: "EDITED after request", revision: 4 };
      },
    });
    const result = await executeCanonicalRun(repo, spy, { runId: "run-1", actorId: ACTOR });
    expect(result.kind).toBe("complete");
    expect(seen).toEqual([{ kind: "transcript", content: "SNAPSHOT content", revision: 3 }]);
  });

  it("threads the fencing token into completion with digest and provenance", async () => {
    const repo = makeRepo({
      async claimRun() {
        return makeRun({ status: "running", claimToken: "fence-9", claimVersion: 2, attempts: 1 });
      },
    });
    const result = await executeCanonicalRun(repo, fakeProvider, {
      runId: "run-1",
      actorId: ACTOR,
    });
    expect(result.kind).toBe("complete");
    expect(repo.calls).toContain("completeRun:fence-9");
    if (result.kind === "complete") {
      expect(result.run.artifactDigest).toBe(digestArtifact("draft brief artifact"));
      expect(result.run.evidenceRefs).toEqual(["transcript:conv-1@1"]);
    }
  });

  it("marks the run failed on provider failure with the same fencing token", async () => {
    const repo = makeRepo({
      async claimRun() {
        return makeRun({ status: "running", claimToken: "fence-9", claimVersion: 2, attempts: 1 });
      },
    });
    const failing: CanonicalRunProvider = {
      async generate() {
        throw new Error("provider timeout");
      },
    };
    const result = await executeCanonicalRun(repo, failing, { runId: "run-1", actorId: ACTOR });
    expect(result.kind).toBe("failed");
    expect(repo.calls).toContain("failRun:fence-9");
    expect(repo.calls.some((c) => c.startsWith("completeRun"))).toBe(false);
  });

  it("fails the run when the task title cannot be resolved server-side", async () => {
    const repo = makeRepo({
      async readTaskTitle() {
        return null;
      },
    });
    const result = await executeCanonicalRun(repo, fakeProvider, {
      runId: "run-1",
      actorId: ACTOR,
    });
    expect(result.kind).toBe("failed");
    expect(repo.calls.some((c) => c.startsWith("completeRun"))).toBe(false);
  });
});

describe("authorizeRunWorkerCaller", () => {
  const RUN = { organizationId: ORG, taskId: TASK };
  const MEMBER = { status: "active", role: "member" };
  const BUSINESS_TASK = { taskVisibility: "business", ownerUserId: null, createdBy: "user-owner" };

  it("denies an unknown or foreign run without disclosing existence", () => {
    expect(
      authorizeRunWorkerCaller({ run: null, membership: MEMBER, task: BUSINESS_TASK, callerId: ACTOR }),
    ).toBe("this run is not available to you");
  });

  it("denies a caller who is not an active member of the run's org", () => {
    expect(
      authorizeRunWorkerCaller({
        run: RUN,
        membership: { status: "inactive", role: "member" },
        task: BUSINESS_TASK,
        callerId: ACTOR,
      }),
    ).toBe("this run is not available to you");
    expect(
      authorizeRunWorkerCaller({ run: RUN, membership: null, task: BUSINESS_TASK, callerId: ACTOR }),
    ).toBe("this run is not available to you");
  });

  it("denies a viewer even when they created the task (no write role)", () => {
    expect(
      authorizeRunWorkerCaller({
        run: RUN,
        membership: { status: "active", role: "viewer" },
        task: BUSINESS_TASK,
        callerId: ACTOR,
      }),
    ).toBe("this run is not available to you");
  });

  it("denies an unrelated active member on someone else's business task", () => {
    expect(
      authorizeRunWorkerCaller({
        run: RUN,
        membership: MEMBER,
        task: BUSINESS_TASK,
        callerId: "user-unrelated",
      }),
    ).toBe("this run is not available to you");
  });

  it("allows the creator, the current owner, and an org admin", () => {
    expect(
      authorizeRunWorkerCaller({ run: RUN, membership: MEMBER, task: BUSINESS_TASK, callerId: ACTOR }),
    ).toBeNull();
    expect(
      authorizeRunWorkerCaller({
        run: RUN,
        membership: MEMBER,
        task: { taskVisibility: "business", ownerUserId: "user-owner2", createdBy: "user-other" },
        callerId: "user-owner2",
      }),
    ).toBeNull();
    expect(
      authorizeRunWorkerCaller({
        run: RUN,
        membership: { status: "active", role: "admin" },
        task: BUSINESS_TASK,
        callerId: "user-admin",
      }),
    ).toBeNull();
  });

  it("fails closed on personal tasks for everyone, including the owner", () => {
    const personal = { taskVisibility: "personal", ownerUserId: ACTOR, createdBy: ACTOR };
    expect(
      authorizeRunWorkerCaller({ run: RUN, membership: MEMBER, task: personal, callerId: ACTOR }),
    ).toBe("this run is not available to you");
    expect(
      authorizeRunWorkerCaller({
        run: RUN,
        membership: { status: "active", role: "admin" },
        task: personal,
        callerId: "user-admin",
      }),
    ).toBe("this run is not available to you");
  });

  it("fails closed when the task row is missing", () => {
    expect(
      authorizeRunWorkerCaller({ run: RUN, membership: MEMBER, task: null, callerId: ACTOR }),
    ).toBe("this run is not available to you");
  });
});

describe("authorizeWorkerEndpoint (handler composition over RLS reads)", () => {
  const RUN_ROW = { id: "run-1", organization_id: ORG, task_id: TASK };

  function fakeRls(rows: {
    run?: Record<string, unknown> | null;
    membership?: Record<string, unknown> | null;
    task?: Record<string, unknown> | null;
  }) {
    const reads: { table: string; cols: string }[] = [];
    const make = (table: string, row: Record<string, unknown> | null) => ({
      select: (cols: string) => {
        reads.push({ table, cols });
        const leaf = { maybeSingle: async () => ({ data: row }) };
        return { eq: () => ({ eq: () => ({ eq: () => leaf, maybeSingle: leaf.maybeSingle }), maybeSingle: leaf.maybeSingle }) };
      },
    });
    return {
      reads,
      from: (table: string) =>
        table === "steward_canonical_runs"
          ? make(table, rows.run ?? null)
          : table === "organization_memberships"
            ? make(table, rows.membership ?? null)
            : make(table, rows.task ?? null),
    };
  }

  it("reads the real column names (task_visibility, not visibility)", async () => {
    const rls = fakeRls({
      run: RUN_ROW,
      membership: { status: "active", role: "member" },
      task: { task_visibility: "business", owner_user_id: null, created_by: ACTOR },
    });
    const result = await authorizeWorkerEndpoint(rls as never, { runId: "run-1", callerId: ACTOR });
    expect("run" in result).toBe(true);
    const taskRead = rls.reads.find((r) => r.table === "steward_tasks");
    expect(taskRead?.cols).toBe("task_visibility, owner_user_id, created_by");
    expect(rls.reads.find((r) => r.table === "organization_memberships")?.cols).toBe("status, role");
  });

  it("denies a cross-org caller before any privileged transition", async () => {
    // RLS returns nothing for a foreign run: indistinguishable from missing.
    const rls = fakeRls({ run: null });
    const result = await authorizeWorkerEndpoint(rls as never, { runId: "run-x", callerId: ACTOR });
    expect(result).toEqual({ denial: "this run is not available to you" });
  });

  it("denies an unrelated member and a viewer on the real mapping", async () => {
    const task = { task_visibility: "business", owner_user_id: null, created_by: "user-owner" };
    for (const membership of [
      { status: "active", role: "member" },
      { status: "active", role: "viewer" },
      { status: "inactive", role: "owner" },
    ]) {
      const rls = fakeRls({ run: RUN_ROW, membership, task });
      const result = await authorizeWorkerEndpoint(rls as never, {
        runId: "run-1",
        callerId: "user-unrelated",
      });
      expect(result).toEqual({ denial: "this run is not available to you" });
    }
  });

  it("authorizes the creator through the full read composition", async () => {
    const rls = fakeRls({
      run: RUN_ROW,
      membership: { status: "active", role: "team_member" },
      task: { task_visibility: "business", owner_user_id: null, created_by: ACTOR },
    });
    const result = await authorizeWorkerEndpoint(rls as never, { runId: "run-1", callerId: ACTOR });
    expect(result).toEqual({ run: { organizationId: ORG, taskId: TASK } });
  });
});
