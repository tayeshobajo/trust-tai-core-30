import { STUDIO_TRIAL_REQUEST_ID, STUDIO_TRIAL_SOURCE } from "@/domain/studio-research-trial";
import { TRIAL_POLICY_SHA256 } from "./studio-research-trial.server";
import { it, expect, vi, afterEach } from "vitest";
import { generateKeyPairSync, randomUUID, createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
const mocked = vi.hoisted(() => ({ spawn: vi.fn(), inspect: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocked.spawn }));
vi.mock("./studio-research-linux-runtime-preflight.server", async (original) => ({
  ...(await original<object>()),
  inspectProtectedLinuxExecutable: mocked.inspect,
}));
import { makePreviewWorker } from "../../packages/studio-research-coordinator/src/preview-bootstrap";
import { createLinuxPublicPreviewComposition } from "./studio-research-linux-composition.server";
import { loadStudioPreviewAssembly } from "./studio-research-preview-startup.server";
import { CoordinatorStore, type Job } from "./studio-research-coordinator-store.server";
import { createRouteLedger } from "./studio-research-route-ledger-node.server";
import { makeStudioReceiptOperations } from "./studio-research-route-operations.server";
import { makeRouteHandler, makeRouteClient, ROUTES } from "./studio-research-route-transport.server";
import { verifySignedJson } from "./studio-research-coordinator-authority.server";
import {
  COORDINATOR,
  PROMPT_POLICY_SHA256,
  LINUX_PREVIEW_POLICY_SHA256,
  approvalSchema,
  digest,
} from "./studio-research-coordinator-contracts";
import { extractSource } from "./studio-research-public-source.server";
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((f) => f());
  vi.useRealTimers();
  vi.restoreAllMocks();
  mocked.spawn.mockReset();
  mocked.inspect.mockReset();
});
function signed(key: KeyObject, p: unknown) {
  const b = Buffer.from(JSON.stringify(p));
  return b.toString("base64url") + "." + sign(null, b, key).toString("base64url");
}
async function fixture(delay = 35000, commandSigner = "studio", grantSigner = "studio", responseSigner = "callback", ackSigner = "callback") {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  vi.spyOn(process, "kill").mockImplementation(() => true);
  const studio = generateKeyPairSync("ed25519"),
    host = generateKeyPairSync("ed25519"),
    callback = generateKeyPairSync("ed25519");
  const root = mkdtempSync(join(tmpdir(), "studio-bootstrap-")),
    store = new CoordinatorStore(join(root, "state.sqlite")),
    nonce = new DatabaseSync(":memory:"),
    studioNonce = new DatabaseSync(":memory:");
  cleanup.push(() => {
    store.close();
    nonce.close();
    studioNonce.close();
    rmSync(root, { recursive: true, force: true });
  });
  const requestId = STUDIO_TRIAL_REQUEST_ID,
    issueId = randomUUID(),
    userId = randomUUID();
  const approval = approvalSchema.parse({
    version: 1,
    promptPolicySha256: PROMPT_POLICY_SHA256,
    executionPolicySha256: LINUX_PREVIEW_POLICY_SHA256,
    request: { requestId, organizationId: COORDINATOR.organizationId, topic: "public fixture" },
    companyId: COORDINATOR.companyId,
    projectId: COORDINATOR.projectId,
    agentId: COORDINATOR.agentId,
    approvedBy: userId,
    approvedAt: 1000,
    expiresAt: 901000,
    approvedUrls: ["https://www.iana.org/help/example-domains"],
    issueId,
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
  const owned: {
    approval: typeof approval;
    state: "approved" | "running" | "ready" | "cancelled";
    revoked: boolean;
    admission?: unknown;
    resultDigest?: string;
  } = { approval, state: "approved", revoked: false };
  const authorityOperation = makeStudioReceiptOperations({
    handlers: {} as never,
    store: {
      read: async () => ({
        created_by: userId,
        coordinator_approval: approval,
        coordinator_state: owned.state,
        coordinator_admission: owned.admission ?? null,
        coordinator_result_digest: owned.resultDigest ?? null,
      }),
    } as never,
    hostKey: host.publicKey,
    studioKey: callback.privateKey,
    now: Date.now,
    currentMember: async () => {},
  });
  const studioHandler = makeRouteHandler({
    receiver: "studio",
    callbackEndpoint: ROUTES.callback,
    peerKey: host.publicKey,
    privateKey: responseSigner === "studio" ? studio.privateKey : callback.privateKey,
    now: Date.now,
    ledger: createRouteLedger(studioNonce),
    authenticate: async () => {},
    authorizeCurrent: async () => {},
    dispatch: async (e) => {
      if (e.operation === "authority") return authorityOperation(e);
      const receipt = (e.payload as { receipt: string }).receipt;
      const { job } = verifySignedJson(host.publicKey, receipt) as { job: Job };
      if (e.operation === "admission") {
        owned.state = "running";
        owned.admission = {
          origin: "coordinator",
          requestId: job.id,
          issueId: job.approval.issueId,
          approvalDigest: job.approvalDigest,
          runId: job.data.runId,
          sessionId: job.data.sessionId,
          evidence: job.data.evidence,
          promptDigest: job.data.promptDigest,
          evidenceDigest: job.data.evidenceDigest,
          launch: job.data.launch,
        };
      } else {
        owned.state = "ready";
        if (job.data.resultDigest) owned.resultDigest = job.data.resultDigest;
      }
      return {
        ack: signed(ackSigner === "studio" ? studio.privateKey : callback.privateKey, {
          domain: e.operation === "admission" ? "studio-admission-ack/v1" : "studio-result-ack/v1",
          companyId: COORDINATOR.companyId,
          projectId: COORDINATOR.projectId,
          agentId: COORDINATOR.agentId,
          subjectId: userId,
          requestId,
          runId: job.data.runId,
          sessionId: job.data.sessionId,
          approvalDigest: job.approvalDigest,
          payloadDigest: digest(receipt),
          issuedAt: Date.now(),
          expiresAt: Date.now() + 30000,
          status: "accepted",
        }),
      };
    },
  });
  const config = {
    version: 3,
    enabled: true,
    mode: "linux-public-preview",
    policyDigest: LINUX_PREVIEW_POLICY_SHA256,
    trial: {
      policyDigest: TRIAL_POLICY_SHA256,
      requestId,
      subjectId: userId,
      source: STUDIO_TRIAL_SOURCE,
      notBefore: 0,
      expiresAt: 3600000,
    },
    studioPublicKeyPem: studio.publicKey.export({ type: "spki", format: "pem" }).toString(),
    callbackPublicKeyPem: callback.publicKey.export({ type: "spki", format: "pem" }).toString(),
    hostSigningKey: { type: "secret_ref", secretId: randomUUID(), version: 1 },
    providerKey: { type: "secret_ref", secretId: randomUUID(), version: 1 },
  };
  const secret = vi.fn(async (_ref: unknown, o: { configPath: string }) =>
    o.configPath === "hostSigningKey"
      ? host.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
      : "synthetic-runtime-provider-key",
  );
  const compose = vi.fn(createLinuxPublicPreviewComposition),
    openState = vi.fn(() => ({ store, ledger: createRouteLedger(nonce), close() {} }));
  const plugin = makePreviewWorker({
    openState,
    compose,
    sourceReader: async () => [
      extractSource(
        "public source text",
        "text/plain",
        "https://www.iana.org/help/example-domains",
        1000,
      ),
    ],
    fetcher: async (u, i) => studioHandler(new Request(u, i)),
    now: Date.now,
  });
  const context = {
    config: { get: vi.fn(async () => config) },
    secrets: { resolve: secret },
    studioResearch: {
      revalidate: vi.fn(async (a: { expiresAt: number }) => {
        if (a.expiresAt <= Date.now()) throw Error("expired");
        return a;
      }),
    },
  };
  await plugin.definition.setup(
    context as unknown as Parameters<typeof plugin.definition.setup>[0],
  );
  mocked.spawn.mockImplementation(() => {
    const c = Object.assign(new EventEmitter(), {
      pid: 12345,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    setTimeout(() => {
      c.stdout.write(
        [
          { type: "step_start", sessionID: "native" },
          {
            type: "text",
            sessionID: "native",
            part: {
              text: JSON.stringify({
                research: { version: 1, requestId, topics: [], limitations: ["fixture"] },
                people: [],
                draft: null,
              }),
            },
          },
          { type: "step_finish", sessionID: "native", part: { reason: "stop" } },
        ]
          .map((e) => JSON.stringify(e))
          .join("\n"),
      );
      c.emit("close", 0);
    }, delay);
    return c;
  });
  const grant = signed(grantSigner === "callback" ? callback.privateKey : studio.privateKey, {
    version: 1,
    issuer: "studio-approved-task",
    audience: "studio-research-coordinator",
    subjectId: userId,
    organizationId: COORDINATOR.organizationId,
    companyId: COORDINATOR.companyId,
    agentId: COORDINATOR.agentId,
    projectId: COORDINATOR.projectId,
    requestId,
    issueId,
    approvalDigest: digest(approval),
    issuedAt: 1000,
    expiresAt: 901000,
    actions: ["approve", "run", "read", "cancel", "review"],
  });
  const client = makeRouteClient({
    sender: "studio",
    privateKey: commandSigner === "callback" ? callback.privateKey : studio.privateKey,
    peerKey: host.publicKey,
    bridgeKey: "pcp_synthetic",
    now: Date.now,
    fetcher: async (u, i) => {
      const request = new Request(u, i),
        body = await request.json();
      // Synthetic host-admission fixture parses metadata; worker must independently verify signature.
      const envelope = JSON.parse(Buffer.from(body.token.split(".")[0], "base64url").toString()) as { expiresAt: number };
      expect(envelope.expiresAt - Date.now()).toBe(60000);
      const admission = {
        version: 1 as const,
        admissionId: randomUUID(),
        pluginKey: "trusttai.studio-research-coordinator" as const,
        companyId: COORDINATOR.companyId,
        projectId: COORDINATOR.projectId,
        agentId: COORDINATOR.agentId,
        requestId,
        issueId,
        operation: "run" as const,
        bodyDigest: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
        expiresAt: Date.now() + 60000,
      };
      const result = await plugin.definition.onApiRequest!({
        companyId: COORDINATOR.companyId,
        method: "POST",
        path: `/issues/${issueId}/research/${requestId}/run`,
        routeKey: "signed-run",
        params: { issueId, requestId },
        query: {},
        body,
        headers: {},
        actor: { actorType: "agent", actorId: COORDINATOR.agentId },
        studioAdmission: admission,
      } as Parameters<NonNullable<typeof plugin.definition.onApiRequest>>[0]);
      return Response.json(result.body, { status: result.status ?? 200 });
    },
  });
  const run = () =>
    client({
      companyId: COORDINATOR.companyId,
      projectId: COORDINATOR.projectId,
      agentId: COORDINATOR.agentId,
      organizationId: COORDINATOR.organizationId,
      subjectId: userId,
      requestId,
      issueId,
      approvalDigest: digest(approval),
      operation: "run",
      payload: { approval, grant },
    });
  return { run, store, requestId, context, compose, openState, secret, plugin, owned };
}
it("actual configured worker selects host-admitted Linux composition and accepts completion after 30 seconds", async () => {
  const f = await fixture();
  const pending = f.run();
  await vi.advanceTimersByTimeAsync(36000);
  const result = await pending;
  expect(result).toMatchObject({ state: "ready" });
  expect(f.compose).toHaveBeenCalledOnce();
  expect(mocked.spawn).toHaveBeenCalledOnce();
  expect(f.secret).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ configPath: "providerKey" }),
  );
  expect(f.store.read(f.requestId)?.data.completion?.receipt).toMatchObject({
    nativeSession: { id: "native" },
  });
});
it("assembled preview cuts off CLI before invocation expiry and never retries a consumed launch", async () => {
  const f = await fixture(60000);
  const pending = f.run().catch((e) => e);
  await vi.advanceTimersByTimeAsync(62000);
  await pending;
  expect(f.store.read(f.requestId)?.state).not.toBe("ready");
  expect(mocked.spawn).toHaveBeenCalledOnce();
  const again = f.run().catch((e) => e);
  await vi.advanceTimersByTimeAsync(1);
  await again;
  expect(mocked.spawn).toHaveBeenCalledOnce();
});
it("missing or invalid worker config remains closed before state or secrets", async () => {
  const f = await fixture();
  f.context.config.get.mockResolvedValue({ enabled: false } as never);
  const pending = f.run().catch((e) => e);
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(f.openState).not.toHaveBeenCalled();
  expect(f.secret).not.toHaveBeenCalled();
  expect(mocked.spawn).not.toHaveBeenCalled();
});
it("Studio startup uses preview assembly only with explicit matching config and secrets", () => {
  const keys = generateKeyPairSync("ed25519"),
    assemble = vi.fn(() => ({
      application: vi.fn(),
      receiptHandler: vi.fn(),
      receiptOperations: vi.fn(),
    }));
  const env = {
    STUDIO_RESEARCH_PREVIEW_CONFIG: JSON.stringify({
      version: 2,
      mode: "linux-public-preview",
      enabled: true,
      policyDigest: LINUX_PREVIEW_POLICY_SHA256,
      trial: {
        policyDigest: TRIAL_POLICY_SHA256,
        requestId: STUDIO_TRIAL_REQUEST_ID,
        subjectId: "11111111-1111-4111-8111-111111111111",
        source: STUDIO_TRIAL_SOURCE,
        notBefore: 0,
        expiresAt: 3600000,
      },
      coordinatorPublicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    }),
    STUDIO_RESEARCH_SIGNING_PRIVATE_KEY: keys.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    TRUST_TAI_SUPABASE_SERVICE_KEY: "synthetic-service-key",
    PAPERCLIP_STUDIO_BRIDGE_KEY: "pcp_synthetic",
  };
  expect(loadStudioPreviewAssembly({}, assemble as never)).toBeUndefined();
  expect(
    loadStudioPreviewAssembly(
      { ...env, STUDIO_RESEARCH_SIGNING_PRIVATE_KEY: "" },
      assemble as never,
    ),
  ).toBeUndefined();
  const report = vi.fn();
  expect(loadStudioPreviewAssembly({ ...env, STUDIO_RESEARCH_SIGNING_PRIVATE_KEY: "sensitive-invalid-value" }, assemble as never, report)).toBeUndefined();
  expect(report).toHaveBeenLastCalledWith("private_key_envelope_invalid");
  report.mockClear();
  expect(loadStudioPreviewAssembly({ ...env, STUDIO_RESEARCH_PREVIEW_CONFIG: "private-invalid-config" }, assemble as never, report)).toBeUndefined();
  expect(report).toHaveBeenLastCalledWith("config_invalid");
  expect(loadStudioPreviewAssembly(env, assemble as never)).toBeDefined();
  expect(assemble).toHaveBeenCalledWith(expect.objectContaining({ mode: "linux-public-preview" }));
});

it("Studio revocation during credential resolution prevents actual startup spawn", async () => {
  const f = await fixture();
  const resolve = f.secret.getMockImplementation()!;
  f.secret.mockImplementation(async (ref, o) => {
    if (o.configPath === "providerKey") f.owned.state = "cancelled";
    return resolve(ref, o);
  });
  const pending = f.run().catch((e) => e);
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(mocked.spawn).not.toHaveBeenCalled();
});

it("shutdown aborts a pending authorized startup before spawn and waits before closing state", async () => {
  const f = await fixture();
  let providerResolved = false;
  const secret = f.secret.getMockImplementation()!;
  f.secret.mockImplementation(async (ref, o) => {
    const value = await secret(ref, o);
    if (o.configPath === "providerKey") providerResolved = true;
    return value;
  });
  let release!: () => void;
  let paused = false;
  f.context.studioResearch.revalidate.mockImplementation(async (a) => {
    if (providerResolved) {
      paused = true;
      await new Promise<void>((r) => (release = r));
    }
    return a;
  });
  const pending = f.run().catch((e) => e);
  await vi.advanceTimersByTimeAsync(1);
  expect(paused).toBe(true);
  const state = f.openState.mock.results[0]!.value;
  const close = vi.spyOn(state, "close");
  const stopping = f.plugin.definition.onShutdown!();
  expect(close).not.toHaveBeenCalled();
  release();
  await stopping;
  await pending;
  expect(mocked.spawn).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});

it("trial subject and expiry reject before host secrets, state, or spawn", async () => {
  const f = await fixture();
  const config = await f.context.config.get();
  f.context.config.get.mockResolvedValue({
    ...config,
    trial: { ...config.trial, subjectId: randomUUID() },
  });
  await f.run().catch(() => undefined);
  expect(f.secret).not.toHaveBeenCalled();
  expect(f.openState).not.toHaveBeenCalled();
  f.context.config.get.mockResolvedValue({
    ...config,
    trial: { ...config.trial, notBefore: 0, expiresAt: 1000 },
  });
  await f.run().catch(() => undefined);
  expect(f.secret).not.toHaveBeenCalled();
  expect(f.openState).not.toHaveBeenCalled();
  expect(mocked.spawn).not.toHaveBeenCalled();
});

it.each(["command", "grant", "response", "ack"])("separate callback trust rejects wrong signer at %s boundary without spawn", async boundary => {
 const f=await fixture(35000,boundary==="command"?"callback":"studio",boundary==="grant"?"callback":"studio",boundary==="response"?"studio":"callback",boundary==="ack"?"studio":"callback");
 const pending=f.run().catch(e=>e);await vi.advanceTimersByTimeAsync(36000);await pending;
 expect(mocked.spawn).not.toHaveBeenCalled();
});
it("rejects same canonical Studio/callback key despite PEM whitespace differences before secrets/state",async()=>{
 const f=await fixture();const c=await f.context.config.get();c.callbackPublicKeyPem="\n"+c.studioPublicKeyPem+"\n";
 const pending=f.run().catch(e=>e);await vi.advanceTimersByTimeAsync(1);await pending;
 expect(f.secret).not.toHaveBeenCalled();expect(f.openState).not.toHaveBeenCalled();
});

it.each(["studioPublicKeyPem","callbackPublicKeyPem","hostSigningKey"])("rejects diagnostic identity in active host %s before state/provider access",async role=>{
 const f=await fixture();
 const diagnostic=createPrivateKey({type:"pkcs8",format:"der",key:Buffer.from("302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60","hex")});
 if(role==="hostSigningKey") f.secret.mockResolvedValue(diagnostic.export({type:"pkcs8",format:"pem"}).toString());
 else {const config=await f.context.config.get();config[role as "studioPublicKeyPem"|"callbackPublicKeyPem"]="\n"+createPublicKey(diagnostic).export({type:"spki",format:"pem"}).toString().replace(/\n/g,"\r\n")+"\n";}
 const pending=f.run().catch(e=>e);await vi.advanceTimersByTimeAsync(1);await pending;
 expect(f.openState).not.toHaveBeenCalled();expect(mocked.spawn).not.toHaveBeenCalled();
 if(role!=="hostSigningKey")expect(f.secret).not.toHaveBeenCalled();
 else expect(f.secret.mock.calls.every(c=>c[1].configPath==="hostSigningKey")).toBe(true);
});
