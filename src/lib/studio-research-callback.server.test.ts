import { it, expect, vi, afterEach } from "vitest";
import { generateKeyPairSync, sign, randomUUID, type KeyObject } from "node:crypto";
import { createCallbackHandler } from "./studio-research-callback.server";
import { createStudioCoordinatorHandlers } from "./studio-research-coordinator-studio.server";
import { verifySignedJson } from "./studio-research-coordinator-authority.server";
import { COORDINATOR, digest, coordinatorPrompt } from "./studio-research-coordinator-contracts";
import {
  ROUTES,
  type RouteEnvelope,
  type RouteLedger,
} from "./studio-research-route-transport.server";
import { TRIAL_POLICY_SHA256, trialConfigSchema } from "./studio-research-trial.server";
import { STUDIO_TRIAL_REQUEST_ID, STUDIO_TRIAL_SOURCE } from "@/domain/studio-research-trial";
import { extractSource } from "./studio-research-public-source.server";
import type {
  CoordinatorRow,
  CoordinatorRequestStore,
} from "./studio-research-coordinator-request-store.server";
afterEach(() => vi.unstubAllGlobals());
const signed = (k: KeyObject, p: unknown) => {
  const b = Buffer.from(JSON.stringify(p));
  return b.toString("base64url") + "." + sign(null, b, k).toString("base64url");
};
async function fixture() {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("network_forbidden");
    }),
  );
  const studio = generateKeyPairSync("ed25519"),
    host = generateKeyPairSync("ed25519"),
    callback = generateKeyPairSync("ed25519");
  let now = 2000,
    member = true,
    ambiguous = false;
  let row: CoordinatorRow = {
    id: randomUUID(),
    organization_id: COORDINATOR.organizationId,
    request_id: STUDIO_TRIAL_REQUEST_ID,
    created_by: randomUUID(),
    topic: "IANA example",
    company_id: COORDINATOR.companyId,
    agent_id: COORDINATOR.agentId,
    issue_id: randomUUID(),
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
  const store: CoordinatorRequestStore = {
    read: vi.fn(async () => row),
    approve: async (_r, a) =>
      (row = {
        ...row,
        coordinator_state: "approved",
        coordinator_approval: a,
        coordinator_approval_digest: digest(a),
      }),
    admit: vi.fn(async (_r, a) => {
      row = { ...row, coordinator_state: "running", coordinator_admission: a };
      if (ambiguous) throw Error("write_unconfirmed");
      return row;
    }),
    accept: vi.fn(
      async (_r, b) =>
        (row = {
          ...row,
          coordinator_state: "ready",
          coordinator_brief: b,
          coordinator_result_digest: digest(b),
        }),
    ),
    cancel: async () => null,
  };
  const issuer = createStudioCoordinatorHandlers(
    {
      store,
      enabled: true,
      executionMode: "linux-public-preview",
      approvalPrivateKey: studio.privateKey,
      receiptPublicKey: host.publicKey,
      now: () => now,
    },
    async () => ({ user: { id: row.created_by } }) as never,
  );
  const { approval } = await issuer.approve(new Request("https://local/", { method: "POST" }), {
    organizationId: row.organization_id,
    requestId: row.request_id,
    approvedUrls: [STUDIO_TRIAL_SOURCE],
  });
  const trial = trialConfigSchema.parse({
    policyDigest: TRIAL_POLICY_SHA256,
    requestId: row.request_id,
    subjectId: row.created_by,
    source: STUDIO_TRIAL_SOURCE,
    notBefore: 1000,
    expiresAt: 61000,
  });
  const claims = new Map<string, { hash: string; response: string | null }>();
  const ledger: RouteLedger = {
    claim: vi.fn((e) => {
      const old = claims.get(e.nonce);
      if (old) {
        if (old.hash !== digest(e)) throw Error("replay");
        return { claimed: false, response: old.response };
      }
      claims.set(e.nonce, { hash: digest(e), response: null });
      return { claimed: true, response: null };
    }),
    finish: vi.fn((e, t) => {
      claims.get(e.nonce)!.response = t;
    }),
  };
  const currentMember = vi.fn(async () => {
    if (!member) throw Error("revoked");
  });
  const deps = {
    callbackPrivateKey: callback.privateKey,
    studioPublicKey: studio.publicKey,
    hostPublicKey: host.publicKey,
    trial,
    store,
    ledger,
    currentMember,
    now: () => now,
  };
  const handler = createCallbackHandler(deps);
  const envelope = (
    operation: RouteEnvelope["operation"] = "authority",
    payload: unknown = {},
  ): RouteEnvelope => ({
    domain: "studio-coordinator-route/v1",
    sender: "coordinator",
    companyId: COORDINATOR.companyId,
    projectId: COORDINATOR.projectId,
    agentId: COORDINATOR.agentId,
    organizationId: COORDINATOR.organizationId,
    subjectId: row.created_by,
    requestId: row.request_id,
    issueId: row.issue_id!,
    approvalDigest: digest(approval),
    operation,
    nonce: randomUUID(),
    issuedAt: now,
    expiresAt: now + 30000,
    payload,
    binding:{method:"POST",destination:`${ROUTES.callback}/${row.request_id}/${operation}`},
  });
  const call = (
    e = envelope(),
    key = host.privateKey,
    url = ROUTES.callback + `/${e.requestId}/${e.operation}`,
    method = "POST",
  ) =>
    handler(
      new Request(url, {
        method,
        ...(method === "GET" ? {} : { body: JSON.stringify({ token: signed(key, e) }) }),
      }),
    );
  const evidence = [extractSource("IANA public example", "text/plain", STUDIO_TRIAL_SOURCE, 2000)];
  const job = {
    id: row.request_id,
    state: "running",
    revision: 1,
    approval,
    approvalDigest: digest(approval),
    data: {
      runId: randomUUID(),
      sessionId: "synthetic",
      evidence,
      evidenceDigest: digest(evidence),
      promptDigest: digest(coordinatorPrompt(approval, evidence)),
      launch: {
        nonce: randomUUID(),
        startedAt: 2000,
        launchDeadline: 7000,
        completionDeadline: 62000,
        profile: {
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
        },
      },
    },
  };
  const receipt = (stage: "admission" | "result", j: unknown = job) =>
    signed(host.privateKey, {
      issuer: "studio-coordinator-receipt",
      audience: "studio-existing-request",
      stage,
      issuedAt: now,
      expiresAt: now + 60000,
      job: j,
    });
  return {
    studio,
    host,
    callback,
    deps,
    handler,
    call,
    envelope,
    ledger,
    store,
    currentMember,
    job,
    receipt,
    get row() {
      return row;
    },
    setNow: (n: number) => {
      now = n;
    },
    revoke: () => {
      member = false;
    },
    cancel: () => {
      row.coordinator_state = "cancelled";
    },
    ambiguous: () => {
      ambiguous = true;
    },
  };
}
it("signs authority only with separate callback identity, and denies key reuse", async () => {
  const f = await fixture();
  const r = await f.call();
  expect(r.status).toBe(200);
  const t = (await r.json()).token;
  expect(verifySignedJson(f.callback.publicKey, t)).toMatchObject({
    body: { approval: f.job.approval },
  });
  expect(() => verifySignedJson(f.studio.publicKey, t)).toThrow();
  expect(() =>
    createCallbackHandler({ ...f.deps, callbackPrivateKey: f.studio.privateKey }),
  ).toThrow("not_separate");
  expect(() => createCallbackHandler({ ...f.deps, callbackPrivateKey: f.host.privateKey })).toThrow(
    "not_separate",
  );
  for (const key of [f.studio.privateKey, f.callback.privateKey])
    expect((await f.call(f.envelope(), key)).status).toBe(403);
});
it("rejects exact route, method, operation, scope, expiry and tampered body before ledger", async () => {
  const f = await fixture();
  for (const patch of [
    { requestId: randomUUID() },
    { subjectId: randomUUID() },
    { sender: "studio" },
    { operation: "run" },
    { operation: "read" },
    { operation: "cancel" },
    { operation: "review" },
    { operation: "reconcile" },
    { expiresAt: 2000 },
    { issuedAt: 3000 },
    { approvalDigest: "0".repeat(64) },
  ])
    expect((await f.call({ ...f.envelope(), ...patch } as RouteEnvelope)).status).toBe(403);
  for (const suffix of ["?x=1", "/", "/extra"])
    expect(
      (
        await f.call(
          f.envelope(),
          f.host.privateKey,
          ROUTES.callback + `/${f.job.id}/authority` + suffix,
        )
      ).status,
    ).toBe(403);
  expect(
    (await f.call(f.envelope(), f.host.privateKey, ROUTES.studio + `/${f.job.id}/authority`))
      .status,
  ).toBe(403);
  expect((await f.call(f.envelope(), f.host.privateKey, undefined, "GET")).status).toBe(403);
  const e = f.envelope(),
    token = signed(f.host.privateKey, e);
  expect(
    (
      await f.handler(
        new Request(ROUTES.callback + `/${f.job.id}/authority`, {
          method: "POST",
          body: JSON.stringify({ token: token.slice(0, -4) + "AAAA" }),
        }),
      )
    ).status,
  ).toBe(403);
  expect(f.ledger.claim).not.toHaveBeenCalled();
});
it("caches exact replay, rejects mutated nonce, and rechecks revoked membership even on replay", async () => {
  const f = await fixture(),
    e = f.envelope();
  const one = await (await f.call(e)).text();
  expect(await (await f.call(e)).text()).toBe(one);
  expect(f.ledger.finish).toHaveBeenCalledTimes(1);
  expect((await f.call({ ...e, payload: { changed: true } })).status).toBe(403);
  f.revoke();
  expect((await f.call(e)).status).toBe(403);
});
it("rejects revocation between claim and effect", async () => {
  const f = await fixture();
  const original = f.ledger.claim;
  f.ledger.claim = vi.fn(async (e) => {
    const result = await original(e);
    f.revoke();
    return result;
  });
  expect((await f.call()).status).toBe(403);
  expect(f.ledger.finish).not.toHaveBeenCalled();
});
it("ambiguous admission consumes nonce; retry cannot repeat write or pretend success", async () => {
  const f = await fixture();
  f.ambiguous();
  const e = f.envelope("admission", { receipt: f.receipt("admission") });
  expect((await f.call(e)).status).toBe(403);
  expect((await f.call(e)).status).toBe(409);
  expect(f.store.admit).toHaveBeenCalledTimes(1);
  expect(f.ledger.finish).not.toHaveBeenCalled();
});
it("admits once and settles signed result after trial expiry without launching or resetting", async () => {
  const f = await fixture();
  const admission = await f.call(f.envelope("admission", { receipt: f.receipt("admission") }));
  expect(admission.status).toBe(200);
  const outer = verifySignedJson(f.callback.publicKey, (await admission.json()).token) as {
    body: { ack: string };
  };
  expect(verifySignedJson(f.callback.publicKey, outer.body.ack)).toMatchObject({
    domain: "studio-admission-ack/v1",
    status: "accepted",
  });
  expect(() => verifySignedJson(f.studio.publicKey, outer.body.ack)).toThrow();
  const result = {
    research: { version: 1, requestId: f.job.id, topics: [], limitations: ["Synthetic only"] },
    people: [],
    draft: null,
  };
  const job = {
    ...f.job,
    state: "ready",
    data: {
      ...f.job.data,
      result,
      resultDigest: digest(result),
      completion: {
        receipt: {
          requestId: f.job.id,
          issueId: f.job.approval.issueId,
          runId: f.job.data.runId,
          sessionId: f.job.data.sessionId,
          agentId: COORDINATOR.agentId,
          projectId: COORDINATOR.projectId,
          exitCode: 0,
          timedOut: false,
          attempts: 1,
        },
        outputDigest: "a".repeat(64),
        providerRequests: null,
        accounting: {
          mode: "cli-job-unmetered-provider",
          cliJobs: 1,
          coordinatorRetries: 0,
          providerRequests: null,
          immediateChildClosed: true,
        },
        completedAt: 3000,
      },
    },
  };
  f.setNow(70000);
  expect((await f.call()).status).toBe(200);
  expect((await f.call(f.envelope("admission", { receipt: f.receipt("admission") }))).status).toBe(
    403,
  );
  const e = f.envelope("result", { receipt: f.receipt("result", job) });
  const finish = f.ledger.finish;
  f.ledger.finish = () => {
    throw Error("result_response_lost");
  };
  expect((await f.call(e)).status).toBe(403);
  expect(f.row.coordinator_result_digest).toBe(digest(result));
  expect((await f.call(e)).status).toBe(409);
  f.ledger.finish = finish;
  const fresh = f.envelope("result", { receipt: f.receipt("result", job) });
  expect((await f.call(fresh)).status).toBe(200);
  expect((await f.call(fresh)).status).toBe(200);
  expect(f.store.accept).toHaveBeenCalledTimes(1);
  f.cancel();
  expect((await f.call(f.envelope("result", { receipt: f.receipt("result", job) }))).status).toBe(
    403,
  );
  expect(fetch).not.toHaveBeenCalled();
});

