import { attemptInvocationDeadline } from "../../packages/studio-research-coordinator/src/timing-preview";
import { it, expect, afterEach, vi } from "vitest";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoordinatorStore } from "./studio-research-coordinator-store.server";
import { AttemptStore } from "./studio-research-attempt-store.server";
import {
  COORDINATOR,
  approvalSchema,
  digest,
  PROMPT_POLICY_SHA256,
  COMPOSITION_POLICY_SHA256,
} from "./studio-research-coordinator-contracts";
import {
  parseAttemptApproval,
  attemptBinding,
  verifyPhaseChain,
} from "./studio-research-attempt-contracts.server";
import { TIMING_POLICY_DIGEST } from "./studio-research-timing-candidate.server";
import { createAttemptCoordinator } from "./studio-research-attempt-coordinator.server";
import {
  createAttemptCallback,
  initialAttemptState,
  reduceAttemptPacket,
  signAttemptPacket,
  packetV2Schema,
} from "./studio-research-attempt-callback.server";
import { verifySignedJson } from "./studio-research-coordinator-authority.server";
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((f) => f());
  vi.useRealTimers();
});
function signed(value: unknown, key: ReturnType<typeof generateKeyPairSync>["privateKey"]) {
  const bytes = Buffer.from(JSON.stringify(value));
  return bytes.toString("base64url") + "." + sign(null, bytes, key).toString("base64url");
}
function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(1000000);
  const keys = generateKeyPairSync("ed25519"),
    root = mkdtempSync(join(tmpdir(), "attempt-v2-")),
    path = join(root, "ledger.sqlite");
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const old = approvalSchema.parse({
    version: 1,
    promptPolicySha256: PROMPT_POLICY_SHA256,
    executionPolicySha256: COMPOSITION_POLICY_SHA256,
    request: {
      requestId: "22222222-2222-4222-8222-222222222222",
      organizationId: COORDINATOR.organizationId,
      topic: "IANA example domains",
    },
    companyId: COORDINATOR.companyId,
    projectId: COORDINATOR.projectId,
    agentId: COORDINATOR.agentId,
    approvedBy: "11111111-1111-4111-8111-111111111111",
    approvedAt: 1000,
    expiresAt: 10000,
    approvedUrls: ["https://www.iana.org/help/example-domains"],
    issueId: "33333333-3333-4333-8333-333333333333",
    primaryModel: COORDINATOR.model,
    auxiliaryModel: COORDINATOR.model,
    endpoint: COORDINATOR.endpoint,
    nativeTools: "deny",
    maxProviderRequests: null,
    maxCliJobs: 1,
    timeoutMs: 60000,
    draftRequested: false,
    voiceExamples: [],
  });
  const priorRunId = "44444444-4444-4444-8444-444444444444";
  const legacy = new CoordinatorStore(path);
  let job = legacy.create(old);
  job = legacy.transition(job, "collecting", { runId: priorRunId })!;
  job = legacy.transition(job, "uncertain", { reason: "original_uncertainty" })!;
  const historical = JSON.stringify(job);
  legacy.close();
  const a = parseAttemptApproval({
    version: 2,
    attemptId: "55555555-5555-4555-8555-555555555555",
    runId: "66666666-6666-4666-8666-666666666666",
    priorRunId,
    nonce: "77777777-7777-4777-8777-777777777777",
    sessionId: "ses_88888888-8888-4888-8888-888888888888",
    historicalApproval: old,
    subjectId: old.approvedBy,
    approvedAt: 1000000,
    expiresAt: 1100000,
    policyDigest: TIMING_POLICY_DIGEST,
    duplicateCostAccepted: true,
  });
  const store = new AttemptStore(path, keys.publicKey);
  cleanup.push(() => store.close());
  store.provision(signed(a, keys.privateKey), keys.publicKey, digest(a), Date.now());
  let state = initialAttemptState();
  const packets: string[] = [];
  const callback = createAttemptCallback({
    peerKey: keys.publicKey,
    now: Date.now,
    authorizeCurrent: async () => {},
    repository: {
      read: async () => ({ approval: a, state }),
      commit: async (_id, rev, next, token) => {
        if (state.revision !== rev) throw Error("conflict");
        state = next;
        packets.push(token);
      },
    },
  });
  const text = "IANA reserves example domains for documentation.";
  const evidence = [
    {
      url: old.approvedUrls[0]!,
      title: "IANA",
      text,
      sha256: createHash("sha256").update(text).digest("hex"),
      retrievedAt: new Date(Date.now()).toISOString(),
      publishedAt: null,
    },
  ];
  const result = JSON.stringify({
    research: {
      version: 1,
      requestId: old.request.requestId,
      topics: [],
      limitations: ["Synthetic test only."],
    },
    people: [],
    draft: null,
  });
  const spawn = vi.fn(() => ({
    started: Promise.resolve(),
    completion: Promise.resolve({
      value: { text: result, nativeSessionId: "synthetic-native", bindingDigest: "b".repeat(64) },
      immediateChildClosed: true as const,
    }),
    stop: async () => ({ immediateChildClosed: true }),
  }));
  const deps = {
    approval: a,
    pinnedApprovalDigest: digest(a),
    store,
    signer: keys.privateKey,
    now: Date.now,
    collect: async () => evidence,
    runtime: { prepare: async () => ({ bindingDigest: "b".repeat(64) }), dispose: vi.fn(), spawn },
    callback: async (id: string, token: string) => callback(id, token),
    authority: async (_a: unknown, admissionDigest: string) => ({
      bindingDigest: digest(attemptBinding(a)),
      admissionDigest,
      approvalDigest: digest(a),
      checkedAt: Date.now(),
      expiresAt: a.expiresAt,
    }),
  };
  return {
    a,
    keys,
    store,
    path,
    historical,
    deps,
    spawn,
    packets,
    state: () => state,
    run: (deadline = 1060000) =>
      createAttemptCoordinator(deps).run(deadline, new AbortController().signal),
  };
}
it("completes the synthetic v2 path once with durable receipts, while preserving historical uncertainty", async () => {
  const f = fixture();
  expect(await f.run()).toMatchObject({
    version: 2,
    status: "ready",
    receiptCount: 12,
    providerRequests: null,
  });
  expect(f.spawn).toHaveBeenCalledOnce();
  expect(f.store.outcome(f.a.attemptId)).toBe("complete");
  expect(verifyPhaseChain(f.store.tokens(f.a.attemptId), f.keys.publicKey, f.a).complete).toBe(
    true,
  );
  await expect(f.run()).rejects.toThrow();
  expect(f.spawn).toHaveBeenCalledOnce();
  const legacy = new CoordinatorStore(f.path);
  expect(JSON.stringify(legacy.read(f.a.historicalApproval.request.requestId))).toBe(f.historical);
  legacy.close();
});
it("accepts only exact duplicate receipts and packets, rejects conflicting sequence and tampering", async () => {
  const f = fixture();
  await f.run();
  const tokens = f.store.tokens(f.a.attemptId);
  f.store.append(f.a.attemptId, tokens[0]!);
  expect(f.store.tokens(f.a.attemptId)).toHaveLength(12);
  const packet = f.packets[1]!;
  expect(reduceAttemptPacket(f.a, f.state(), packet, f.keys.publicKey, Date.now())).toBe(f.state());
  const phase = verifySignedJson(f.keys.publicKey, tokens[0]) as object;
  expect(() =>
    verifyPhaseChain([signed({ ...phase, sequence: 1 }, f.keys.privateKey)], f.keys.publicKey, f.a),
  ).toThrow();
  expect(() =>
    verifyPhaseChain([tokens[0]!.slice(0, -5) + "aaaaa"], f.keys.publicKey, f.a),
  ).toThrow();
});
it("rejects wrong version, subject, source, expiry and terminal late results", async () => {
  const f = fixture();
  await f.run();
  const p = packetV2Schema.parse(verifySignedJson(f.keys.publicKey, f.packets[1]));
  for (const mutation of [
    { domain: "studio-attempt-callback/v1" },
    { binding: { ...p.binding, subjectId: f.a.attemptId } },
    { binding: { ...p.binding, sourceDigest: "f".repeat(64) } },
    { expiresAt: Date.now() },
    { issuedAt: Date.now() + 1 },
  ]) {
    expect(() =>
      reduceAttemptPacket(
        f.a,
        f.state(),
        signed({ ...p, ...mutation }, f.keys.privateKey),
        f.keys.publicKey,
        Date.now(),
      ),
    ).toThrow();
  }
  expect(() => parseAttemptApproval({ ...f.a, version: 1 })).toThrow();
});
it("fresh authority for a different admission blocks spawn and records uncertainty", async () => {
  const f = fixture();
  const original = f.deps.authority;
  f.deps.authority = async (a, ad) => ({ ...(await original(a, ad)), admissionDigest: "bad" });
  await expect(f.run()).rejects.toThrow("attempt_uncertain");
  expect(f.spawn).not.toHaveBeenCalled();
  expect(f.store.outcome(f.a.attemptId)).toBe("uncertain");
  expect(f.state().terminal).toBe("uncertain");
});
it("rejects an unapproved claim and a second approval against the same historical run", () => {
  const f = fixture();
  expect(() =>
    f.store.claim({ ...attemptBinding(f.a), attemptId: f.a.runId }, Date.now()),
  ).toThrow();
  const a = { ...f.a, attemptId: f.a.runId };
  expect(() =>
    f.store.provision(signed(a, f.keys.privateKey), f.keys.publicKey, digest(a), Date.now()),
  ).toThrow();
});

