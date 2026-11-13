import { createRouteLedger } from "./studio-research-route-ledger-node.server";
import { afterEach, describe, it, expect, vi } from "vitest";
import { generateKeyPairSync, sign, randomUUID, type KeyObject } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("./studio-research-access.server", () => ({ authorizeStudioResearch: vi.fn() }));
import { authorizeStudioResearch } from "./studio-research-access.server";
import {
  createManualResearchComposition,
  type CompositionDeps,
} from "./studio-research-composition.server";
import {
  createStudioCoordinatorHandlers,
  signCoordinatorReceipt,
} from "./studio-research-coordinator-studio.server";
import {
  createCoordinatorRequestStore,
  type CoordinatorRow,
} from "./studio-research-coordinator-request-store.server";
import {
  COORDINATOR,
  COMPOSITION_POLICY_SHA256,
  LINUX_PREVIEW_POLICY,
  LINUX_PREVIEW_POLICY_SHA256,
  digest,
} from "./studio-research-coordinator-contracts";
import { verifySignedJson } from "./studio-research-coordinator-authority.server";
import { CoordinatorStore, type Job } from "./studio-research-coordinator-store.server";
import { extractSource } from "./studio-research-public-source.server";
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((f) => f());
  vi.clearAllMocks();
});
function signed(key: KeyObject, value: unknown) {
  const b = Buffer.from(JSON.stringify(value));
  return b.toString("base64url") + "." + sign(null, b, key).toString("base64url");
}
async function fixture(mode: "offline-synthetic" | "linux-public-preview" = "offline-synthetic") {
  const root = mkdtempSync(join(tmpdir(), "studio-composed-")),
    ledger = new CoordinatorStore(join(root, "host.sqlite")),
    db = new DatabaseSync(join(root, "studio.sqlite"));
  cleanups.push(() => {
    ledger.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  db.exec("CREATE TABLE request(row TEXT NOT NULL)");
  const userId = randomUUID(),
    requestId = randomUUID(),
    issueId = randomUUID(),
    studioKeys = generateKeyPairSync("ed25519"),
    hostKeys = generateKeyPairSync("ed25519"),
    runtimeKeys = generateKeyPairSync("ed25519");
  let now = 2000,
    user: string = userId,
    revoked = false,
    drop = "",
    noCommit = false,
    ackPatch: Record<string, unknown> = {},
    stopPatch: Record<string, unknown> = {},
    afterAck: (() => Promise<void>) | undefined;
  const initial: CoordinatorRow = {
    id: randomUUID(),
    organization_id: COORDINATOR.organizationId,
    request_id: requestId,
    created_by: userId,
    topic: "Synthetic public research",
    company_id: COORDINATOR.companyId,
    agent_id: COORDINATOR.agentId,
    issue_id: issueId,
    state: "submitted",
    result: null,
    result_comment_id: null,
    coordinator_state: null,
    coordinator_approval: null,
    coordinator_approval_digest: null,
    coordinator_admission: null,
    coordinator_brief: null,
    coordinator_result_digest: null,
  };
  const read = () =>
    JSON.parse(String(db.prepare("SELECT row FROM request").get()!["row"])) as CoordinatorRow;
  const save = (row: CoordinatorRow) =>
    db.prepare("UPDATE request SET row=?").run(JSON.stringify(row));
  db.prepare("INSERT INTO request VALUES(?)").run(JSON.stringify(initial));
  vi.mocked(authorizeStudioResearch).mockImplementation(
    async () => ({ user: { id: user } }) as never,
  );
  const transport: typeof fetch = async (input, init) => {
    const params = new URL(String(input)).searchParams,
      row = read();
    let matches = true;
    for (const [field, value] of params) {
      if (field === "limit") continue;
      const actual = row[field as keyof CoordinatorRow];
      if (value === "is.null" ? actual !== null : String(actual) !== value.slice(3))
        matches = false;
    }
    if (!matches) return Response.json([]);
    if (init?.method === "PATCH") {
      const next = { ...row, ...JSON.parse(String(init.body)) };
      save(next);
      return Response.json([next]);
    }
    return Response.json([row]);
  };
  const requestStore = createCoordinatorRequestStore("synthetic-only", transport),
    handlers = createStudioCoordinatorHandlers({
      store: requestStore,
      enabled: true,
      executionMode: mode,
      approvalPrivateKey: studioKeys.privateKey,
      receiptPublicKey: hostKeys.publicKey,
      now: () => now,
    });
  const request = new Request("https://studio.local/request", {
    method: "POST",
    headers: { Authorization: "Bearer synthetic-user-session" },
  });
  const issued = await handlers.approve(request, {
    organizationId: COORDINATOR.organizationId,
    requestId,
    approvedUrls: ["https://example.org/article"],
  });
  const evidence = [
      extractSource("Synthetic public text", "text/plain", "https://example.org/article", 2000),
    ],
    brief = {
      research: { version: 1, requestId, topics: [], limitations: ["Offline fixture"] },
      people: [],
      draft: null,
    };
  function ack(job: Job, domain: string, payload: unknown, status = "accepted") {
    return {
      domain,
      companyId: COORDINATOR.companyId,
      projectId: COORDINATOR.projectId,
      agentId: COORDINATOR.agentId,
      subjectId: userId,
      requestId,
      runId: job.data.runId,
      sessionId: job.data.sessionId,
      approvalDigest: job.approvalDigest,
      payloadDigest: digest(payload),
      issuedAt: now,
      expiresAt: now + 1000,
      status,
    };
  }
  const deps: CompositionDeps = {
    mode,
    store: ledger,
    now: () => now,
    authorize: async (req, org, work) => {
      expect(req).toBe(request);
      const a = await authorizeStudioResearch(req, org, work);
      return { userId: a.user.id };
    },
    readApproved: async (org, id) => {
      const row = read();
      if (org !== row.organization_id || id !== row.request_id) return null;
      return {
        approval: issued.approval,
        state: row.coordinator_state as "approved" | "running" | "ready" | "cancelled",
        revoked,
        ...(row.coordinator_admission ? { admission: row.coordinator_admission } : {}),
        ...(row.coordinator_result_digest ? { resultDigest: row.coordinator_result_digest } : {}),
      };
    },
    reader: async () => evidence,
    grantPublicKey: studioKeys.publicKey,
    hostPrivateKey: hostKeys.privateKey,
    ackPublicKey: studioKeys.publicKey,
    runtimePublicKey: runtimeKeys.publicKey,
    runtime: {
      inspectPolicy: async () =>
        signed(runtimeKeys.privateKey, {
          domain: "studio-runtime-policy/v1",
          policyDigest:
            mode === "linux-public-preview"
              ? LINUX_PREVIEW_POLICY_SHA256
              : COMPOSITION_POLICY_SHA256,
          mode,
          issuedAt: now,
          expiresAt: now + 1000,
        }),
      profile: async () => ({
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
      }),
      start: vi.fn(async (input) => ({
        completion: Promise.resolve({
          nonce: input.nonce,
          providerRequests: null,
          accounting: {
            mode: "cli-job-unmetered-provider" as const,
            cliJobs: 1 as const,
            coordinatorRetries: 0 as const,
            providerRequests: null,
            immediateChildClosed: true as const,
          },
          receipt: {
            requestId,
            issueId,
            runId: input.runId,
            sessionId: input.sessionId,
            agentId: COORDINATOR.agentId,
            projectId: COORDINATOR.projectId,
            exitCode: 0,
            timedOut: false,
            attempts: 1,
            ...(mode === "linux-public-preview"
              ? {
                  nativeSession: {
                    version: 1,
                    id: "native-test-session",
                    bindingDigest: digest({
                      requestId: input.requestId,
                      issueId: input.issueId,
                      runId: input.runId,
                      coordinatorSessionId: input.sessionId,
                      nonce: input.nonce,
                      promptDigest: digest(input.prompt),
                      profileDigest: digest(input.profile),
                      executableSha256: LINUX_PREVIEW_POLICY.executableSha256,
                      packageVersion: "1.18.18",
                    }),
                  },
                }
              : {}),
          },
          stdout: [
            {
              type: "step_start",
              sessionID: mode === "linux-public-preview" ? "native-test-session" : input.sessionId,
            },
            {
              type: "text",
              sessionID: mode === "linux-public-preview" ? "native-test-session" : input.sessionId,
              part: { text: JSON.stringify(brief) },
            },
            {
              type: "step_finish",
              sessionID: mode === "linux-public-preview" ? "native-test-session" : input.sessionId,
              part: { reason: "stop" },
            },
          ]
            .map((x) => JSON.stringify(x))
            .join("\n"),
        }),
      })),
      stopExact: vi.fn(async (command) =>
        signed(runtimeKeys.privateKey, {
          ...ack(ledger.read(requestId)!, "studio-stop-ack/v1", command, "stopped"),
          ...stopPatch,
        }),
      ),
    },
    exchange: vi.fn(async (kind, token) => {
      const envelope = verifySignedJson(hostKeys.publicKey, token) as { job: Job };
      expect(JSON.stringify([kind, token])).not.toContain("synthetic-user-session");
      if (!noCommit) await handlers.receive(token);
      if (afterAck) await afterAck();
      if (drop === kind) {
        drop = "";
        throw Error("ACK lost after commit");
      }
      return signed(studioKeys.privateKey, {
        ...ack(
          envelope.job,
          kind === "admission" ? "studio-admission-ack/v1" : "studio-result-ack/v1",
          token,
        ),
        ...ackPatch,
      });
    }),
  };
  return {
    root,
    requestStore,
    deps,
    request,
    issued,
    handlers,
    ledger,
    read,
    save,
    hostKeys,
    studioKeys,
    runtimeKeys,
    requestId,
    userId,
    ack,
    set now(v: number) {
      now = v;
    },
    get now() {
      return now;
    },
    set user(v: string) {
      user = v;
    },
    set revoked(v: boolean) {
      revoked = v;
    },
    set drop(v: string) {
      drop = v;
    },
    set noCommit(v: boolean) {
      noCommit = v;
    },
    set ackPatch(v: Record<string, unknown>) {
      ackPatch = v;
    },
    set stopPatch(v: Record<string, unknown>) {
      stopPatch = v;
    },
    set afterAck(v: (() => Promise<void>) | undefined) {
      afterAck = v;
    },
  };
}
async function composed(f: Awaited<ReturnType<typeof fixture>>) {
  const c = await createManualResearchComposition(f.deps);
  if (!c.available) throw Error("fixture unavailable");
  return c;
}
describe("mandatory composed boundary", () => {
  it("default/production modes expose no run, even with synthetic dependencies", async () => {
    expect(await createManualResearchComposition()).not.toHaveProperty("run");
    const f = await fixture();
    expect(
      await createManualResearchComposition({ ...f.deps, mode: "production" }),
    ).not.toHaveProperty("run");
  });
  it.each([
    "authorize",
    "readApproved",
    "reader",
    "exchange",
    "grantPublicKey",
    "hostPrivateKey",
    "ackPublicKey",
    "runtimePublicKey",
  ])("refuses missing %s", async (field) => {
    const f = await fixture();
    expect(
      await createManualResearchComposition({
        ...f.deps,
        [field]: undefined,
      } as unknown as CompositionDeps),
    ).not.toHaveProperty("run");
  });
  it.each(["inspectPolicy", "profile", "start", "stopExact"])(
    "refuses missing runtime %s",
    async (field) => {
      const f = await fixture();
      expect(
        await createManualResearchComposition({
          ...f.deps,
          runtime: { ...f.deps.runtime, [field]: undefined },
        } as unknown as CompositionDeps),
      ).not.toHaveProperty("run");
    },
  );
  it("requires compatible signed runtime policy", async () => {
    const f = await fixture();
    f.deps.runtime.inspectPolicy = async () =>
      signed(f.runtimeKeys.privateKey, {
        domain: "wrong",
        policyDigest: COMPOSITION_POLICY_SHA256,
        mode: "offline-synthetic",
        issuedAt: 2000,
        expiresAt: 3000,
      });
    expect(await createManualResearchComposition(f.deps)).not.toHaveProperty("run");
  });
  it("composes real local persistence, grant, admission/result ACK and durable review once", async () => {
    const f = await fixture(),
      c = await composed(f);
    expect(
      (await c.run(f.request, { approval: f.issued.approval, grant: f.issued.attestation })).state,
    ).toBe("ready");
    expect(f.ledger.read(f.requestId)!.data.delivery?.ack).toBeTruthy();
    expect(f.read().coordinator_state).toBe("ready");
    await c.run(f.request, { approval: f.issued.approval, grant: f.issued.attestation });
    expect(f.deps.runtime.start).toHaveBeenCalledTimes(1);
    expect((await c.review(f.request, f.requestId, { decision: "save" })).state).toBe("reviewed");
    expect(f.read().result_comment_id).toBeNull();
  });
  it.each([
    "domain",
    "subjectId",
    "requestId",
    "runId",
    "sessionId",
    "approvalDigest",
    "payloadDigest",
    "status",
  ])("rejects mismatched admission ACK %s before starting", async (field) => {
    const f = await fixture();
    f.ackPatch = { [field]: "wrong" };
    const c = await composed(f);
    expect(
      (await c.run(f.request, { approval: f.issued.approval, grant: f.issued.attestation })).state,
    ).toBe("uncertain");
    expect(f.deps.runtime.start).not.toHaveBeenCalled();
  });
  it("rejects no-op ACK and signed ACK without durable admission", async () => {
    const f = await fixture();
    f.noCommit = true;
    const c = await composed(f);
    await c.run(f.request, { approval: f.issued.approval, grant: f.issued.attestation });
    expect(f.deps.runtime.start).not.toHaveBeenCalled();
    const g = await fixture();
    g.deps.exchange = async () => undefined as never;
    await (
      await composed(g)
    ).run(g.request, { approval: g.issued.approval, grant: g.issued.attestation });
    expect(g.deps.runtime.start).not.toHaveBeenCalled();
  });
  it("retains uncertainty when admission commits but ACK is lost; never retries executor", async () => {
    const f = await fixture();
    f.drop = "admission";
    const c = await composed(f);
    await c.run(f.request, { approval: f.issued.approval, grant: f.issued.attestation });
    expect(f.read().coordinator_state).toBe("running");
    expect(f.ledger.read(f.requestId)!.state).toBe("uncertain");
    await c.run(f.request, { approval: f.issued.approval, grant: f.issued.attestation });
    expect(f.deps.runtime.start).not.toHaveBeenCalled();
  });
  it("reconciles result commit/ACK loss without re-execution or premature review", async () => {
    const f = await fixture();
    f.drop = "result";
    const c = await composed(f);
    expect(
      (await c.run(f.request, { approval: f.issued.approval, grant: f.issued.attestation })).state,
    ).toBe("delivery_uncertain");
    expect((await c.read(f.request, f.requestId)).state).toBe("delivery_uncertain");
    await expect(c.review(f.request, f.requestId, { decision: "save" })).rejects.toThrow(
      "delivery_unconfirmed",
    );
    expect((await c.reconcileResult(f.request, f.requestId)).state).toBe("ready");
    expect(f.deps.runtime.start).toHaveBeenCalledTimes(1);
  });
  it.each(["revocation", "expiry"])(
    "rechecks %s during admission acknowledgement",
    async (type) => {
      const f = await fixture();
      f.afterAck = async () => {
        if (type === "revocation") f.revoked = true;
        else f.now = 7000;
      };
      const c = await composed(f);
      await c.run(f.request, { approval: f.issued.approval, grant: f.issued.attestation });
      expect(f.deps.runtime.start).not.toHaveBeenCalled();
    },
  );
  it("rejects a forged grant and another authenticated subject", async () => {
    const f = await fixture(),
      c = await composed(f);
    await expect(
      c.run(f.request, { approval: f.issued.approval, grant: "forged" }),
    ).rejects.toThrow();
    f.user = randomUUID();
    await expect(
      c.run(f.request, { approval: f.issued.approval, grant: f.issued.attestation }),
    ).rejects.toThrow();
    expect(f.deps.runtime.start).not.toHaveBeenCalled();
  });
  it("concurrent duplicate run holds one context and launches once", async () => {
    const f = await fixture(),
      c = await composed(f);
    await Promise.all([
      c.run(f.request, { approval: f.issued.approval, grant: f.issued.attestation }),
      c.run(f.request, { approval: f.issued.approval, grant: f.issued.attestation }),
    ]);
    expect(f.deps.runtime.start).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    "exact-run stop acknowledgement verification (forged=%s)",
    async (forged) => {
      const f = await fixture();
      let started!: (v: void) => void;
      const wait = new Promise<void>((r) => (started = r));
      f.deps.runtime.start = vi.fn(async () => {
        started();
        return {
          completion: new Promise<import("./studio-research-coordinator.server").Capture>(() => {}),
        };
      });
      if (forged) f.stopPatch = { runId: randomUUID() };
      const c = await composed(f),
        run = c.run(f.request, { approval: f.issued.approval, grant: f.issued.attestation });
      await wait;
      const stop = await c.cancel(f.request, f.requestId);
      await run;
      expect(stop.state).toBe(forged ? "uncertain" : "cancelled");
      expect(f.deps.runtime.stopExact).toHaveBeenCalledTimes(1);
    },
  );
  it("cancellation during admission ACK never launches", async () => {
    const f = await fixture();
    let release!: (v: void) => void;
    let entered!: (v: void) => void;
    const gate = new Promise<void>((r) => (release = r)),
      waiting = new Promise<void>((r) => (entered = r));
    f.afterAck = async () => {
      entered();
      await gate;
    };
    const c = await composed(f),
      run = c.run(f.request, { approval: f.issued.approval, grant: f.issued.attestation });
    await waiting;
    await c.cancel(f.request, f.requestId);
    release();
    await run;
    expect(f.deps.runtime.start).not.toHaveBeenCalled();
    expect(f.ledger.read(f.requestId)!.state).toBe("uncertain");
  });
});

import { createManualResearchController } from "./studio-research-manual-controller.server";
async function controllerFixture() {
  const f = await fixture();
  const composition = await composed(f);
  const c = createManualResearchController({
    mode: "offline-synthetic",
    composition,
    issuer: f.handlers,
    ledger: f.ledger,
    prepare: async () => ({ status: "prepared" }),
    loadApproval: async () => f.read().coordinator_approval as typeof f.issued.approval,
  });
  if (!c.available) throw Error("unavailable");
  return { f, c, ids: { organizationId: COORDINATOR.organizationId, requestId: f.requestId } };
}
it("manual controller returns DTOs without grants and repeated start never relaunches", async () => {
  const { f, c, ids } = await controllerFixture();
  const queued = await c.handle(f.request, "read", ids);
  expect(queued.status).toBe("queued");
  const ready = await c.handle(f.request, "start", ids);
  expect(ready.status).toBe("ready");
  expect(JSON.stringify(ready)).not.toContain("attestation");
  expect((await c.handle(f.request, "start", ids)).status).toBe("ready");
  expect(f.deps.runtime.start).toHaveBeenCalledTimes(1);
  expect((await c.handle(f.request, "review", { ...ids, decision: "save" })).decision).toBe("save");
});
it("manual controller preserves pre-admission cancellation across reads and start attempts", async () => {
  const { f, c, ids } = await controllerFixture();
  expect((await c.handle(f.request, "cancel", ids)).status).toBe("result_acceptance_blocked");
  expect((await c.handle(f.request, "read", ids)).status).toBe("result_acceptance_blocked");
  await expect(c.handle(f.request, "start", ids)).rejects.toThrow();
  expect(f.deps.runtime.start).not.toHaveBeenCalled();
});
it("manual controller rejects foreign owners and client approval fields", async () => {
  const { f, c, ids } = await controllerFixture();
  await expect(
    c.handle(f.request, "queue", {
      ...ids,
      topic: "Synthetic",
      approvedUrls: ["https://example.org/article"],
      approved: true,
    }),
  ).rejects.toThrow();
  f.user = randomUUID();
  await expect(c.handle(f.request, "read", ids)).rejects.toThrow("request_not_owned");
  expect(f.deps.runtime.start).not.toHaveBeenCalled();
});

it("controller refuses a second ledger even when request identifiers match", async () => {
  const f = await fixture(),
    other = await fixture();
  const composition = await composed(f);
  const c = createManualResearchController({
    mode: "offline-synthetic",
    composition,
    issuer: f.handlers,
    ledger: other.ledger,
    prepare: async () => ({ status: "prepared" }),
    loadApproval: async () => f.issued.approval,
  });
  expect(c.available).toBe(false);
});
it("controller reconciles delivery without rerunning execution", async () => {
  const { f, c, ids } = await controllerFixture();
  f.drop = "result";
  expect((await c.handle(f.request, "start", ids)).status).toBe("delivery_uncertain");
  expect((await c.handle(f.request, "reconcile", ids)).status).toBe("ready");
  expect(f.deps.runtime.start).toHaveBeenCalledTimes(1);
});
it("controller resumes only an approved unconsumed ledger admission", async () => {
  const { f, c, ids } = await controllerFixture();
  f.ledger.create(f.issued.approval);
  expect((await c.handle(f.request, "start", ids)).status).toBe("ready");
  expect(f.deps.runtime.start).toHaveBeenCalledTimes(1);
});
it("does not persist an ACK that expires during destination verification; fresh reconciliation survives restart", async () => {
  const f = await fixture(),
    original = f.deps.readApproved;
  let delayed = true;
  f.deps.readApproved = async (...args) => {
    const result = await original(...args);
    if (delayed && result?.state === "ready") {
      f.now = 4000;
      delayed = false;
    }
    return result;
  };
  const c = await composed(f);
  expect(
    (await c.run(f.request, { approval: f.issued.approval, grant: f.issued.attestation })).state,
  ).toBe("delivery_uncertain");
  expect(f.ledger.read(f.requestId)!.data.delivery).toBeUndefined();
  expect((await c.reconcileResult(f.request, f.requestId)).state).toBe("ready");
  expect(f.ledger.read(f.requestId)!.data.delivery?.verifiedAt).toBe(4000);
  const reopened = new CoordinatorStore(join(f.root, "host.sqlite"));
  cleanups.push(() => reopened.close());
  const restarted = await createManualResearchComposition({ ...f.deps, store: reopened });
  if (!restarted.available) throw Error("unavailable");
  f.now = 6000;
  expect((await restarted.review(f.request, f.requestId, { decision: "save" })).state).toBe(
    "reviewed",
  );
  expect((await restarted.reconcileResult(f.request, f.requestId)).state).toBe("reviewed");
  expect(f.deps.runtime.start).toHaveBeenCalledTimes(1);
});

import { makeRouteClient, makeRouteHandler } from "./studio-research-route-transport.server";
import {
  makeStudioReceiptOperations,
  makeCoordinatorOperations,
  createRoutePrincipalRegistry,
} from "./studio-research-route-operations.server";
it("runs the concrete bidirectional signed routes through durable admission/result and review using intercepted transport", async () => {
  const f = await fixture(),
    db = new DatabaseSync(":memory:");
  cleanups.push(() => db.close());
  const principles = createRoutePrincipalRegistry(() => f.now);
  f.deps.authorize = principles.authorize;
  const binding = {
    companyId: COORDINATOR.companyId,
    projectId: COORDINATOR.projectId,
    agentId: COORDINATOR.agentId,
    organizationId: COORDINATOR.organizationId,
    subjectId: f.userId,
    requestId: f.requestId,
    issueId: f.issued.approval.issueId,
    approvalDigest: digest(f.issued.approval),
  };
  const studioOps = makeStudioReceiptOperations({
    handlers: f.handlers,
    store: f.requestStore,
    hostKey: f.hostKeys.publicKey,
    studioKey: f.studioKeys.privateKey,
    now: () => f.now,
    currentMember: async (subject) => {
      if (subject !== f.userId) throw Error();
    },
  });
  const studioHandler = makeRouteHandler({
    receiver: "studio",
    peerKey: f.hostKeys.publicKey,
    privateKey: f.studioKeys.privateKey,
    now: () => f.now,
    ledger: createRouteLedger(db),
    authenticate: async (r) => {
      expect(r.headers.has("Authorization")).toBe(false);
    },
    authorizeCurrent: async () => {},
    dispatch: studioOps,
  });
  const relay = makeRouteClient({
    sender: "coordinator",
    privateKey: f.hostKeys.privateKey,
    peerKey: f.studioKeys.publicKey,
    now: () => f.now,
    fetcher: async (u, i) => studioHandler(new Request(u, i)),
  });
  f.deps.exchange = async (kind, receipt) => {
    const reply = (await relay({ ...binding, operation: kind, payload: { receipt } })) as {
      ack: string;
    };
    return reply.ack;
  };
  const c = await composed(f);
  const ops = makeCoordinatorOperations({
    composition: c,
    principals: principles,
    loadApproval: async () => f.issued.approval,
  });
  const hostHandler = makeRouteHandler({
    receiver: "coordinator",
    peerKey: f.studioKeys.publicKey,
    privateKey: f.hostKeys.privateKey,
    now: () => f.now,
    ledger: createRouteLedger(db),
    authenticate: async (r) => {
      if (r.headers.get("Authorization") !== "Bearer pcp_synthetic") throw Error();
    },
    authorizeCurrent: async (e) => {
      const current = (await relay({ ...binding, operation: "authority", payload: {} })) as {
        approval: unknown;
      };
      expect(digest(current.approval)).toBe(e.approvalDigest);
    },
    dispatch: ops,
  });
  const client = makeRouteClient({
    sender: "studio",
    privateKey: f.studioKeys.privateKey,
    peerKey: f.hostKeys.publicKey,
    now: () => f.now,
    bridgeKey: "pcp_synthetic",
    fetcher: async (u, i) => hostHandler(new Request(u, i)),
  });
  expect(
    (
      (await client({
        ...binding,
        operation: "run",
        payload: { approval: f.issued.approval, grant: f.issued.attestation },
      })) as { state: string }
    ).state,
  ).toBe("ready");
  expect(f.read().coordinator_state).toBe("ready");
  expect(f.ledger.read(f.requestId)!.data.delivery).toBeDefined();
  expect(
    (
      (await client({ ...binding, operation: "review", payload: { decision: "save" } })) as {
        state: string;
      }
    ).state,
  ).toBe("reviewed");
  expect(f.deps.runtime.start).toHaveBeenCalledTimes(1);
});

import { makeStudioRemoteActions } from "./studio-research-remote-actions.server";
it("Studio browser adapter authenticates real request and only sends a bound server grant", async () => {
  const f = await fixture();
  const send = vi.fn(async (_input: Parameters<ReturnType<typeof makeRouteClient>>[0]) => ({
    state: "queued",
  }));
  const remote = makeStudioRemoteActions({ store: f.requestStore, issuer: f.handlers, send });
  await remote(f.request, {
    operation: "run",
    organizationId: COORDINATOR.organizationId,
    requestId: f.requestId,
  });
  const command = send.mock.calls[0]![0] as any;
  expect(command.subjectId).toBe(f.userId);
  expect(command.payload.grant).toBeTruthy();
  expect(JSON.stringify(command)).not.toContain("synthetic-user-session");
  f.user = randomUUID();
  await expect(
    remote(f.request, {
      operation: "read",
      organizationId: COORDINATOR.organizationId,
      requestId: f.requestId,
    }),
  ).rejects.toThrow("request_not_owned");
  expect(send).toHaveBeenCalledTimes(1);
});

it("expired route after delayed membership verification cannot mutate receipt storage", async () => {
  const f = await fixture();
  const receive = vi.spyOn(f.handlers, "receive");
  const ops = makeStudioReceiptOperations({
    handlers: f.handlers,
    store: f.requestStore,
    hostKey: f.hostKeys.publicKey,
    studioKey: f.studioKeys.privateKey,
    now: () => f.now,
    currentMember: async () => {
      f.now = 4000;
    },
  });
  const e = {
    domain: "studio-coordinator-route/v1" as const,
    sender: "coordinator" as const,
    companyId: COORDINATOR.companyId,
    projectId: COORDINATOR.projectId,
    agentId: COORDINATOR.agentId,
    organizationId: COORDINATOR.organizationId,
    subjectId: f.userId,
    requestId: f.requestId,
    issueId: f.issued.approval.issueId,
    approvalDigest: digest(f.issued.approval),
    operation: "admission" as const,
    nonce: randomUUID(),
    issuedAt: 1000,
    expiresAt: 3000,
    payload: { receipt: "synthetic" },
  };
  await expect(ops(e)).rejects.toThrow("operation_expired");
  expect(receive).not.toHaveBeenCalled();
  expect(f.read().coordinator_state).toBe("approved");
});

it("preview composition requires distinct signed policy and verifies native session mapping", async () => {
  const f = await fixture("linux-public-preview"),
    c = await composed(f);
  expect(c.mode).toBe("linux-public-preview");
  expect(f.issued.approval.executionPolicySha256).toBe(LINUX_PREVIEW_POLICY_SHA256);
  expect(
    (await c.run(f.request, { approval: f.issued.approval, grant: f.issued.attestation })).state,
  ).toBe("ready");
  expect(f.ledger.read(f.requestId)!.data.completion?.receipt).toMatchObject({
    nativeSession: { id: "native-test-session" },
  });
});
it("preview refuses offline policy proof and mismatched native binding", async () => {
  const offline = await fixture();
  expect(
    (await createManualResearchComposition({ ...offline.deps, mode: "linux-public-preview" }))
      .available,
  ).toBe(false);
  const f = await fixture("linux-public-preview");
  const start = f.deps.runtime.start;
  f.deps.runtime.start = async (input) => {
    const h = await start(input);
    return {
      completion: h.completion.then((c) => ({
        ...c,
        receipt: {
          ...(c.receipt as object),
          nativeSession: { version: 1, id: "native-test-session", bindingDigest: "a".repeat(64) },
        },
      })),
    };
  };
  const c = await composed(f);
  expect(
    (await c.run(f.request, { approval: f.issued.approval, grant: f.issued.attestation })).state,
  ).not.toBe("ready");
});

it("rejects a result ACK substituted for admission without launch",async()=>{const f=await fixture();f.ackPatch={domain:"studio-result-ack/v1"};const c=await composed(f);await c.run(f.request,{approval:f.issued.approval,grant:f.issued.attestation});expect(f.deps.runtime.start).not.toHaveBeenCalled()});
it("rejects an admission ACK substituted for result, preserving delivery uncertainty",async()=>{
 const f=await fixture();f.ackPatch={domain:"studio-admission-ack/v1"};const c=await composed(f);
 expect((await c.run(f.request,{approval:f.issued.approval,grant:f.issued.attestation})).state).toBe("delivery_uncertain");
 expect(f.deps.runtime.start).toHaveBeenCalledTimes(1);expect(f.ledger.read(f.requestId)!.data.delivery).toBeUndefined();
 await expect(c.review(f.request,f.requestId,{decision:"save"})).rejects.toThrow("delivery_unconfirmed");
});
