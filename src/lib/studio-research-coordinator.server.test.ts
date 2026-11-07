import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createApprovalAuthority } from "./studio-research-coordinator-authority.server";
import {
  createResultRelay,
  unavailableProductionResultWriter,
  type RelayBinding,
} from "./studio-research-coordinator-relay.server";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  COORDINATOR,
  PROMPT_POLICY_SHA256,
  COMPOSITION_POLICY_SHA256,
  COMPOSITION_POLICY,
  cliAccountingSchema,
  accountingSchema,
  approvalSchema,
  digest,
  validateBrief,
  type Approval,
} from "./studio-research-coordinator-contracts";
import { CoordinatorStore } from "./studio-research-coordinator-store.server";
import {
  createCoordinator,
  type CoordinatorDeps,
  type Capture,
  type ExecutionInput,
} from "./studio-research-coordinator.server";
import { extractSource } from "./studio-research-public-source.server";
import { makePlugin } from "../../packages/studio-research-coordinator/src/plugin";
import { manifest } from "../../packages/studio-research-coordinator/src/manifest";
const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  cleanups
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "studio-coordinator-"));
  const path = join(root, "ledger.sqlite");
  const store = new CoordinatorStore(path);
  cleanups.push(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const approval = approvalSchema.parse({
    version: 1,
    promptPolicySha256: PROMPT_POLICY_SHA256,
    executionPolicySha256: COMPOSITION_POLICY_SHA256,
    request: {
      requestId: "22222222-2222-4222-8222-222222222222",
      organizationId: COORDINATOR.organizationId,
      topic: "Public business AI research",
    },
    companyId: COORDINATOR.companyId,
    projectId: COORDINATOR.projectId,
    agentId: COORDINATOR.agentId,
    approvedBy: "11111111-1111-4111-8111-111111111111",
    approvedAt: 1000,
    expiresAt: 10000,
    approvedUrls: ["https://example.org/article"],
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
  const evidence = [
    extractSource(
      "Alex Example leads public AI workshops in Nashville.",
      "text/plain",
      approval.approvedUrls[0]!,
      2000,
    ),
  ];
  const brief = {
    research: {
      version: 1,
      requestId: approval.request.requestId,
      topics: [
        {
          title: "Public AI workshops",
          summary: "A public workshop topic",
          relevance: "An interpretation to review",
          sources: [
            {
              url: evidence[0]!.url,
              title: evidence[0]!.title,
              retrievedAt: evidence[0]!.retrievedAt,
              publishedAt: null,
            },
          ],
        },
      ],
      limitations: ["No LinkedIn connections or private interests verified."],
    },
    people: [
      {
        rank: 1,
        name: "Alex Example",
        relevance: "Public professional relevance for review",
        sourceUrl: evidence[0]!.url,
        quote: evidence[0]!.text,
      },
    ],
    draft: null,
  };
  function capture(input: ExecutionInput): Capture {
    return {
      stdout: [
        { type: "step_start", sessionID: input.sessionId },
        { type: "text", sessionID: input.sessionId, part: { text: JSON.stringify(brief) } },
        { type: "step_finish", sessionID: input.sessionId, part: { reason: "stop" } },
      ]
        .map((x) => JSON.stringify(x))
        .join("\n"),
      receipt: {
        requestId: input.requestId,
        issueId: input.issueId,
        runId: input.runId,
        sessionId: input.sessionId,
        agentId: COORDINATOR.agentId,
        projectId: COORDINATOR.projectId,
        exitCode: 0,
        timedOut: false,
        attempts: 1,
      },
      nonce: input.nonce,
      providerRequests: null,
      accounting: {
        mode: "cli-job-unmetered-provider" as const,
        cliJobs: 1 as const,
        coordinatorRetries: 0 as const,
        providerRequests: null,
        immediateChildClosed: true as const,
      },
    };
  }
  const stop = vi.fn(async () => true);
  const deps: CoordinatorDeps = {
    store,
    now: () => 2000,
    authority: vi.fn<CoordinatorDeps["authority"]>(async (context, _action, a) =>
      context === "trusted"
        ? {
            subjectId: a.approvedBy,
            organizationId: a.request.organizationId,
            requestId: a.request.requestId,
            approvalDigest: digest(a),
            expiresAt: 20000,
            actions: ["approve", "run", "read", "cancel", "review"],
          }
        : null,
    ),
    reader: vi.fn(async () => structuredClone(evidence)),
    executor: {
      profile: vi.fn(async () => ({
        primaryModel: COORDINATOR.model,
        auxiliaryModel: COORDINATOR.model,
        endpoint: COORDINATOR.endpoint,
        nativeTools: "deny",
        maxProviderRequests: null,
        maxCliJobs: 1,
        timeoutMs: 60000,
        freshSession: true,
        retries: 0,
        genericWake: false,
        runtimeLogs: false,
      })),
      start: vi.fn(async (input) => ({ completion: Promise.resolve(capture(input)), stop })),
    },
  };
  const coordinator = createCoordinator(deps);
  const id = approval.request.requestId;
  return {
    root,
    path,
    store,
    approval,
    evidence,
    brief,
    deps,
    coordinator,
    id,
    capture,
    stop,
    approve: () => coordinator.approve("trusted", approval),
    run: () => coordinator.run("trusted", id),
  };
}
describe("durable local coordinator", () => {
  it("completes a sourced ranked brief once and preserves durable review", async () => {
    const f = fixture();
    await f.approve();
    const result = await f.run();
    expect(result.state).toBe("ready");
    expect(result.result).toEqual(f.brief);
    expect(f.store.history(f.id).map((e) => e["state"])).toEqual([
      "approved",
      "collecting",
      "running",
      "ready",
    ]);
    await f.coordinator.review("trusted", f.id, { decision: "save" });
    expect((await f.run()).state).toBe("reviewed");
    expect(f.deps.executor!.start).toHaveBeenCalledTimes(1);
    const reopened = new CoordinatorStore(f.path);
    expect(reopened.read(f.id)?.data.review?.decision).toBe("save");
    reopened.close();
    expect(statSync(f.path).mode & 0o077).toBe(0);
  });
  it("atomically excludes competing workers and repeated clicks", async () => {
    const f = fixture();
    await f.approve();
    const otherStore = new CoordinatorStore(f.path);
    const other = createCoordinator({ ...f.deps, store: otherStore });
    await Promise.all([f.run(), other.run("trusted", f.id), f.run()]);
    expect(f.deps.executor!.start).toHaveBeenCalledTimes(1);
    otherStore.close();
  });
  it("cannot replace immutable approval or reserved source list", async () => {
    const f = fixture();
    await f.approve();
    await expect(
      f.coordinator.approve("trusted", {
        ...f.approval,
        approvedUrls: ["https://example.org/other"],
      }),
    ).rejects.toThrow("approval_conflict");
    const db = new DatabaseSync(f.path);
    expect(() => db.prepare("UPDATE jobs SET approval='{}'").run()).toThrow("immutable_approval");
    expect(() => db.prepare("DELETE FROM jobs").run()).toThrow("retain_reservation");
    db.close();
  });
  it("denies caller identity alone, forged approval and revoked permission", async () => {
    const f = fixture();
    await expect(
      f.coordinator.approve({ agentId: COORDINATOR.agentId }, f.approval),
    ).rejects.toThrow("not_authorized");
    await f.approve();
    await expect(f.coordinator.run("untrusted", f.id)).rejects.toThrow("not_authorized");
    vi.mocked(f.deps.authority).mockResolvedValue(null);
    await expect(f.run()).rejects.toThrow("not_authorized");
    expect(f.deps.reader).not.toHaveBeenCalled();
  });
  it.each(["subjectId", "organizationId", "requestId", "approvalDigest"] as const)(
    "rejects authority mismatch: %s",
    async (field) => {
      const f = fixture();
      const authority = await f.deps.authority("trusted", "approve", f.approval);
      vi.mocked(f.deps.authority).mockResolvedValue({ ...authority!, [field]: "wrong" });
      await expect(f.approve()).rejects.toThrow("not_authorized");
    },
  );
  it("rejects expired and cross-org approvals before any record", async () => {
    const f = fixture();
    await expect(
      f.coordinator.approve("trusted", { ...f.approval, expiresAt: 1999 }),
    ).rejects.toThrow();
    await expect(
      f.coordinator.approve("trusted", {
        ...f.approval,
        request: { ...f.approval.request, organizationId: f.approval.approvedBy },
      }),
    ).rejects.toThrow();
    expect(f.store.read(f.id)).toBeNull();
  });
  it("blocks missing executor and broadened model settings before claim", async () => {
    const f = fixture();
    await f.approve();
    delete f.deps.executor;
    await expect(f.run()).rejects.toThrow("execution_unavailable");
    expect(f.store.read(f.id)?.state).toBe("approved");
  });
  it.each([
    { primaryModel: "other" },
    { auxiliaryModel: "other" },
    { nativeTools: "allow" },
    { genericWake: true },
    { runtimeLogs: true },
    { maxProviderRequests: 2 },
    { retries: 1 },
    { endpoint: "https://other.example/" },
  ])("rejects profile expansion %j", async (change) => {
    const f = fixture();
    await f.approve();
    const base = await f.deps.executor!.profile();
    vi.mocked(f.deps.executor!.profile).mockResolvedValue({ ...(base as object), ...change });
    await expect(f.run()).rejects.toThrow();
    expect(f.deps.executor!.start).not.toHaveBeenCalled();
  });
  it("persists pre-execution failure without retry", async () => {
    const f = fixture();
    await f.approve();
    vi.mocked(f.deps.reader).mockRejectedValue(Error("private upstream error"));
    expect((await f.run()).state).toBe("failed");
    await f.run();
    expect(f.deps.reader).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.store.read(f.id))).not.toContain("private upstream");
  });
  it("rechecks approval expiry and authority after collection", async () => {
    const f = fixture();
    await f.approve();
    vi.mocked(f.deps.reader).mockImplementation(async () => {
      f.deps.now = () => 11000;
      return f.evidence;
    });
    expect((await f.run()).state).toBe("failed");
    expect(f.deps.executor!.start).not.toHaveBeenCalled();
  });
  it.each(["nonce", "providerRequests", "receipt"] as const)(
    "rejects forged captured %s",
    async (field) => {
      const f = fixture();
      await f.approve();
      vi.mocked(f.deps.executor!.start).mockImplementation(async (input) => ({
        completion: Promise.resolve({
          ...f.capture(input),
          [field]: field === "providerRequests" ? 2 : "forged",
        }),
        stop: f.stop,
      }));
      expect((await f.run()).state).toBe("uncertain");
      await f.run();
      expect(f.deps.executor!.start).toHaveBeenCalledTimes(1);
    },
  );
  it("cancels before claim without collection or execution", async () => {
    const f = fixture();
    await f.approve();
    expect((await f.coordinator.cancel("trusted", f.id)).state).toBe("cancelled");
    await f.run();
    expect(f.deps.reader).not.toHaveBeenCalled();
  });
  it("cancels during collection and never starts", async () => {
    const f = fixture();
    await f.approve();
    let release!: (v: typeof f.evidence) => void;
    vi.mocked(f.deps.reader).mockImplementation(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    const run = f.run();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect((await f.coordinator.cancel("trusted", f.id)).state).toBe("cancel_requested");
    release(f.evidence);
    expect((await run).state).toBe("cancelled");
    expect(f.deps.executor!.start).not.toHaveBeenCalled();
  });
  it("cancels a running job, rejects late completion and does not rerun", async () => {
    const f = fixture();
    await f.approve();
    let finish!: (v: Capture) => void;
    let captured!: ExecutionInput;
    vi.mocked(f.deps.executor!.start).mockImplementation(async (input) => {
      captured = input;
      return {
        completion: new Promise((r) => {
          finish = r;
        }),
        stop: f.stop,
      };
    });
    const run = f.run();
    await vi.waitFor(() => expect(f.store.read(f.id)?.state).toBe("running"));
    expect((await f.coordinator.cancel("trusted", f.id)).state).toBe("cancelled");
    finish(f.capture(captured));
    await run;
    expect(f.store.read(f.id)?.data.result).toBeUndefined();
    expect((await f.run()).state).toBe("cancelled");
  });
  it("timeouts stop the handle and preserve uncertainty", async () => {
    const f = fixture();
    await f.approve();
    vi.mocked(f.deps.executor!.start).mockResolvedValue({
      completion: new Promise<Capture>(() => {}),
      stop: f.stop,
    });
    vi.useFakeTimers();
    const run = f.run();
    await vi.advanceTimersByTimeAsync(60010);
    expect((await run).state).toBe("uncertain");
    expect(f.stop).toHaveBeenCalled();
    await f.run();
    expect(f.deps.executor!.start).toHaveBeenCalledTimes(1);
  });
  it("crash reconciliation is explicit, terminal and never a retry", async () => {
    const f = fixture();
    await f.approve();
    const job = f.store.read(f.id)!;
    f.store.transition(job, "collecting", {});
    expect(() => f.store.recover(false)).toThrow();
    const reopened = new CoordinatorStore(f.path);
    expect(reopened.recover(true)).toBe(1);
    expect(reopened.read(f.id)?.state).toBe("uncertain");
    reopened.close();
    await f.run();
    expect(f.deps.executor!.start).not.toHaveBeenCalled();
  });
  it.each(["use", "edit", "save", "skip"] as const)(
    "records %s without publication or learning",
    async (decision) => {
      const f = fixture();
      await f.approve();
      await f.run();
      const input =
        decision === "edit" ? { decision, editedText: "My revised draft" } : { decision };
      expect((await f.coordinator.review("trusted", f.id, input)).review?.decision).toBe(decision);
      await expect(f.coordinator.review("trusted", f.id, input)).rejects.toThrow(
        "review_not_ready",
      );
    },
  );
  it("rejects unsupported people claims and voice drafts", () => {
    const f = fixture();
    expect(() =>
      validateBrief(
        JSON.stringify({ ...f.brief, people: [{ ...f.brief.people[0], name: "Invented Person" }] }),
        f.approval,
        f.evidence,
      ),
    ).toThrow("person_evidence_invalid");
    expect(() =>
      validateBrief(
        JSON.stringify({
          ...f.brief,
          draft: { text: "Draft", voiceExampleIds: [f.id, f.id, f.id] },
        }),
        f.approval,
        f.evidence,
      ),
    ).toThrow("voice_not_approved");
  });
  it("allows draft only with three approved examples and explicit consent", () => {
    const f = fixture();
    const text = "An approved voice example used only in this fictional offline test. ".repeat(2);
    const a: Approval = {
      ...f.approval,
      draftRequested: true,
      voiceExamples: [1, 2, 3].map((n) => ({
        id: `55555555-5555-4555-8555-55555555555${n}`,
        text,
        sha256: createHash("sha256").update(text).digest("hex"),
      })),
    };
    const brief = {
      ...f.brief,
      draft: {
        text: "A proposed draft for review",
        voiceExampleIds: a.voiceExamples.map((v) => v.id),
      },
    };
    expect(validateBrief(JSON.stringify(brief), a, f.evidence).draft?.text).toBe(brief.draft.text);
  });
  it("ships a disabled SDK plugin without generic wake/log/schedule capabilities", async () => {
    expect(manifest.capabilities).toEqual(["api.routes.register", "secrets.read-ref"]);
    expect(manifest.jobs).toBeUndefined();
    expect(manifest.tools).toBeUndefined();
    const plugin = makePlugin();
    const result = await plugin.definition.onApiRequest!({
      routeKey: "run",
      method: "POST",
      path: "/",
      params: {},
      query: {},
      body: null,
      actor: { actorType: "agent", actorId: COORDINATOR.agentId, agentId: COORDINATOR.agentId },
      companyId: COORDINATOR.companyId,
      headers: {},
    });
    expect(result.status).toBe(503);
  });
  it("holds all new execution while an earlier outcome is uncertain", async () => {
    const f = fixture();
    await f.approve();
    const first = f.store.transition(f.store.read(f.id)!, "collecting", {})!;
    f.store.transition(first, "uncertain", { reason: "interrupted" });
    const second = {
      ...f.approval,
      request: { ...f.approval.request, requestId: "66666666-6666-4666-8666-666666666666" },
    };
    await f.coordinator.approve("trusted", second);
    await expect(f.coordinator.run("trusted", second.request.requestId)).rejects.toThrow();
    expect(f.deps.executor!.start).not.toHaveBeenCalled();
  });
  it("stops a launch that resolves after deadline and never accepts it", async () => {
    const f = fixture();
    await f.approve();
    let release!: (v: { completion: Promise<Capture>; stop: typeof f.stop }) => void;
    let input!: ExecutionInput;
    vi.mocked(f.deps.executor!.start).mockImplementation((value) => {
      input = value;
      return new Promise((r) => {
        release = r;
      });
    });
    vi.useFakeTimers();
    const run = f.run();
    await vi.advanceTimersByTimeAsync(5010);
    expect((await run).state).toBe("uncertain");
    release({ completion: Promise.resolve(f.capture(input)), stop: f.stop });
    await vi.advanceTimersByTimeAsync(1);
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(f.store.read(f.id)?.data.result).toBeUndefined();
  });
  it("does not claim successful cancellation without stop acknowledgement", async () => {
    const f = fixture();
    await f.approve();
    f.stop.mockResolvedValue(false);
    vi.mocked(f.deps.executor!.start).mockResolvedValue({
      completion: new Promise<Capture>(() => {}),
      stop: f.stop,
    });
    const run = f.run();
    await vi.waitFor(() => expect(f.store.read(f.id)?.state).toBe("running"));
    expect((await f.coordinator.cancel("trusted", f.id)).state).toBe("uncertain");
    await run;
  });
  it("bounds source collection even when a reader adapter stalls", async () => {
    const f = fixture();
    await f.approve();
    vi.mocked(f.deps.reader).mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    const run = f.run();
    await vi.advanceTimersByTimeAsync(12010);
    expect((await run).state).toBe("failed");
    expect(f.deps.executor!.start).not.toHaveBeenCalled();
  });
  it("detects damaged persisted receipt data and protects event history", async () => {
    const f = fixture();
    await f.approve();
    const db = new DatabaseSync(f.path);
    expect(() => db.exec("DELETE FROM events")).toThrow("immutable_history");
    db.prepare("UPDATE jobs SET data=? WHERE id=?").run('{"reason":"tampered"}', f.id);
    expect(() => f.store.read(f.id)).toThrow("storage_integrity");
    db.close();
  });
  it("enforces plugin method/body/issue boundaries and has no result upload route", async () => {
    const f = fixture();
    await f.approve();
    const plugin = makePlugin(f.coordinator, async () => ({ issueId: f.approval.issueId }));
    const input = {
      routeKey: "run",
      method: "POST",
      path: "/",
      params: { requestId: f.id, issueId: f.approval.issueId },
      query: {},
      body: null,
      actor: {
        actorType: "agent" as const,
        actorId: COORDINATOR.agentId,
        agentId: COORDINATOR.agentId,
      },
      companyId: COORDINATOR.companyId,
      headers: {},
    };
    expect((await plugin.definition.onApiRequest!(input)).status).toBe(403); // identity alone has no Studio user authority
    expect(
      (await plugin.definition.onApiRequest!({ ...input, body: { topic: "override" } })).status,
    ).toBe(400);
    expect(
      (
        await plugin.definition.onApiRequest!({
          ...input,
          params: { ...input.params, issueId: f.id },
        })
      ).status,
    ).toBe(403);
    expect((await plugin.definition.onApiRequest!({ ...input, routeKey: "submit" })).status).toBe(
      404,
    );
    expect((await plugin.definition.onApiRequest!({ ...input, method: "DELETE" })).status).toBe(
      405,
    );
    expect(f.deps.executor!.start).not.toHaveBeenCalled();
  });
});

describe("adapter trust boundaries", () => {
  function signed(key: import("node:crypto").KeyObject, payload: unknown) {
    const bytes = Buffer.from(JSON.stringify(payload));
    return bytes.toString("base64url") + "." + sign(null, bytes, key).toString("base64url");
  }
  function grant(f: ReturnType<typeof fixture>) {
    return {
      version: 1,
      issuer: "studio-approved-task",
      audience: "studio-research-coordinator",
      subjectId: f.approval.approvedBy,
      organizationId: COORDINATOR.organizationId,
      companyId: COORDINATOR.companyId,
      projectId: COORDINATOR.projectId,
      agentId: COORDINATOR.agentId,
      requestId: f.id,
      issueId: f.approval.issueId,
      approvalDigest: digest(f.approval),
      issuedAt: 1000,
      expiresAt: 9000,
      actions: ["approve", "run", "read", "cancel", "review"],
    };
  }
  it("requires valid signature AND actual authenticated requester", async () => {
    const f = fixture(),
      keys = generateKeyPairSync("ed25519"),
      g = grant(f);
    const authenticate = vi.fn(async () => ({ userId: f.approval.approvedBy }));
    const authority = createApprovalAuthority({
      publicKey: keys.publicKey,
      now: () => 2000,
      authenticate,
      attestation: (c) => c,
    });
    expect(await authority(signed(keys.privateKey, g), "run", f.approval)).not.toBeNull();
    expect(await authority(g, "run", f.approval)).toBeNull();
    expect(
      await authority(signed(generateKeyPairSync("ed25519").privateKey, g), "run", f.approval),
    ).toBeNull();
    authenticate.mockResolvedValue({ userId: "99999999-9999-4999-8999-999999999999" });
    expect(await authority(signed(keys.privateKey, g), "run", f.approval)).toBeNull();
  });
  it.each([
    "organizationId",
    "companyId",
    "agentId",
    "projectId",
    "subjectId",
    "requestId",
    "issueId",
    "approvalDigest",
    "audience",
    "issuer",
  ])("rejects signed wrong %s", async (field) => {
    const f = fixture(),
      keys = generateKeyPairSync("ed25519");
    const authority = createApprovalAuthority({
      publicKey: keys.publicKey,
      now: () => 2000,
      authenticate: async () => ({ userId: f.approval.approvedBy }),
      attestation: (c) => c,
    });
    expect(
      await authority(
        signed(keys.privateKey, { ...grant(f), [field]: "99999999-9999-4999-8999-999999999999" }),
        "run",
        f.approval,
      ),
    ).toBeNull();
  });
  it("rejects expired, overlong, future and action-expanded grants", async () => {
    const f = fixture(),
      keys = generateKeyPairSync("ed25519");
    const authority = createApprovalAuthority({
      publicKey: keys.publicKey,
      now: () => 2000,
      authenticate: async () => ({ userId: f.approval.approvedBy }),
      attestation: (c) => c,
    });
    for (const patch of [
      { expiresAt: 2000 },
      { expiresAt: 10000000 },
      { issuedAt: 3000 },
      { actions: ["read"] },
      { actions: ["wake"] },
      { unexpected: "scope" },
    ])
      expect(
        await authority(signed(keys.privateKey, { ...grant(f), ...patch }), "run", f.approval),
      ).toBeNull();
  });
  it("rechecks signed grant expiry after session verification", async () => {
    const f = fixture(),
      keys = generateKeyPairSync("ed25519");
    let now = 2000;
    const authority = createApprovalAuthority({
      publicKey: keys.publicKey,
      now: () => now,
      authenticate: async () => {
        now = 10000;
        return { userId: f.approval.approvedBy };
      },
      attestation: (c) => c,
    });
    expect(await authority(signed(keys.privateKey, grant(f)), "run", f.approval)).toBeNull();
  });
  it("rejects policy replacement, malformed authority and expiry while authority waits", async () => {
    const f = fixture();
    await expect(
      f.coordinator.approve("trusted", { ...f.approval, promptPolicySha256: "0".repeat(64) }),
    ).rejects.toThrow();
    await f.approve();
    const real = f.deps.authority;
    f.deps.authority = async (...args) => ({ ...(await real(...args))!, expiresAt: NaN });
    await expect(f.run()).rejects.toThrow("not_authorized");
    f.deps.authority = async (...args) => {
      const a = await real(...args);
      f.deps.now = () => 10000;
      return a;
    };
    await expect(f.run()).rejects.toThrow("approval_invalid");
    expect(f.deps.executor!.start).not.toHaveBeenCalled();
  });
  it("rejects forged citation title", () => {
    const f = fixture();
    f.brief.research.topics[0]!.sources[0]!.title = "forged";
    expect(() => validateBrief(JSON.stringify(f.brief), f.approval, f.evidence)).toThrow(
      "unverified_source",
    );
  });
  it("authenticates exact result/run/evidence and writes only an existing bound local record", async () => {
    const f = fixture();
    await f.approve();
    await f.run();
    const job = f.store.read(f.id)!,
      keys = generateKeyPairSync("ed25519");
    const db = new DatabaseSync(join(f.root, "studio-target.sqlite"));
    cleanups.push(() => db.close());
    db.exec(
      "CREATE TABLE target(org TEXT, request TEXT, issue TEXT, run TEXT, approval TEXT, result_digest TEXT, result TEXT, PRIMARY KEY(org,request))",
    );
    db.prepare("INSERT INTO target VALUES(?,?,?,?,?,NULL,NULL)").run(
      COORDINATOR.organizationId,
      f.id,
      f.approval.issueId,
      job.data.runId!,
      job.approvalDigest,
    );
    const accept = vi.fn(async (b: RelayBinding, result: unknown) => {
      const changed = db
        .prepare(
          "UPDATE target SET result_digest=?,result=? WHERE org=? AND request=? AND issue=? AND run=? AND approval=? AND result_digest IS NULL",
        )
        .run(
          b.resultDigest,
          JSON.stringify(result),
          b.organizationId,
          b.requestId,
          b.issueId,
          b.runId,
          b.approvalDigest,
        );
      if (changed.changes) return "accepted" as const;
      const existing = db
        .prepare(
          "SELECT result_digest,result FROM target WHERE org=? AND request=? AND issue=? AND run=? AND approval=?",
        )
        .get(b.organizationId, b.requestId, b.issueId, b.runId, b.approvalDigest);
      return existing?.["result_digest"] === b.resultDigest &&
        existing["result"] === JSON.stringify(result)
        ? ("same" as const)
        : ("conflict" as const);
    });
    let trustedJob: typeof job | null = job;
    const relay = createResultRelay({
      publicKey: keys.publicKey,
      now: () => 2000,
      readApprovedJob: async (org, id) =>
        org === COORDINATOR.organizationId && id === f.id ? trustedJob : null,
      accept,
    });
    const envelope = {
      version: 1,
      issuer: "studio-research-result",
      audience: "studio-result-store",
      organizationId: COORDINATOR.organizationId,
      companyId: COORDINATOR.companyId,
      agentId: COORDINATOR.agentId,
      projectId: COORDINATOR.projectId,
      requestId: f.id,
      issueId: f.approval.issueId,
      runId: job.data.runId,
      sessionId: job.data.sessionId,
      approvalDigest: job.approvalDigest,
      evidenceDigest: job.data.evidenceDigest,
      promptDigest: job.data.promptDigest,
      resultDigest: job.data.resultDigest,
      issuedAt: 1000,
      expiresAt: 9000,
      result: job.data.result,
    };
    for (const field of [
      "organizationId",
      "companyId",
      "projectId",
      "agentId",
      "requestId",
      "issueId",
      "runId",
      "sessionId",
      "approvalDigest",
      "evidenceDigest",
      "promptDigest",
      "resultDigest",
    ])
      await expect(
        relay(
          signed(keys.privateKey, { ...envelope, [field]: "99999999-9999-4999-8999-999999999999" }),
        ),
      ).rejects.toThrow("result_rejected");
    await expect(
      relay(signed(generateKeyPairSync("ed25519").privateKey, envelope)),
    ).rejects.toThrow();
    await expect(
      relay(signed(keys.privateKey, { ...envelope, expiresAt: 2000 })),
    ).rejects.toThrow();
    await expect(
      relay(
        signed(keys.privateKey, {
          ...envelope,
          result: { ...f.brief, draft: { text: "changed" } },
        }),
      ),
    ).rejects.toThrow();
    for (const issuer of ["forged"])
      await expect(relay(signed(keys.privateKey, { ...envelope, issuer }))).rejects.toThrow();
    await expect(
      relay(signed(keys.privateKey, { ...envelope, audience: "elsewhere" })),
    ).rejects.toThrow();
    for (const state of ["cancelled", "uncertain", "approved"] as const) {
      trustedJob = { ...job, state };
      await expect(relay(signed(keys.privateKey, envelope))).rejects.toThrow();
    }
    trustedJob = null;
    await expect(relay(signed(keys.privateKey, envelope))).rejects.toThrow();
    trustedJob = job;
    expect(accept).not.toHaveBeenCalled();
    expect(
      (
        await Promise.all([
          relay(signed(keys.privateKey, envelope)),
          relay(signed(keys.privateKey, envelope)),
        ])
      )
        .map((x) => x.status)
        .sort(),
    ).toEqual(["accepted", "same"]);
    expect(db.prepare("SELECT COUNT(*) n FROM target").get()!["n"]).toBe(1);
    for (const column of ["issue", "run", "approval"]) {
      const old = db.prepare(`SELECT ${column} value FROM target`).get()!["value"];
      db.prepare(`UPDATE target SET ${column}=?`).run("wrong");
      await expect(relay(signed(keys.privateKey, envelope))).rejects.toThrow();
      db.prepare(`UPDATE target SET ${column}=?`).run(old as string);
    }
    db.prepare("UPDATE target SET result_digest=?").run("different");
    await expect(relay(signed(keys.privateKey, envelope))).rejects.toThrow();

    await expect(unavailableProductionResultWriter()).rejects.toThrow(
      "coordinator_result_storage_unavailable",
    );
  });
  it("two real processes compete for one durable claim", async () => {
    const f = fixture();
    await f.approve();
    function child() {
      const p = spawn(
        process.execPath,
        [new URL("../../qa/studio-research/claim-worker.mjs", import.meta.url).pathname],
        { env: {}, stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = "";
      let ready!: () => void;
      const readyPromise = new Promise<void>((r) => (ready = r));
      const done = new Promise<string>((resolve, reject) => {
        p.stdout.on("data", (b) => {
          output += b.toString();
          if (output.includes("ready\n")) ready();
        });
        p.on("error", reject);
        p.on("close", (code) =>
          code === 0 ? resolve(output) : reject(Error("claim_fixture_failed")),
        );
      });
      p.stdin.write(JSON.stringify({ path: f.path, id: f.id }) + "\n");
      return { p, readyPromise, done };
    }
    const a = child(),
      b = child();
    await Promise.all([a.readyPromise, b.readyPromise]);
    a.p.stdin.end("go\n");
    b.p.stdin.end("go\n");
    const results = await Promise.all([a.done, b.done]);
    expect(results.filter((x) => x.includes("claimed")).length).toBe(1);
    expect(f.store.read(f.id)!.state).toBe("collecting");
  });
});

describe("revised lifecycle regression", () => {
  it("persists launch and validated completion provenance across reopen", async () => {
    const f = fixture();
    await f.approve();
    await f.run();
    const reopened = new CoordinatorStore(f.path);
    try {
      const j = reopened.read(f.id)!;
      expect(j.data.launch?.nonce).toMatch(/^[a-f0-9-]+$/);
      expect(j.data.launch?.profile).toMatchObject({ nativeTools: "deny", retries: 0 });
      expect(j.data.completion?.receipt).toMatchObject({
        runId: j.data.runId,
        sessionId: j.data.sessionId,
        attempts: 1,
      });
      expect(j.data.completion?.providerRequests).toBeNull();
      expect(j.data.completion?.outputDigest).toHaveLength(64);
      expect(() =>
        reopened.transition(j, "reviewed", {
          completion: { ...j.data.completion!, outputDigest: "0".repeat(64) },
        }),
      ).toThrow("receipt_immutable");
    } finally {
      reopened.close();
    }
  });
  it("observes cancellation from another coordinator instance and stops owner process handle once", async () => {
    const f = fixture();
    await f.approve();
    let launched!: () => void;
    const started = new Promise<void>((r) => (launched = r));
    f.deps.executor!.start = vi.fn(async () => {
      launched();
      return { completion: new Promise<Capture>(() => {}), stop: f.stop };
    });
    const run = f.run();
    await started;
    const second = new CoordinatorStore(f.path);
    try {
      const other = createCoordinator({ ...f.deps, store: second });
      await other.cancel("trusted", f.id);
      await run;
      expect(f.store.read(f.id)!.state).toBe("cancelled");
      expect(f.stop).toHaveBeenCalledTimes(1);
    } finally {
      second.close();
    }
  });
  it("cross-instance cancellation during launch acquisition aborts and rejects late output", async () => {
    const f = fixture();
    await f.approve();
    let release!: (h: import("./studio-research-coordinator.server").ExecutionHandle) => void;
    let input!: ExecutionInput;
    let launched!: () => void;
    const started = new Promise<void>((r) => (launched = r));
    f.deps.executor!.start = vi.fn<NonNullable<CoordinatorDeps["executor"]>["start"]>(async (i) => {
      input = i;
      launched();
      return await new Promise((r) => (release = r));
    });
    const run = f.run();
    await started;
    const second = new CoordinatorStore(f.path);
    try {
      await createCoordinator({ ...f.deps, store: second }).cancel("trusted", f.id);
      await new Promise((r) => setTimeout(r, 40));
      expect(input.signal.aborted).toBe(true);
      release({ completion: Promise.resolve(f.capture(input)), stop: f.stop });
      await run;
      expect(f.store.read(f.id)!.state).toBe("cancelled");
      expect(f.store.read(f.id)!.data.result).toBeUndefined();
    } finally {
      second.close();
    }
  });
  it("cross-instance cancellation while collecting prevents launch", async () => {
    const f = fixture();
    await f.approve();
    let release!: (e: typeof f.evidence) => void;
    let reading!: () => void;
    const started = new Promise<void>((r) => (reading = r));
    f.deps.reader = async () => {
      reading();
      return await new Promise((r) => (release = r));
    };
    const run = f.run();
    await started;
    const second = new CoordinatorStore(f.path);
    try {
      await createCoordinator({ ...f.deps, store: second }).cancel("trusted", f.id);
      release(f.evidence);
      await run;
      expect(f.store.read(f.id)!.state).toBe("cancelled");
      expect(f.deps.executor!.start).not.toHaveBeenCalled();
    } finally {
      second.close();
    }
  });
  it("rechecks expiry after final source authorization and after approval import authorization", async () => {
    const f = fixture();
    await f.approve();
    const real = f.deps.authority;
    let calls = 0;
    f.deps.authority = async (...a) => {
      const p = await real(...a);
      if (++calls === 3) f.deps.now = () => 10000;
      return p;
    };
    await f.run();
    expect(f.deps.executor!.start).not.toHaveBeenCalled();
    expect(f.store.read(f.id)!.state).toBe("failed");
    const g = fixture();
    const original = g.deps.authority;
    g.deps.authority = async (...a) => {
      const p = await original(...a);
      g.deps.now = () => 10000;
      return p;
    };
    await expect(g.approve()).rejects.toThrow("approval_invalid");
    expect(g.store.read(g.id)).toBeNull();
  });
});

describe("launch deadline regression", () => {
  it.each(["approval", "grant"])(
    "stops acquired handle after %s admission deadline and retains uncertainty",
    async (kind) => {
      const f = fixture();
      await f.approve();
      const real = f.deps.authority;
      if (kind === "grant")
        f.deps.authority = async (...args) => {
          const proof = await real(...args);
          return proof ? { ...proof, expiresAt: 2500 } : null;
        };
      f.deps.executor!.start = vi.fn(async (input) => {
        f.deps.now = () => (kind === "grant" ? 2600 : 8000);
        return { completion: Promise.resolve(f.capture(input)), stop: f.stop };
      });
      await f.run();
      expect(f.stop).toHaveBeenCalledTimes(1);
      expect(f.store.read(f.id)!.state).toBe("uncertain");
      expect(f.store.read(f.id)!.data.result).toBeUndefined();
      expect(f.store.read(f.id)!.data.launch?.launchDeadline).toBe(kind === "grant" ? 2500 : 7000);
    },
  );
});

describe("dev3 cancellation races", () => {
  it("does not lose cancellation when job advances while authorization is pending", async () => {
    const f = fixture();
    await f.approve();
    const authority = f.deps.authority;
    f.deps.authority = async (...args) => {
      const proof = await authority(...args);
      if (args[1] === "cancel") f.store.transition(f.store.read(f.id)!, "collecting", {});
      return proof;
    };
    const reply = await f.coordinator.cancel("trusted", f.id);
    expect(reply.state).toBe("cancel_requested");
    expect(f.store.read(f.id)!.state).toBe("cancel_requested");
  });
  it("acknowledges stop when a running job advances during cancel authorization", async () => {
    const f = fixture();
    await f.approve();
    let completeAuth!: (v: void) => void;
    let authWaiting!: (v: void) => void;
    const waiting = new Promise<void>((r) => (authWaiting = r)),
      gate = new Promise<void>((r) => (completeAuth = r));
    const auth = f.deps.authority;
    f.deps.authority = async (...args) => {
      if (args[1] === "cancel") {
        authWaiting();
        await gate;
      }
      return auth(...args);
    };
    const cancellation = f.coordinator.cancel("trusted", f.id);
    await waiting;
    let started!: (v: void) => void;
    const begun = new Promise<void>((r) => (started = r));
    f.deps.executor!.start = vi.fn(async () => {
      started();
      return { completion: new Promise<Capture>(() => {}), stop: f.stop };
    });
    const run = f.run();
    await begun;
    completeAuth();
    expect((await cancellation).state).toBe("cancelled");
    await run;
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(f.store.read(f.id)!.data.reason).toBe("stop_acknowledged");
  });
  it("persists uncertainty when cancellation races rejected acquisition, never relaunches", async () => {
    const f = fixture();
    await f.approve();
    let reject!: (e: Error) => void;
    let started!: (v: void) => void;
    const begun = new Promise<void>((r) => (started = r));
    f.deps.executor!.start = vi.fn<NonNullable<CoordinatorDeps["executor"]>["start"]>(async () => {
      started();
      return await new Promise((_r, j) => (reject = j));
    });
    const run = f.run();
    await begun;
    const second = new CoordinatorStore(f.path);
    try {
      await createCoordinator({ ...f.deps, store: second }).cancel("trusted", f.id);
      reject(Error("ambiguous acquisition"));
      await run;
      expect(second.read(f.id)!.state).toBe("uncertain");
      expect(second.read(f.id)!.data.reason).toBe("cancelled_launch_outcome_unconfirmed");
      await f.run();
      expect(f.deps.executor!.start).toHaveBeenCalledTimes(1);
    } finally {
      second.close();
    }
  });
  it("hashes JSONB reordered objects consistently", () => {
    expect(digest({ z: { b: 2, a: 1 }, a: [{ c: 3, b: 2 }] })).toBe(
      digest({ a: [{ b: 2, c: 3 }], z: { a: 1, b: 2 } }),
    );
  });
});

describe("versioned CLI accounting policy", () => {
  it("binds honest one-job limits and rejects legacy call-count approval", () => {
    const f = fixture();
    expect(COMPOSITION_POLICY.version).toBe(2);
    expect(COMPOSITION_POLICY.maxCliJobs).toBe(1);
    expect(COMPOSITION_POLICY.maxProviderRequests).toBeNull();
    expect(COMPOSITION_POLICY.providerCostCap).toBeNull();
    expect(COMPOSITION_POLICY.retries).toBe(0);
    expect(COMPOSITION_POLICY_SHA256).toBe(digest(COMPOSITION_POLICY));
    expect(approvalSchema.safeParse({ ...f.approval, maxProviderRequests: 1 }).success).toBe(false);
  });
  it.each([
    { mode: "measured-provider-requests", providerRequests: 1, meterReceiptSha256: "a".repeat(64) },
    {
      mode: "cli-job-unmetered-provider",
      cliJobs: 2,
      coordinatorRetries: 0,
      providerRequests: null,
      immediateChildClosed: true,
    },
    {
      mode: "cli-job-unmetered-provider",
      cliJobs: 1,
      coordinatorRetries: 1,
      providerRequests: null,
      immediateChildClosed: true,
    },
    {
      mode: "cli-job-unmetered-provider",
      cliJobs: 1,
      coordinatorRetries: 0,
      providerRequests: 1,
      immediateChildClosed: true,
    },
    {
      mode: "cli-job-unmetered-provider",
      cliJobs: 1,
      coordinatorRetries: 0,
      providerRequests: null,
      immediateChildClosed: false,
    },
  ])("rejects incompatible accounting without retry: %j", async (accounting) => {
    const f = fixture();
    await f.approve();
    vi.mocked(f.deps.executor!.start).mockImplementation(async (input) => ({
      completion: Promise.resolve({ ...f.capture(input), accounting } as unknown as Capture),
      stop: f.stop,
    }));
    expect((await f.run()).state).toBe("uncertain");
    await f.run();
    expect(f.deps.executor!.start).toHaveBeenCalledTimes(1);
  });
  it("keeps measured evidence distinct from CLI receipts", () => {
    const measured = {
      mode: "measured-provider-requests",
      providerRequests: 1,
      meterReceiptSha256: "a".repeat(64),
    };
    expect(accountingSchema.safeParse(measured).success).toBe(true);
    expect(cliAccountingSchema.safeParse(measured).success).toBe(false);
  });
});
