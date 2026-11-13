import { it, expect, vi, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  createTimedExecutionCandidate,
  createTimingRecorder,
  TIMING_POLICY_DIGEST,
  TimingFailure,
  type TimingDependencies,
  type TimingEvent,
} from "./studio-research-timing-candidate.server";
import { verifySignedJson } from "./studio-research-coordinator-authority.server";
import { digest } from "./studio-research-coordinator-contracts";
afterEach(() => vi.useRealTimers());
const defer = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(1000000);
  const controller = new AbortController();
  const events: TimingEvent[] = [];
  const complete = defer<{ value: string; immediateChildClosed: true }>();
  const started = defer<void>();
  const input = {
    attemptId: "44444444-4444-4444-8444-444444444444",
    priorRunId: "55555555-5555-4555-8555-555555555555",
    subjectId: "66666666-6666-4666-8666-666666666666",
    organizationId: "77777777-7777-4777-8777-777777777777",
    companyId: "88888888-8888-4888-8888-888888888888",
    projectId: "99999999-9999-4999-8999-999999999999",
    agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sourceDigest: "c".repeat(64),
    requestId: "11111111-1111-4111-8111-111111111111",
    issueId: "22222222-2222-4222-8222-222222222222",
    runId: "33333333-3333-4333-8333-333333333333",
    approvalDigest: "a".repeat(64),
    policyDigest: TIMING_POLICY_DIGEST,
    approvalExpiresAt: 1100000,
    invocationDeadline: 1060000,
    signal: controller.signal,
  };
  let claimed = false;
  const claims = vi.fn(() => {
    if (claimed) throw Error("consumed");
    claimed = true;
  });
  const stop = vi.fn(async () => ({ immediateChildClosed: true }));
  const d: TimingDependencies<{ synthetic: true }, string> = {
    now: Date.now,
    claim: claims,
    record: (e) => events.push(e),
    prepare: vi.fn(async () => ({ synthetic: true as const })),
    dispose: vi.fn(),
    admit: vi.fn(async () => {}),
    authorize: vi.fn(async () => ({
      approvalDigest: input.approvalDigest,
      checkedAt: Date.now(),
      expiresAt: input.approvalExpiresAt,
    })),
    spawn: vi.fn(() => ({ started: started.promise, completion: complete.promise, stop })),
  };
  const run = createTimedExecutionCandidate(d);
  return { d, run, input, controller, events, complete, started, stop, claims };
}
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}
it("separates slow preflight from spawn without extending total/provider deadline", async () => {
  const f = fixture();
  f.d.admit = async () => {
    await new Promise((r) => setTimeout(r, 6000));
  };
  const p = f.run(f.input);
  await vi.advanceTimersByTimeAsync(6000);
  expect(f.d.spawn).toHaveBeenCalledOnce();
  expect(vi.mocked(f.d.spawn).mock.calls[0]![2]).toEqual({
    launchDeadline: 1011000,
    providerDeadline: 1055000,
  });
  f.started.resolve();
  f.complete.resolve({ value: "synthetic", immediateChildClosed: true });
  expect(await p).toMatchObject({ value: "synthetic", providerRequests: null });
  expect(f.d.dispose).toHaveBeenCalledOnce();
  await expect(f.run(f.input)).rejects.toThrow("attempt_consumed");
});
it("retains the durable consumed claim across candidate instances", async () => {
  const f = fixture();
  f.controller.abort();
  await expect(f.run(f.input)).rejects.toThrow("attempt_not_current");
  expect(f.claims).not.toHaveBeenCalled();
  const fresh = { ...f.input, signal: new AbortController().signal };
  const p = f.run(fresh);
  await flush();
  f.started.resolve();
  f.complete.resolve({ value: "ok", immediateChildClosed: true });
  await p;
  await expect(createTimedExecutionCandidate(f.d)(fresh)).rejects.toThrow(
    "attempt_claim_unconfirmed",
  );
  expect(f.d.spawn).toHaveBeenCalledOnce();
});
it("rejects the old approved policy before any effect", async () => {
  const f = fixture();
  await expect(f.run({ ...f.input, policyDigest: "b".repeat(64) })).rejects.toThrow(
    "timing_policy_not_approved",
  );
  expect(f.claims).not.toHaveBeenCalled();
});
it("fails closed on ambiguous admission and sanitizes the reason", async () => {
  const f = fixture();
  f.d.admit = async () => {
    throw Error("PRIVATE_PROVIDER_KEY=secret");
  };
  const e = await f.run(f.input).catch((e) => e);
  expect(e).toMatchObject({ phase: "admission", code: "phase_failed", spawnAttempted: false });
  expect(f.d.spawn).not.toHaveBeenCalled();
  expect(JSON.stringify(f.events)).not.toContain("PRIVATE");
  expect(f.d.dispose).toHaveBeenCalledOnce();
});
it("preflight timeout consumes attempt and disposes a late preparation without spawning", async () => {
  const f = fixture(),
    late = defer<{ synthetic: true }>();
  f.d.prepare = () => late.promise;
  const result = f.run(f.input).catch((e) => e);
  await vi.advanceTimersByTimeAsync(20000);
  expect(await result).toMatchObject({ phase: "prepare", code: "deadline", spawnAttempted: false });
  late.resolve({ synthetic: true });
  await flush();
  expect(f.d.dispose).toHaveBeenCalledOnce();
  expect(f.d.spawn).not.toHaveBeenCalled();
});
it("rejects preparation settling exactly at the deadline and still disposes it", async () => {
  const f = fixture();
  f.d.prepare = async () => {
    vi.setSystemTime(1020000);
    return { synthetic: true };
  };
  const e = await f.run(f.input).catch((e) => e);
  expect(e.code).toBe("deadline");
  expect(f.d.dispose).toHaveBeenCalledOnce();
  expect(f.d.spawn).not.toHaveBeenCalled();
});
it("cancellation during final authority cannot spawn after a late success", async () => {
  const f = fixture(),
    late = defer<{ approvalDigest: string; checkedAt: number; expiresAt: number }>();
  f.d.authorize = () => late.promise;
  const result = f.run(f.input).catch((e) => e);
  await flush();
  f.controller.abort();
  expect(await result).toMatchObject({
    phase: "final_authority",
    code: "cancelled",
    spawnAttempted: false,
  });
  late.resolve({
    approvalDigest: f.input.approvalDigest,
    checkedAt: Date.now(),
    expiresAt: f.input.approvalExpiresAt,
  });
  await flush();
  expect(f.d.spawn).not.toHaveBeenCalled();
});
for (const kind of ["stale", "digest", "expired"])
  it(`rejects ${kind} final authority`, async () => {
    const f = fixture();
    f.d.authorize = async () => ({
      approvalDigest: kind === "digest" ? "b".repeat(64) : f.input.approvalDigest,
      checkedAt: Date.now() - (kind === "stale" ? 1 : 0),
      expiresAt: kind === "expired" ? Date.now() : f.input.approvalExpiresAt,
    });
    const e = await f.run(f.input).catch((e) => e);
    expect(e.code).toBe("authority_rejected");
    expect(f.d.spawn).not.toHaveBeenCalled();
  });