it("concurrent duplicate admission dispatches once; missing nonce finish remains uncertain", async () => {
  const f = await fixture();
  const e = f.envelope("admission", { receipt: f.receipt("admission") });
  const replies = await Promise.all([f.call(e), f.call(e)]);
  expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(f.store.admit).toHaveBeenCalledTimes(1);
  const g = await fixture();
  g.ledger.finish = vi.fn(() => {
    throw Error("finish_lost");
  });
  const lost = g.envelope("admission", { receipt: g.receipt("admission") });
  expect((await g.call(lost)).status).toBe(403);
  expect((await g.call(lost)).status).toBe(409);
  expect(g.store.admit).toHaveBeenCalledTimes(1);
  // A fresh envelope reconciles the committed same admission; no repeated write or launch.
  g.ledger.finish = vi.fn();
  expect((await g.call(g.envelope("admission", lost.payload))).status).toBe(200);
  expect(g.store.admit).toHaveBeenCalledTimes(1);
});
it("revocation while a write is awaited suppresses ACK even if the write committed", async () => {
  const f = await fixture();
  const admit = f.store.admit;
  f.store.admit = vi.fn(async (r, a) => {
    const v = await admit(r, a);
    f.revoke();
    return v;
  });
  expect((await f.call(f.envelope("admission", { receipt: f.receipt("admission") }))).status).toBe(
    403,
  );
  expect(f.row.coordinator_state).toBe("running");
  expect(f.ledger.finish).not.toHaveBeenCalled();
});
it("rejects aliases, encoded path, wrong project/function and forwarding-header identity", async () => {
  const f = await fixture();
  const e = f.envelope(),
    canonical = ROUTES.callback + `/${e.requestId}/authority`;
  for (const url of [
    canonical.replace("okydosoacqdnursmmenf", "wrong-project"),
    canonical.replace("studio-research-coordinator/", "other-function/"),
    canonical.replace("/authority", "/%61uthority"),
    canonical.replace(".supabase.co", ".example.org"),
  ]) {
    expect(
      (
        await f.handler(
          new Request(url, {
            method: "POST",
            headers: {
              "x-forwarded-host": "okydosoacqdnursmmenf.supabase.co",
              "x-original-url": canonical,
            },
            body: JSON.stringify({ token: signed(f.host.privateKey, e) }),
          }),
        )
      ).status,
    ).toBe(403);
  }
  expect(f.ledger.claim).not.toHaveBeenCalled();
});

