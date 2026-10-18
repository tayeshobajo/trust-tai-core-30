import { describe, expect, it } from "vitest";
import {
  authorizeRunWorkerCaller,
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
      return { run: makeRun({
        requestDigest: input.digest,
        // In-memory repos persist the pre-resolved snapshot, mirroring the
        // SQL function's server-side resolution.
        inputSnapshot:
          input.snapshot ?? input.inputRefs.map((r) => snapshotEntry({ kind: r.kind, id: r.id })),
        clientOperationId: input.operationId,
      });
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
  const BUSINESS_TASK = { visibility: "business", ownerUserId: null };

  it("denies an unknown or foreign run without disclosing existence", () => {
    expect(
      authorizeRunWorkerCaller({ run: null, isActiveMember: true, task: BUSINESS_TASK, callerId: ACTOR }),
    ).toBe("this run is not available to you");
  });

  it("denies a caller who is not an active member of the run's org", () => {
    expect(
      authorizeRunWorkerCaller({ run: RUN, isActiveMember: false, task: BUSINESS_TASK, callerId: ACTOR }),
    ).toBe("this run is not available to you");
  });

  it("denies when the canonical task is not visible to the caller", () => {
    expect(
      authorizeRunWorkerCaller({ run: RUN, isActiveMember: true, task: null, callerId: ACTOR }),
    ).toBe("this run is not available to you");
  });

  it("denies a personal task to anyone but its owner", () => {
    const personal = { visibility: "personal", ownerUserId: "user-other" };
    expect(
      authorizeRunWorkerCaller({ run: RUN, isActiveMember: true, task: personal, callerId: ACTOR }),
    ).toBe("this run is not available to you");
  });

  it("allows an active member on a business task and the owner on a personal task", () => {
    expect(
      authorizeRunWorkerCaller({ run: RUN, isActiveMember: true, task: BUSINESS_TASK, callerId: ACTOR }),
    ).toBeNull();
    expect(
      authorizeRunWorkerCaller({
        run: RUN,
        isActiveMember: true,
        task: { visibility: "personal", ownerUserId: ACTOR },
        callerId: ACTOR,
      }),
    ).toBeNull();
  });
});