it("spawn acknowledgement timeout stops the exact handle once, without retry", async () => {
  const f = fixture();
  const result = f.run(f.input).catch((e) => e);
  await flush();
  await vi.advanceTimersByTimeAsync(5000);
  expect(await result).toMatchObject({
    phase: "launch",
    code: "deadline",
    spawnAttempted: true,
    stopEvidence: "immediate_child_closed",
  });
  expect(f.stop).toHaveBeenCalledOnce();
  expect(f.d.spawn).toHaveBeenCalledOnce();
});
it("provider completion is bounded by total deadline after preflight", async () => {
  const f = fixture();
  const result = f.run(f.input).catch((e) => e);
  await flush();
  f.started.resolve();
  await flush();
  await vi.advanceTimersByTimeAsync(55000);
  expect(await result).toMatchObject({ phase: "provider", code: "deadline" });
  expect(f.stop).toHaveBeenCalledOnce();
});
it("unknown stop evidence retains prepared files and cannot claim provider absence", async () => {
  const f = fixture();
  f.stop.mockResolvedValue({ immediateChildClosed: false });
  const result = f.run(f.input).catch((e) => e);
  await flush();
  f.controller.abort();
  const e = await result;
  expect(e).toMatchObject({ stopEvidence: "unverified", spawnAttempted: true });
  expect(f.d.dispose).not.toHaveBeenCalled();
  expect(f.events.every((e) => e.providerRequests === null)).toBe(true);
});
it("a hung stop remains bounded and records uncertainty", async () => {
  const f = fixture();
  f.stop.mockImplementation(() => new Promise(() => {}));
  const result = f.run(f.input).catch((e) => e);
  await flush();
  f.controller.abort();
  await vi.advanceTimersByTimeAsync(5000);
  expect(await result).toMatchObject({ stopEvidence: "unverified" });
  expect(f.d.dispose).not.toHaveBeenCalled();
});
it("missing durable spawn-intent evidence blocks execution", async () => {
  const f = fixture();
  f.d.record = (e) => {
    if (e.event === "spawn_intent") throw Error("disk");
    f.events.push(e);
  };
  const e = await f.run(f.input).catch((e) => e);
  expect(e).toMatchObject({
    code: "evidence_unavailable",
    spawnAttempted: false,
    evidenceRecorded: false,
  });
  expect(f.d.spawn).not.toHaveBeenCalled();
});
it("signed phase receipts are bound, sequenced and linked without hook values", () => {
  const f = fixture();
  const keys = generateKeyPairSync("ed25519"),
    tokens: string[] = [];
  const { policyDigest, approvalExpiresAt, invocationDeadline, signal, ...binding } = f.input;
  const record = createTimingRecorder(keys.privateKey, binding, (s) => tokens.push(s));
  const e: TimingEvent = {
    phase: "prepare",
    event: "begin",
    at: 1000000,
    totalDeadline: 1055000,
    phaseDeadline: 1020000,
    providerRequests: null,
  };
  record(e);
  record({ ...e, event: "complete" });
  const a = verifySignedJson(keys.publicKey, tokens[0]) as Record<string, unknown>,
    b = verifySignedJson(keys.publicKey, tokens[1]) as Record<string, unknown>;
  expect(a).toMatchObject({
    sequence: 0,
    previousDigest: null,
    policyDigest: TIMING_POLICY_DIGEST,
  });
  expect(b).toMatchObject({ sequence: 1, previousDigest: digest(tokens[0]) });
  expect(b["binding"]).toEqual(binding);
});

