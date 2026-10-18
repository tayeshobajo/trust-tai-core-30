import { describe, expect, it } from "vitest";
import {
  digestArtifact,
  digestRequest,
  executeCanonicalRun,
  requestCanonicalRun,
  type CanonicalRun,
  type CanonicalRunRepository,
  type CanonicalRunProvider,
} from "./steward-canonical-run.server";

const ORG = "org-a";
const ACTOR = "user-owner";
const TASK = "task-1";

function makeRun(partial: Partial<CanonicalRun>): CanonicalRun {
  return {
    id: partial.id ?? "run-1",
    organizationId: ORG,
    taskId: TASK,
    action: "prepare_brief",
    clientOperationId: "op-1",
    requestDigest: "d",
    inputSnapshot: { action: "prepare_brief", inputRefs: [] },
    status: "queued",
    artifactText: null,
    artifactDigest: null,
    evidenceRefs: [],
    requestedBy: ACTOR,
    attempts: 0,
    maxAttempts: 3,
    failureReason: null,
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
      return makeRun({
        requestDigest: input.digest,
        inputSnapshot: input.snapshot,
        clientOperationId: input.operationId,
      });
    },
    async claimRun() {
      calls.push("claimRun");
      return makeRun({ status: "running", attempts: 1 });
    },
    async completeRun(input) {
      calls.push("completeRun");
      return makeRun({
        status: "complete",
        artifactText: input.artifactText,
        artifactDigest: input.artifactDigest,
        evidenceRefs: input.evidenceRefs,
      });
    },
    async failRun(_runId, _actor, reason) {
      calls.push("failRun");
      return makeRun({ status: "failed", failureReason: reason });
    },
    async readInput() {
      return { content: "stored content", revision: 1 };
    },
    ...overrides,
  };
}

const fakeProvider: CanonicalRunProvider = {
  async generate() {
    return { text: "draft brief artifact" };
  },
};

describe("requestCanonicalRun", () => {
  it("rejects actions outside the allowlist", async () => {
    const repo = makeRepo();
    const result = await requestCanonicalRun(repo, {
      orgId: ORG,
      taskId: TASK,
      taskTitle: "T",
      action: "build_website" as never,
      operationId: "op-1",
      inputRefs: [],
      actorId: ACTOR,
    });
    expect(result.kind).toBe("rejected");
    expect(repo.calls).not.toContain("requestRun");
  });

  it("rejects inaccessible inputs before creating a run", async () => {
    const repo = makeRepo({
      async readInput() {
        return null;
      },
    });
    const result = await requestCanonicalRun(repo, {
      orgId: ORG,
      taskId: TASK,
      taskTitle: "T",
      action: "prepare_brief",
      operationId: "op-1",
      inputRefs: [{ kind: "transcript", id: "conv-1", revision: 3 }],
      actorId: ACTOR,
    });
    expect(result.kind).toBe("rejected");
    expect(repo.calls).not.toContain("requestRun");
  });

  it("rejects inputs whose revision changed since selection", async () => {
    const repo = makeRepo({
      async readInput() {
        return { content: "x", revision: 4 };
      },
    });
    const result = await requestCanonicalRun(repo, {
      orgId: ORG,
      taskId: TASK,
      taskTitle: "T",
      action: "prepare_brief",
      operationId: "op-1",
      inputRefs: [{ kind: "transcript", id: "conv-1", revision: 3 }],
      actorId: ACTOR,
    });
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") expect(result.message).toContain("changed since selection");
  });

  it("maps a payload-mismatch on the same operation to a conflict", async () => {
    const repo = makeRepo({
      async requestRun() {
        const err = new Error("operation_conflict") as Error & { code: string };
        err.code = "P0002";
        throw err;
      },
    });
    const result = await requestCanonicalRun(repo, {
      orgId: ORG,
      taskId: TASK,
      taskTitle: "T",
      action: "prepare_brief",
      operationId: "op-1",
      inputRefs: [],
      actorId: ACTOR,
    });
    expect(result.kind).toBe("conflict");
  });

  it("produces a stable digest independent of input ref order", () => {
    const a = digestRequest({
      action: "prepare_brief",
      inputRefs: [
        { kind: "transcript", id: "c1", revision: 1 },
        { kind: "task_notes", id: "t1", revision: 2 },
      ],
    });
    const b = digestRequest({
      action: "prepare_brief",
      inputRefs: [
        { kind: "task_notes", id: "t1", revision: 2 },
        { kind: "transcript", id: "c1", revision: 1 },
      ],
    });
    expect(a).toBe(b);
    const c = digestRequest({
      action: "prepare_brief",
      inputRefs: [{ kind: "transcript", id: "c1", revision: 2 }],
    });
    expect(c).not.toBe(a);
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
      taskTitle: "T",
    });
    expect(result.kind).toBe("not_claimed");
    expect(repo.calls).not.toContain("completeRun");
  });

  it("completes with artifact text, digest and input provenance refs", async () => {
    const repo = makeRepo({
      async claimRun() {
        return makeRun({
          status: "running",
          attempts: 1,
          inputSnapshot: {
            action: "prepare_brief",
            inputRefs: [{ kind: "transcript", id: "conv-1", revision: 3 }],
          },
        });
      },
    });
    const result = await executeCanonicalRun(repo, fakeProvider, {
      runId: "run-1",
      actorId: ACTOR,
      taskTitle: "T",
    });
    expect(result.kind).toBe("complete");
    if (result.kind === "complete") {
      expect(result.run.artifactDigest).toBe(digestArtifact("draft brief artifact"));
      expect(result.run.evidenceRefs).toEqual(["transcript:conv-1@3"]);
    }
  });

  it("marks the run failed on provider failure and never touches the task", async () => {
    const repo = makeRepo();
    const failing: CanonicalRunProvider = {
      async generate() {
        throw new Error("provider timeout");
      },
    };
    const result = await executeCanonicalRun(repo, failing, {
      runId: "run-1",
      actorId: ACTOR,
      taskTitle: "T",
    });
    expect(result.kind).toBe("failed");
    expect(repo.calls).toContain("failRun");
    expect(repo.calls).not.toContain("completeRun");
  });

  it("fails the run when an input becomes inaccessible after claiming", async () => {
    const repo = makeRepo({
      async claimRun() {
        return makeRun({
          status: "running",
          attempts: 1,
          inputSnapshot: {
            action: "prepare_brief",
            inputRefs: [{ kind: "transcript", id: "conv-1", revision: 3 }],
          },
        });
      },
      async readInput() {
        return null;
      },
    });
    const result = await executeCanonicalRun(repo, fakeProvider, {
      runId: "run-1",
      actorId: ACTOR,
      taskTitle: "T",
    });
    expect(result.kind).toBe("failed");
    expect(repo.calls).not.toContain("completeRun");
  });
});
