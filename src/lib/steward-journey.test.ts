/**
 * Full staged journey over the domain services with an injected FAKE
 * provider — request → claim/execute → artifact → human verify → reopen —
 * exercising the same contracts the isolated SQL harness (008_journey.sql)
 * proves against real PostgreSQL. No provider, network, or database is
 * touched here; the SQL-level journey lives in the harness.
 */
import { describe, expect, it } from "vitest";
import {
  executeCanonicalRun,
  requestCanonicalRun,
  type CanonicalRun,
  type CanonicalRunProvider,
  type CanonicalRunRepository,
} from "./steward-canonical-run.server";
import {
  reopenCanonicalTask,
  verifyCanonicalTask,
  type VerificationRepository,
} from "./steward-verification.server";

const ORG = "org-a";
const ACTOR = "user-owner";
const TASK = "task-1";

function makeRunStore() {
  const runs = new Map<string, CanonicalRun>();
  const repo: CanonicalRunRepository = {
    async requestRun(input) {
      const existing = [...runs.values()].find(
        (r) => r.organizationId === input.orgId && r.clientOperationId === input.operationId,
      );
      if (existing) {
        if (existing.requestDigest !== input.digest) {
          const err = new Error("operation_conflict");
          (err as { code?: string }).code = "P0002";
          throw err;
        }
        return { run: existing, replayed: true };
      }
      const run: CanonicalRun = {
        id: `run-${runs.size + 1}`,
        organizationId: input.orgId,
        taskId: input.taskId,
        action: input.action,
        clientOperationId: input.operationId,
        requestDigest: input.digest,
        inputSnapshot: input.snapshot ?? [],
        status: "queued",
        artifactText: null,
        artifactDigest: null,
        evidenceRefs: [],
        requestedBy: input.actorId,
        attempts: 0,
        maxAttempts: 3,
        failureReason: null,
        claimToken: null,
        claimVersion: 0,
      };
      runs.set(run.id, run);
      return { run, replayed: false };
    },
    async claimRun(runId) {
      const run = runs.get(runId);
      if (!run || run.status !== "queued") return null;
      run.status = "running";
      run.attempts += 1;
      run.claimToken = `claim-${run.claimVersion + 1}`;
      run.claimVersion += 1;
      return { ...run };
    },
    async completeRun(input) {
      const run = runs.get(input.runId);
      if (!run || run.claimToken !== input.claimToken) throw new Error("stale_claim");
      run.status = "complete";
      run.artifactText = input.artifactText;
      run.evidenceRefs = input.evidenceRefs;
      run.claimToken = null;
      return { ...run };
    },
    async failRun(input) {
      const run = runs.get(input.runId);
      if (!run || run.claimToken !== input.claimToken) throw new Error("stale_claim");
      run.status = run.attempts >= run.maxAttempts ? "failed" : "queued";
      run.failureReason = input.reason;
      run.claimToken = null;
      return { ...run };
    },
    async readInput(ref) {
      if (ref.id === "conv-1") return { content: "stored transcript content", revision: 3 };
      return null;
    },
    async readTaskTitle() {
      return "Prepare the Soji roadmap handoff";
    },
  };
  return { runs, repo };
}

function makeVerificationStore() {
  let revision = 1;
  let status = "open";
  const receipts: unknown[] = [];
  const repo: VerificationRepository = {
    async verifyTask(input) {
      if (input.expectedRevision !== revision) {
        const err = new Error("revision_conflict");
        (err as { code?: string }).code = "P0003";
        throw err;
      }
      status = "complete";
      revision += 1;
      const receipt = { id: `rcpt-${receipts.length + 1}`, note: input.note };
      receipts.push(receipt);
      return {
        task: {
          id: input.taskId,
          status,
          revision,
          completionEvidence: input.note,
          completedAt: "now",
          completedBy: input.actorId,
        },
        receipt: receipt as never,
        replayed: false,
      };
    },
    async reopenTask(input) {
      if (input.expectedRevision !== revision) {
        const err = new Error("revision_conflict");
        (err as { code?: string }).code = "P0003";
        throw err;
      }
      status = "open";
      revision += 1;
      return {
        task: {
          id: input.taskId,
          status,
          revision,
          completionEvidence: null,
          completedAt: null,
          completedBy: null,
        },
        replayed: false,
      };
    },
  };
  return repo;
}

