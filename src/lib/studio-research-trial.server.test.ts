import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Worker } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { buildSync } from "esbuild";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { CoordinatorStore } from "./studio-research-coordinator-store.server";
import {
  trialConfigSchema,
  TRIAL_POLICY_SHA256,
  assertTrialApproval,
  assertTrialWindow,
} from "./studio-research-trial.server";
import { STUDIO_TRIAL_REQUEST_ID, STUDIO_TRIAL_SOURCE } from "@/domain/studio-research-trial";
import {
  approvalSchema,
  COORDINATOR,
  LINUX_PREVIEW_POLICY_SHA256,
  PROMPT_POLICY_SHA256,
} from "./studio-research-coordinator-contracts";
import { assembleLinuxPreviewStudio } from "./studio-research-studio-assembly.server";
const clean: (() => void)[] = [];
afterEach(() =>
  clean
    .splice(0)
    .reverse()
    .forEach((f) => f()),
);
function fixture() {
  const trial = trialConfigSchema.parse({
    policyDigest: TRIAL_POLICY_SHA256,
    requestId: STUDIO_TRIAL_REQUEST_ID,
    source: STUDIO_TRIAL_SOURCE,
    subjectId: randomUUID(),
    notBefore: 1000,
    expiresAt: 61000,
  });
  const approval = approvalSchema.parse({
    version: 1,
    promptPolicySha256: PROMPT_POLICY_SHA256,
    executionPolicySha256: LINUX_PREVIEW_POLICY_SHA256,
    request: {
      requestId: trial.requestId,
      organizationId: COORDINATOR.organizationId,
      topic: "IANA public source trial",
    },
    companyId: COORDINATOR.companyId,
    projectId: COORDINATOR.projectId,
    agentId: COORDINATOR.agentId,
    approvedBy: trial.subjectId,
    approvedAt: 1000,
    expiresAt: 61000,
    approvedUrls: [trial.source],
    issueId: randomUUID(),
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
  const root = mkdtempSync(join(tmpdir(), "studio-single-trial-"));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "state.sqlite");
  return { trial, approval, root, path };
}
it("fixed request/source, bounded window, and exact authority cannot be widened", () => {
  const { trial, approval } = fixture();
  for (const change of [
    { requestId: randomUUID() },
    { source: trial.source + "/" },
    { subjectId: "not-a-uuid" },
    { expiresAt: trial.notBefore + 3600001 },
    { policyDigest: "0".repeat(64) },
    { extra: true },
  ])
    expect(() => trialConfigSchema.parse({ ...trial, ...change })).toThrow();
  for (const a of [
    { ...approval, approvedBy: randomUUID() },
    { ...approval, request: { ...approval.request, requestId: randomUUID() } },
    { ...approval, companyId: randomUUID() },
    { ...approval, approvedUrls: [trial.source, "https://example.com"] },
    { ...approval, approvedUrls: ["https://example.com"] },
  ])
    expect(() => assertTrialApproval(trial, a as unknown as typeof approval)).toThrow();
  for (const now of [999, 61000, NaN, Infinity])
    expect(() => assertTrialWindow(trial, now)).toThrow();
});
it("consumption survives crash/reopen, config changes, and attempted ledger mutation", () => {
  const { trial, approval, path } = fixture();
  let store = new CoordinatorStore(path);
  store.consumeTrial(trial, approval, 1000);
  store.close(); // crash immediately after admission: no launch or job row is required
  store = new CoordinatorStore(path);
  clean.push(() => store.close());
  expect(() => store.consumeTrial(trial, approval, 1001)).toThrow("trial_already_consumed");
  const subject = randomUUID();
  expect(() =>
    store.consumeTrial(
      { ...trial, subjectId: subject },
      { ...approval, approvedBy: subject },
      1001,
    ),
  ).toThrow("trial_already_consumed");
  const db = new DatabaseSync(path);
  try {
    expect(() => db.exec("DELETE FROM single_trial_admission")).toThrow();
    expect(() => db.exec("UPDATE single_trial_admission SET binding='changed'")).toThrow();
  } finally {
    db.close();
  }
  expect(store.read(trial.requestId)).toBeNull();
});
it("six concurrent independent SQLite connections admit exactly once", async () => {
  const { trial, approval, path, root } = fixture();
  const store = new CoordinatorStore(path);
  store.close();
  const bundle = join(root, "store.mjs");
  buildSync({
    entryPoints: [resolve("src/lib/studio-research-coordinator-store.server.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bundle,
    alias: { "@": resolve("src") },
  });
  const workers = Array.from(
    { length: 6 },
    () =>
      new Worker(
        `const {parentPort,workerData}=require('node:worker_threads');(async()=>{const {CoordinatorStore}=await import(workerData.bundle);const s=new CoordinatorStore(workerData.path);parentPort.postMessage('ready');parentPort.once('message',()=>{try{s.consumeTrial(workerData.trial,workerData.approval,1000);parentPort.postMessage('admitted')}catch(e){parentPort.postMessage(e.message)}finally{s.close()}})})().catch(e=>{throw e})`,
        { eval: true, workerData: { bundle: "file://" + bundle, path, trial, approval } },
      ),
  );
  clean.push(() =>
    workers.forEach((w) => {
      void w.terminate();
    }),
  );
  await Promise.all(
    workers.map(
      (w) =>
        new Promise((res, rej) => {
          w.once("message", res);
          w.once("error", rej);
        }),
    ),
  );
  const results = workers.map(
    (w) =>
      new Promise<string>((res, rej) => {
        w.once("message", res);
        w.once("error", rej);
      }),
  );
  workers.forEach((w) => w.postMessage("go"));
  const values = await Promise.all(results);
  expect(values.filter((v) => v === "admitted")).toHaveLength(1);
  expect(values.filter((v) => v === "trial_already_consumed")).toHaveLength(5);
});
it("Studio rejects wrong subject, request, source and expired start before storage/transport", async () => {
  const { trial } = fixture();
  const pair = generateKeyPairSync("ed25519");
  const network = vi.fn(async () => {
    throw Error("unexpected_network");
  });
  let subject = trial.subjectId,
    now = 1000;
  const authorize = vi.fn(async () => ({ user: { id: subject } }));
  const assembly = assembleLinuxPreviewStudio(
    {
      mode: "linux-public-preview",
      trial,
      studioPrivateKey: pair.privateKey,
      coordinatorPublicKey: pair.publicKey,
      serviceKey: "synthetic",
      bridgeKey: "pcp_synthetic",
      fetcher: network,
      client: {
        from: vi.fn(() => {
          throw Error("unexpected_db");
        }),
      } as never,
      now: () => now,
    },
    authorize as never,
  );
  const req = new Request("https://cmd.trusttai.com/_serverFn/manual", { method: "POST" });
  const queue = {
    operation: "queue",
    organizationId: COORDINATOR.organizationId,
    requestId: trial.requestId,
    topic: "IANA test",
    approvedUrls: [trial.source],
  };
  subject = randomUUID();
  await expect(assembly.application(req, queue)).rejects.toThrow("trial_scope_rejected");
  subject = trial.subjectId;
  await expect(assembly.application(req, { ...queue, requestId: randomUUID() })).rejects.toThrow(
    "trial_scope_rejected",
  );
  await expect(
    assembly.application(req, { ...queue, approvedUrls: ["https://example.com"] }),
  ).rejects.toThrow("trial_source_rejected");
  now = trial.expiresAt;
  await expect(
    assembly.application(req, {
      operation: "start",
      organizationId: COORDINATOR.organizationId,
      requestId: trial.requestId,
    }),
  ).rejects.toThrow("trial_expired");
  expect(network).not.toHaveBeenCalled();
});
