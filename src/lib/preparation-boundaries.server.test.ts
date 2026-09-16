/**
 * The boundaries R1 exists for.
 *
 * Every test here is a way the runner could quietly do the wrong thing:
 * hand a cached answer to somebody who lost access, let two copies of one
 * event both call the model, overrun a daily limit, leave a crashed run
 * "Preparing" for ever, keep work prepared from something that has since
 * moved, or call a failed save a success.
 */

import { describe, expect, it, vi } from "vitest";

import {
  sandboxConversationRead,
  sandboxModel,
  sandboxPolicy,
  sandboxRequest,
  sandboxStore,
} from "@/data/fixtures/preparation-sandbox";
import { PREPARATION_LEASE_MS } from "@/domain/preparation-claim";
import type { PreparationOutput } from "@/domain/preparation-jobs";
import {
  PreparationAccessDenied,
  runPreparation,
  type PreparationStore,
} from "@/lib/preparation-runner.server";

const allow = async () => true;
const at = (iso: string) => () => new Date(iso);
const request = sandboxRequest("conversation_summary", { subjectRef: "fixture-thread-0001" });

function run(overrides: Partial<Parameters<typeof runPreparation>[0]> = {}) {
  return runPreparation({
    request,
    policy: sandboxPolicy(["conversation_summary"]),
    store: sandboxStore(),
    token: "sandbox-token",
    currentInputRevision: "rev-1",
    deterministic: () => sandboxConversationRead(),
    verifyAccess: allow,
    callModel: sandboxModel({ summary: "Prepared once.", suggestions: [] }),
    now: at("2026-09-16T10:00:00.000Z"),
    ...overrides,
  });
}

describe("access is proved before anything is read or returned", () => {
  it("does not hand back a cached answer after access was revoked", async () => {
    const store = sandboxStore();
    const prepared = await run({ store });
    expect(prepared.status).toBe("prepared");

    const load = vi.spyOn(store, "load");
    await expect(run({ store, verifyAccess: async () => false })).rejects.toBeInstanceOf(
      PreparationAccessDenied,
    );
    expect(load).not.toHaveBeenCalled();
    expect(store.all()[0]?.status).toBe("prepared");
  });

  it("refuses a subject that belongs to another workspace and leaves no mark", async () => {
    const store = sandboxStore();
    await expect(
      run({ store, verifySubject: async () => false }),
    ).rejects.toBeInstanceOf(PreparationAccessDenied);
    expect(store.all()).toHaveLength(0);
  });

  it("will not read one workspace's record from another workspace", async () => {
    const store = sandboxStore();
    await run({ store });
    expect(await store.load(store.all()[0]!.key, "org-somebody-else")).toBeNull();
  });
});

describe("one claim per attempt", () => {
  it("calls the model once when the same event arrives twice at the same moment", async () => {
    const store = sandboxStore();
    const model = vi.fn(sandboxModel({ summary: "Once.", suggestions: [] }));
    const [a, b] = await Promise.all([run({ store, callModel: model }), run({ store, callModel: model })]);
    expect(model).toHaveBeenCalledTimes(1);
    expect(store.all()).toHaveLength(1);
    expect([a.status, b.status].filter((status) => status === "prepared")).toHaveLength(1);
    expect([a.status, b.status]).toContain("running");
  });

  it("will not write over a record another attempt holds", async () => {
    const store = sandboxStore();
    await run({ store });
    const held = store.all()[0]!;
    await expect(
      store.complete({ ...held, status: "prepared", summary: "Forged." }, "someone-else"),
    ).rejects.toThrow("Another attempt holds this record");
  });
});