it("clips execution to earlier host admission expiry and retains one stop/attempt", async () => {
  const f = fixture();
  const stop = vi.fn(async () => ({ immediateChildClosed: true }));
  f.spawn.mockImplementation(() => ({
    started: Promise.resolve(),
    completion: new Promise(() => {}),
    stop,
  }));
  const outcome = f.run(attemptInvocationDeadline(1060000, 1009000)).catch((e) => e);
  await vi.advanceTimersByTimeAsync(4000);
  expect(await outcome).toBeInstanceOf(Error);
  expect(stop).toHaveBeenCalledOnce();
  expect(f.spawn).toHaveBeenCalledOnce();
  expect(
    verifyPhaseChain(f.store.tokens(f.a.attemptId), f.keys.publicKey, f.a).receipts[0]
      ?.totalDeadline,
  ).toBe(1004000);
});
it("lost admission acknowledgement consumes attempt without spawning or retrying", async () => {
  const f = fixture(),
    send = f.deps.callback;
  let calls = 0;
  f.deps.callback = async (id, token) => {
    calls++;
    await send(id, token);
    throw Error("lost ack");
  };
  await expect(f.run()).rejects.toThrow("attempt_uncertain");
  expect(f.spawn).not.toHaveBeenCalled();
  expect(calls).toBe(1);
  expect(f.state().admission).not.toBeNull();
  expect(f.store.outcome(f.a.attemptId)).toBe("uncertain");
});
it("lost result acknowledgement preserves CMD ready and host uncertain evidence", async () => {
  const f = fixture(),
    send = f.deps.callback;
  let calls = 0;
  f.deps.callback = async (id, token) => {
    const result = await send(id, token);
    if (++calls === 2) throw Error("lost ack");
    return result;
  };
  await expect(f.run()).rejects.toThrow("attempt_uncertain");
  expect(calls).toBe(2);
  expect(f.spawn).toHaveBeenCalledOnce();
  expect(f.state().terminal).toBe("ready");
  expect(f.store.outcome(f.a.attemptId)).toBe("uncertain");
});