it("rejects source/issue binding changes and membership revocation during an awaited read", async () => {
  const f = await fixture();
  expect((await f.call({ ...f.envelope(), issueId: randomUUID() })).status).toBe(403);
  f.job.approval.approvedUrls = ["https://example.org/wrong"];
  expect((await f.call()).status).toBe(403);
  expect(f.ledger.claim).not.toHaveBeenCalled();
  const g = await fixture();
  const read = g.store.read;
  g.store.read = vi.fn(async (org, id) => {
    const row = await read(org, id);
    g.revoke();
    return row;
  });
  expect((await g.call()).status).toBe(403);
  expect(g.ledger.claim).not.toHaveBeenCalled();
});
it.each(["id", "approvalDigest", "runId", "sessionId"])(
  "rejects changed receipt binding %s without admission write",
  async (field) => {
    const f = await fixture();
    const job = structuredClone(f.job);
    if (field === "id") job.id = randomUUID();
    else if (field === "approvalDigest") job.approvalDigest = "0".repeat(64);
    else if (field === "runId") job.data.runId = "bad" as typeof job.data.runId;
    else job.data.sessionId = "";
    expect(
      (await f.call(f.envelope("admission", { receipt: f.receipt("admission", job) }))).status,
    ).toBe(403);
    expect(f.store.admit).not.toHaveBeenCalled();
  },
);
it('binds runtime transport to a signed external destination/method before ledger access',async()=>{
 const f=await fixture();const e=f.envelope();const runtime=`http://okydosoacqdnursmmenf.supabase.co/studio-research-coordinator/${e.requestId}/authority`;
 expect((await f.call(e,f.host.privateKey,runtime)).status).toBe(200);
 const g=await fixture();const good=g.envelope();
 for(const binding of [undefined,{method:'GET',destination:good.binding!.destination},{method:'POST',destination:runtime},{method:'POST',destination:good.binding!.destination+'?x=1'},{method:'POST',destination:good.binding!.destination.replace('/authority','/result')},{method:'POST',destination:good.binding!.destination.replace('.co','.co:443')},{method:'POST',destination:good.binding!.destination.replace('/authority','/x/../authority')}]){
  expect((await g.call({...good,binding} as RouteEnvelope,g.host.privateKey,runtime)).status).toBe(403);
 }expect(g.ledger.claim).not.toHaveBeenCalled();
});