describe("limits hold under concurrency", () => {
  it("refuses once the workspace limit is reached", async () => {
    const store = sandboxStore();
    vi.spyOn(store, "countToday").mockResolvedValue(200);
    const output = await run({ store });
    expect(output.status).toBe("could_not_finish");
    expect(output.persisted).toBe(false);
    expect(output.because).toContain("limit");
  });

  it("stops a run that only went over the limit after it was claimed", async () => {
    const store = sandboxStore();
    const counts = vi.spyOn(store, "countToday");
    counts.mockResolvedValueOnce(0).mockResolvedValueOnce(0); // before the claim
    counts.mockResolvedValue(999); // another job claimed at the same moment
    const model = vi.fn(sandboxModel({ summary: "Must not run.", suggestions: [] }));
    const output = await run({ store, callModel: model });
    expect(model).not.toHaveBeenCalled();
    expect(output.status).toBe("could_not_finish");
    expect(output.because).toContain("limit");
  });
});

describe("a crashed worker leaves something recoverable", () => {
  it("refuses while the lease holds and picks the work up once it has passed", async () => {
    const store = sandboxStore();
    const crashed: PreparationOutput = {
      key: [request.organizationId, request.jobId, request.subjectRef, request.inputRevision].join("::"),
      request,
      status: "running",
      summary: "",
      suggestions: [],
      evidenceRefs: [],
      figures: {},
      ownerLabel: "Relationship owner",
      attempts: 1,
      attemptId: "attempt-crashed",
      leaseUntil: "2026-09-16T10:05:00.000Z",
      startedAt: "2026-09-16T10:00:00.000Z",
    };
    await store.claim({
      key: crashed.key,
      request,
      attemptId: "attempt-crashed",
      nowIso: "2026-09-16T10:00:00.000Z",
      leaseUntil: "2026-09-16T10:05:00.000Z",
      maxAttempts: 3,
      ownerLabel: "Relationship owner",
    });

    const held = await run({ store, now: at("2026-09-16T10:01:00.000Z") });
    expect(held.status).toBe("running");
    expect(held.persisted).toBe(false);

    const recovered = await run({
      store,
      now: at(new Date(Date.parse("2026-09-16T10:00:00.000Z") + PREPARATION_LEASE_MS + 1000).toISOString()),
    });
    expect(recovered.status).toBe("prepared");
    expect(recovered.attempts).toBe(2);
  });
});

describe("what changed while it was running", () => {
  it("does not keep work prepared from a version that has since moved", async () => {
    const output = await run({ reloadRevision: async () => "rev-2" });
    expect(output.status).toBe("could_not_finish");
    expect(output.because).toContain("changed while this was being prepared");
    expect(output.summary).toBe("");
  });

  it("stops when the workspace switched preparation off mid-run", async () => {
    const output = await run({
      reloadPolicy: async () => ({ ...sandboxPolicy(["conversation_summary"]), stopSwitch: true }),
    });
    expect(output.status).toBe("cancelled");
    expect(output.because).toContain("switched off");
  });

  it("does not keep work prepared after access ended mid-run", async () => {
    let calls = 0;
    const output = await run({
      verifyAccess: async () => {
        calls += 1;
        return calls === 1;
      },
    });
    expect(output.status).toBe("could_not_finish");
    expect(output.because).toContain("Access to this workspace ended");
  });
});

describe("an honest receipt", () => {
  it("never calls a failed save a success", async () => {
    const store = sandboxStore();
    const broken: PreparationStore = {
      load: store.load,
      claim: store.claim,
      countToday: store.countToday,
      complete: async () => {
        throw new Error("the database refused the write");
      },
    };
    const output = await run({ store: broken });
    expect(output.persisted).toBe(false);
    expect(output.because).toContain("could not be saved");
  });

  it("records the provider, the instructions hash and the revision it read", async () => {
    const output = await run();
    expect(output.persisted).toBe(true);
    expect(output.modelUse?.provider).toBe("sandbox");
    expect(output.modelUse?.instructionsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(output.modelUse?.inputRevision).toBe("rev-1");
    expect(output.modelUse?.inputTokens).toBeUndefined();
  });
});