it("recorder rejects extra properties instead of signing possible secrets", () => {
  const f = fixture(),
    keys = generateKeyPairSync("ed25519"),
    append = vi.fn();
  const { policyDigest, approvalExpiresAt, invocationDeadline, signal, ...binding } = f.input;
  const record = createTimingRecorder(keys.privateKey, binding, append);
  expect(() =>
    record({
      phase: "prepare",
      event: "begin",
      at: 1000000,
      totalDeadline: 1055000,
      phaseDeadline: 1020000,
      providerRequests: null,
      secret: "never sign this",
    } as TimingEvent),
  ).toThrow();
  expect(append).not.toHaveBeenCalled();
});
it("total elapsed timer still bounds the call if the wall clock moves backward", async () => {
  const f = fixture();
  const result = f.run(f.input).catch((e) => e);
  await flush();
  f.started.resolve();
  await flush();
  vi.setSystemTime(900000);
  await vi.advanceTimersByTimeAsync(55000);
  expect(await result).toMatchObject({ phase: "provider", code: "deadline" });
  expect(f.stop).toHaveBeenCalledOnce();
});
it("cleanup failure is reported instead of returning a successful result", async () => {
  const f = fixture();
  f.d.dispose = () => {
    throw Error("secret path");
  };
  const result = f.run(f.input).catch((e) => e);
  await flush();
  f.started.resolve();
  f.complete.resolve({ value: "ok", immediateChildClosed: true });
  const e = await result;
  expect(e).toBeInstanceOf(TimingFailure);
  expect(e).toMatchObject({
    phase: "cleanup",
    code: "phase_failed",
    stopEvidence: "immediate_child_closed",
  });
  expect(JSON.stringify(f.events)).not.toContain("secret path");
});

it("cleanup crossing total deadline cannot return success or lose observed closure", async () => {
  const f = fixture();
  f.d.dispose = () => {
    vi.setSystemTime(f.input.invocationDeadline);
  };
  f.stop.mockRejectedValue(Error("stop unavailable"));
  const result = f.run(f.input).catch((e) => e);
  await flush();
  f.started.resolve();
  f.complete.resolve({ value: "ok", immediateChildClosed: true });
  expect(await result).toMatchObject({ code: "deadline", stopEvidence: "immediate_child_closed" });
});