// Successor tests use only synthetic keys and isolated local ledgers.
it("reserves one successor, freezes the untouched predecessor and preserves immutable history across restart", () => {
  const f = fixture();
  vi.setSystemTime(f.a.expiresAt + 1);
  const next = successor(f.a);
  const host = new AttemptStore(f.path, f.keys.publicKey, 3);
  cleanup.push(() => host.close());
  const token = signed(next, f.keys.privateKey);
  const reservation = host.provisionSuccessor(
    token,
    f.keys.publicKey,
    digest(next),
    f.keys.privateKey,
    Date.now,
  );
  expect(host.reservation(next.attemptId)).toBe(reservation);
  expect(() =>
    host.provisionSuccessor(token, f.keys.publicKey, digest(next), f.keys.privateKey, Date.now),
  ).toThrow();
  expect(() => f.store.cancel(f.a.attemptId, Date.now())).toThrow(/frozen/);
  expect(() => f.store.settle(f.a.attemptId, "uncertain", Date.now())).toThrow(/frozen/);
  expect(() => f.store.claim(attemptBinding(f.a), Date.now())).toThrow(/expired/);
  const checked = verifySuccessorRegistration({
    approvalToken: token,
    reservationToken: reservation,
    pinnedApprovalDigest: digest(next),
    studioKey: f.keys.publicKey,
    hostKey: f.keys.publicKey,
    predecessor: f.a,
    predecessorState: initialAttemptState(),
    now: Date.now(),
  });
  expect(checked.approval).toEqual(next);
  expect(() =>
    verifySuccessorRegistration({
      approvalToken: token,
      reservationToken: reservation,
      pinnedApprovalDigest: digest(next),
      studioKey: f.keys.publicKey,
      hostKey: f.keys.publicKey,
      predecessor: f.a,
      predecessorState: { ...initialAttemptState(), revision: 1, cancelled: true },
      now: Date.now(),
    }),
  ).toThrow(/consumed/);
  host.claim(attemptBinding(next), Date.now());
  const reopened = new AttemptStore(f.path, f.keys.publicKey, 3);
  cleanup.push(() => reopened.close());
  expect(reopened.hasClaim(next.attemptId)).toBe(true);
  expect(() => reopened.claim(attemptBinding(next), Date.now())).toThrow();
  expect(() => f.store.read(next.attemptId)).toThrow();
  expect(() => host.read(f.a.attemptId)).toThrow();
  expect(f.store.read(f.a.attemptId)).toEqual(f.a);
  const old = new CoordinatorStore(f.path);
  expect(JSON.stringify(old.read(f.a.historicalApproval.request.requestId))).toBe(f.historical);
  old.close();
});
function successor(prior: ReturnType<typeof parseAttemptApproval>) {
  return parseAttemptApproval({
    ...prior,
    version: 3,
    domain: "studio-successor-approval/v1",
    attemptId: "99999999-9999-4999-8999-999999999999",
    runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    nonce: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    sessionId: "ses_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    predecessorAttemptId: prior.attemptId,
    predecessorRunId: prior.runId,
    predecessorApprovalDigest: digest(prior),
    predecessorExpiresAt: prior.expiresAt,
    userApprovalReference: "synthetic-owner-approval",
    approvedAt: Date.now(),
    expiresAt: Date.now() + 900000,
  });
}
it.each(["claim", "cancel", "settle"])(
  "blocks successor when predecessor has %s evidence",
  (kind) => {
    const f = fixture();
    if (kind === "claim") f.store.claim(attemptBinding(f.a), Date.now());
    if (kind === "cancel") f.store.cancel(f.a.attemptId, Date.now());
    if (kind === "settle") f.store.settle(f.a.attemptId, "uncertain", Date.now());
    vi.setSystemTime(f.a.expiresAt + 1);
    const a = successor(f.a);
    const host = new AttemptStore(f.path, f.keys.publicKey, 3);
    cleanup.push(() => host.close());
    expect(() =>
      host.provisionSuccessor(
        signed(a, f.keys.privateKey),
        f.keys.publicKey,
        digest(a),
        f.keys.privateKey,
        Date.now,
      ),
    ).toThrow(/consumed/);
  },
);
it("rejects lineage/scope/key/window substitutions and never silently chains successors", () => {
  const f = fixture();
  vi.setSystemTime(f.a.expiresAt + 1);
  const a = successor(f.a);
  const host = new AttemptStore(f.path, f.keys.publicKey, 3);
  cleanup.push(() => host.close());
  for (const mutation of [
    { predecessorApprovalDigest: "0".repeat(64) },
    { predecessorRunId: a.runId },
    { nonce: f.a.nonce },
    { sessionId: f.a.sessionId },
    {
      historicalApproval: {
        ...f.a.historicalApproval,
        request: { ...f.a.historicalApproval.request, topic: "changed" },
      },
    },
    { approvedAt: Date.now() + 1 },
    { expiresAt: Date.now() },
  ]) {
    const bad = { ...a, ...mutation };
    expect(() =>
      host.provisionSuccessor(
        signed(bad, f.keys.privateKey),
        f.keys.publicKey,
        digest(bad),
        f.keys.privateKey,
        Date.now,
      ),
    ).toThrow();
  }
  expect(() =>
    host.provision(signed(f.a, f.keys.privateKey), f.keys.publicKey, digest(f.a), Date.now()),
  ).toThrow();
  const other = generateKeyPairSync("ed25519");
  expect(() =>
    host.provisionSuccessor(
      signed(a, other.privateKey),
      f.keys.publicKey,
      digest(a),
      f.keys.privateKey,
      Date.now,
    ),
  ).toThrow();
  const token = host.provisionSuccessor(
    signed(a, f.keys.privateKey),
    f.keys.publicKey,
    digest(a),
    f.keys.privateKey,
    Date.now,
  );
  for (const [now, hostKey] of [
    [Date.now() + 60000, f.keys.publicKey],
    [Date.now(), other.publicKey],
  ] as const)
    expect(() =>
      verifySuccessorRegistration({
        approvalToken: signed(a, f.keys.privateKey),
        reservationToken: token,
        pinnedApprovalDigest: digest(a),
        studioKey: f.keys.publicKey,
        hostKey,
        predecessor: f.a,
        predecessorState: initialAttemptState(),
        now,
      }),
    ).toThrow();
  const child = {
    ...a,
    attemptId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    predecessorAttemptId: a.attemptId,
  };
  expect(() =>
    host.provisionSuccessor(
      signed(child, f.keys.privateKey),
      f.keys.publicKey,
      digest(child),
      f.keys.privateKey,
      Date.now,
    ),
  ).toThrow();
});
import { verifySuccessorRegistration } from "./studio-research-successor.server";