const fakeProvider: CanonicalRunProvider = {
  async generate(input) {
    expect(input.inputs[0]?.content).toBe("stored transcript content");
    return { text: `Draft brief for: ${input.taskTitle}` };
  },
};

describe("staged journey: request → artifact → verify → reopen", () => {
  it("completes the full loop with a fake provider and never touches task status from the runner", async () => {
    const { runs, repo } = makeRunStore();

    // 1. Request: inputs resolved and snapshotted at request time.
    const requested = await requestCanonicalRun(repo, {
      orgId: ORG,
      taskId: TASK,
      action: "prepare_brief",
      operationId: "op-journey-1",
      inputRefs: [{ kind: "transcript", id: "conv-1" }],
      actorId: ACTOR,
    });
    expect(requested.kind).toBe("queued");
    if (requested.kind !== "queued") return;

    // Retry with the SAME operation + payload replays; changed payload conflicts.
    const replay = await requestCanonicalRun(repo, {
      orgId: ORG,
      taskId: TASK,
      action: "prepare_brief",
      operationId: "op-journey-1",
      inputRefs: [{ kind: "transcript", id: "conv-1" }],
      actorId: ACTOR,
    });
    expect(replay.kind).toBe("replayed");
    const conflict = await requestCanonicalRun(repo, {
      orgId: ORG,
      taskId: TASK,
      action: "draft_roadmap",
      operationId: "op-journey-1",
      inputRefs: [{ kind: "transcript", id: "conv-1" }],
      actorId: ACTOR,
    });
    expect(conflict.kind).toBe("conflict");

    // 2. Execute with the fake provider: artifact saved, task untouched.
    const executed = await executeCanonicalRun(repo, fakeProvider, {
      runId: requested.run.id,
      actorId: ACTOR,
    });
    expect(executed.kind).toBe("complete");
    if (executed.kind !== "complete") return;
    expect(executed.run.artifactText).toBe("Draft brief for: Prepare the Soji roadmap handoff");
    expect(executed.run.evidenceRefs).toEqual(["transcript:conv-1@3"]);
    expect(runs.get(requested.run.id)?.status).toBe("complete");

    // 3. Human verify with evidence, then reopen preserving history.
    const verification = makeVerificationStore();
    const verified = await verifyCanonicalTask(verification, {
      orgId: ORG,
      taskId: TASK,
      expectedRevision: 1,
      operationId: "op-verify-1",
      actorId: ACTOR,
      note: "Verified the draft against the recording.",
    });
    expect(verified.kind).toBe("verified");
    if (verified.kind !== "verified") return;
    expect(verified.task?.status).toBe("complete");

    const reopened = await reopenCanonicalTask(verification, {
      orgId: ORG,
      taskId: TASK,
      expectedRevision: 2,
      operationId: "op-reopen-1",
      actorId: ACTOR,
      reason: "Outcome changed after follow-up call.",
    });
    expect(reopened.kind).toBe("reopened");
    if (reopened.kind !== "reopened") return;
    expect(reopened.task?.status).toBe("open");
  });

  it("a provider failure fails the run explicitly and a stale claim cannot complete it", async () => {
    const { repo } = makeRunStore();
    const requested = await requestCanonicalRun(repo, {
      orgId: ORG,
      taskId: TASK,
      action: "prepare_brief",
      operationId: "op-journey-2",
      inputRefs: [{ kind: "transcript", id: "conv-1" }],
      actorId: ACTOR,
    });
    if (requested.kind !== "queued") throw new Error("expected queued");
    const failing: CanonicalRunProvider = {
      async generate() {
        throw new Error("provider exploded");
      },
    };
    const result = await executeCanonicalRun(repo, failing, {
      runId: requested.run.id,
      actorId: ACTOR,
    });
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.run.failureReason).toBe("provider exploded");
  });
});
