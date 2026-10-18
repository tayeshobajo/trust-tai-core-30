import { describe, expect, it } from "vitest";
import {
  reopenCanonicalTask,
  verifyCanonicalTask,
  type VerificationRepository,
} from "./steward-verification.server";

const BASE = {
  orgId: "org-a",
  taskId: "task-1",
  expectedRevision: 2,
  operationId: "op-1",
  actorId: "user-owner",
};

function makeRepo(overrides: Partial<VerificationRepository> = {}): VerificationRepository {
  return {
    async verifyTask(input) {
      return {
        task: {
          id: input.taskId,
          status: "complete",
          revision: input.expectedRevision + 1,
          completionEvidence: input.note,
          completedAt: "now",
          completedBy: input.actorId,
        },
        receipt: {
          id: "rcpt-1",
          kind: "verify",
          organizationId: input.orgId,
          taskId: input.taskId,
          operationId: input.operationId,
          note: input.note,
          actorId: input.actorId,
          createdAt: "now",
          taskRevisionAfter: input.expectedRevision + 1,
        },
        replayed: false,
      };
    },
    async reopenTask(input) {
      return {
        task: {
          id: input.taskId,
          status: "open",
          revision: input.expectedRevision + 1,
          completionEvidence: null,
          completedAt: null,
          completedBy: null,
        },
        replayed: false,
      };
    },
    ...overrides,
  };
}

describe("verifyCanonicalTask", () => {
  it("rejects a short evidence note before calling the repository", async () => {
    let called = false;
    const repo = makeRepo({
      async verifyTask(input) {
        called = true;
        return {
          task: {
            id: input.taskId,
            status: "complete",
            revision: 3,
            completionEvidence: input.note,
            completedAt: "now",
            completedBy: input.actorId,
          },
          receipt: {
            id: "r",
            kind: "verify",
            organizationId: input.orgId,
            taskId: input.taskId,
            operationId: input.operationId,
            note: input.note,
            actorId: input.actorId,
            createdAt: "now",
            taskRevisionAfter: input.expectedRevision + 1,
          },
          replayed: false,
        };
      },
    });
    const result = await verifyCanonicalTask(repo, { ...BASE, note: "done" });
    expect(result.kind).toBe("evidence_required");
    expect(called).toBe(false);
  });

  it("returns verified with receipt on success", async () => {
    const result = await verifyCanonicalTask(makeRepo(), {
      ...BASE,
      note: "Reviewed the recorded outcome against the source.",
    });
    expect(result.kind).toBe("verified");
    if (result.kind === "verified") {
      expect(result.task?.status).toBe("complete");
      expect(result.task?.revision).toBe(3);
      expect(result.receipt.operationId).toBe("op-1");
    }
  });

  it("maps a revision conflict from the repository", async () => {
    const repo = makeRepo({
      async verifyTask() {
        const e = new Error("revision_conflict") as Error & { code: string };
        e.code = "P0001";
        throw e;
      },
    });
    const result = await verifyCanonicalTask(repo, {
      ...BASE,
      note: "Reviewed the recorded outcome.",
    });
    expect(result.kind).toBe("revision_conflict");
  });

  it("surfaces replayed receipts for duplicate operations", async () => {
    const repo = makeRepo({
      async verifyTask(input) {
        return {
          task: {
            id: input.taskId,
            status: "complete",
            revision: 3,
            completionEvidence: input.note,
            completedAt: "now",
            completedBy: input.actorId,
          },
          receipt: {
            id: "rcpt-1",
            kind: "verify",
            organizationId: input.orgId,
            taskId: input.taskId,
            operationId: input.operationId,
            note: input.note,
            actorId: input.actorId,
            createdAt: "now",
            taskRevisionAfter: input.expectedRevision + 1,
          },
          replayed: true,
        };
      },
    });
    const result = await verifyCanonicalTask(repo, {
      ...BASE,
      note: "Reviewed the recorded outcome.",
    });
    expect(result.kind).toBe("verified");
    if (result.kind === "verified") expect(result.replayed).toBe(true);
  });
});

describe("reopenCanonicalTask", () => {
  it("requires a substantive reopen reason", async () => {
    const result = await reopenCanonicalTask(makeRepo(), { ...BASE, reason: "no" });
    expect(result.kind).toBe("evidence_required");
  });

  it("reopens with revision bump on success", async () => {
    const result = await reopenCanonicalTask(makeRepo(), {
      ...BASE,
      reason: "Evidence was insufficient on review.",
    });
    expect(result.kind).toBe("reopened");
    if (result.kind === "reopened") {
      expect(result.task?.status).toBe("open");
      expect(result.task?.revision).toBe(3);
    }
  });
});

describe("durable result preservation", () => {
  it("a failed post-commit task reread does not erase a durable verify result", async () => {
    const repo = makeRepo({
      async verifyTask(input) {
        return {
          task: null, // RLS reread failed after the RPC committed
          receipt: {
            id: "rcpt-1",
            kind: "verify",
            organizationId: input.orgId,
            taskId: input.taskId,
            operationId: input.operationId,
            note: input.note,
            actorId: input.actorId,
            createdAt: "now",
            taskRevisionAfter: input.expectedRevision + 1,
          },
          replayed: true,
        };
      },
    });
    const result = await verifyCanonicalTask(repo, {
      ...BASE,
      note: "Verified against the recording.",
    });
    expect(result.kind).toBe("verified");
    if (result.kind === "verified") {
      expect(result.task).toBeNull();
      expect(result.replayed).toBe(true);
      expect(result.receipt.id).toBe("rcpt-1");
    }
  });
});