it.each([true, false])(
  "runs the synthetic successor only when callback registration exists (%s)",
  async (registered) => {
    const f = fixture();
    vi.setSystemTime(f.a.expiresAt + 1);
    const a = successor(f.a);
    const store = new AttemptStore(f.path, f.keys.publicKey, 3);
    cleanup.push(() => store.close());
    const reservation = store.provisionSuccessor(
      signed(a, f.keys.privateKey),
      f.keys.publicKey,
      digest(a),
      f.keys.privateKey,
      Date.now,
    );
    let persisted:
      { approval: typeof a; state: ReturnType<typeof initialAttemptState> } | undefined;
    if (registered)
      await provisionCallbackSuccessor(
        {
          approvalToken: signed(a, f.keys.privateKey),
          reservationToken: reservation,
          pinnedApprovalDigest: digest(a),
          studioKey: f.keys.publicKey,
          hostKey: f.keys.publicKey,
          now: Date.now(),
        },
        {
          readPredecessor: async () => ({ approval: f.a, state: initialAttemptState() }),
          insert: async (row) => {
            persisted = { approval: row.approval, state: initialAttemptState() };
          },
        },
      );
    const callback = createAttemptCallback({
      peerKey: f.keys.publicKey,
      now: Date.now,
      authorizeCurrent: async () => {},
      repository: {
        read: async () => {
          if (!persisted) throw Error("missing registration");
          return persisted;
        },
        commit: async (_id, revision, state) => {
          if (!persisted || persisted.state.revision !== revision) throw Error("conflict");
          persisted.state = state;
        },
      },
    });
    const run = createAttemptCoordinator({
      ...f.deps,
      approval: a,
      store,
      pinnedApprovalDigest: digest(a),
      callback,
      authority: async (_a, admissionDigest) => ({
        bindingDigest: digest(attemptBinding(a)),
        admissionDigest,
        approvalDigest: digest(a),
        checkedAt: Date.now(),
        expiresAt: a.expiresAt,
      }),
    }).run;
    if (registered) {
      await run(Date.now() + 65000, new AbortController().signal);
      expect(persisted?.state.terminal).toBe("ready");
      expect(store.outcome(a.attemptId)).toBe("complete");
      expect(f.spawn).toHaveBeenCalledOnce();
    } else {
      await expect(run(Date.now() + 65000, new AbortController().signal)).rejects.toThrow();
      expect(f.spawn).not.toHaveBeenCalled();
      expect(store.hasClaim(a.attemptId)).toBe(true);
    }
    await expect(run(Date.now() + 65000, new AbortController().signal)).rejects.toThrow();
    expect(f.spawn).toHaveBeenCalledTimes(registered ? 1 : 0);
    expect(f.store.tokens(f.a.attemptId)).toEqual([]);
  },
);
import { provisionCallbackSuccessor } from "./studio-research-successor.server";
