import { createRouteLedger } from "./studio-research-route-ledger-node.server";
import { it, expect, vi, afterEach } from "vitest";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  routeDiagnostic,
  makeRouteClient,
  makeRouteHandler,
  ROUTES,
} from "./studio-research-route-transport.server";
import { COORDINATOR, digest } from "./studio-research-coordinator-contracts";
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));
function fixture() {
  const studio = generateKeyPairSync("ed25519"),
    host = generateKeyPairSync("ed25519"),
    db = new DatabaseSync(":memory:");
  cleanup.push(() => db.close());
  let now = 1000,
    deny = false;
  const dispatch = vi.fn(async () => ({ state: "ready" }));
  const handler = makeRouteHandler({
    receiver: "coordinator",
    peerKey: studio.publicKey,
    privateKey: host.privateKey,
    now: () => now,
    ledger: createRouteLedger(db),
    authenticate: async (r) => {
      if (r.headers.get("Authorization") !== "Bearer pcp_synthetic") throw Error();
    },
    authorizeCurrent: async () => {
      if (deny) throw Error();
    },
    dispatch,
  });
  let requests: Request[] = [];
  const client = makeRouteClient({
    sender: "studio",
    privateKey: studio.privateKey,
    peerKey: host.publicKey,
    now: () => now,
    bridgeKey: "pcp_synthetic",
    fetcher: async function (this: unknown, u, i) {
      expect(this).toBeUndefined();
      const r = new Request(u, i);
      requests.push(r.clone());
      return handler(r);
    },
  });
  const input = {
    companyId: COORDINATOR.companyId,
    projectId: COORDINATOR.projectId,
    agentId: COORDINATOR.agentId,
    organizationId: COORDINATOR.organizationId,
    subjectId: randomUUID(),
    requestId: randomUUID(),
    issueId: randomUUID(),
    approvalDigest: digest("approval"),
    operation: "run" as const,
    payload: { grant: "synthetic" },
  };
  return {
    client,
    input,
    handler,
    dispatch,
    requests,
    studio,
    host,
    set deny(v: boolean) {
      deny = v;
    },
    set now(v: number) {
      now = v;
    },
  };
}
it("exact signed route round trip uses only bridge auth and does not forward a browser session", async () => {
  const f = fixture();
  expect(await f.client(f.input)).toEqual({ state: "ready" });
  const r = f.requests[0]!;
  expect(r.url).toBe(
    `${ROUTES.paperclip}/issues/${f.input.issueId}/research/${f.input.requestId}/run`,
  );
  expect([...r.headers.keys()].sort()).toEqual(["authorization", "cache-control", "content-type"]);
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  expect((await f.handler(r)).status).toBe(200);
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});
it("rechecks authorization on replay and prevents concurrent double dispatch", async () => {
  const f = fixture();
  await f.client(f.input);
  f.deny = true;
  expect((await f.handler(f.requests[0]!)).status).toBe(403);
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});
it("rejects path/request mismatch and expired command", async () => {
  const f = fixture();
  await f.client(f.input);
  const r = f.requests[0]!;
  expect(
    (
      await f.handler(
        new Request(r.url.replace(f.input.requestId, randomUUID()), {
          method: "POST",
          headers: r.headers,
          body: await r.clone().text(),
        }),
      )
    ).status,
  ).toBe(403);
  f.now = 99999;
  expect((await f.handler(r)).status).toBe(403);
});
it("never follows credential redirects or automatically retries", async () => {
  const f = fixture();
  const transport = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 302, headers: { Location: "https://other.invalid" } }),
  );
  const c = makeRouteClient({
    sender: "studio",
    privateKey: f.studio.privateKey,
    peerKey: f.host.publicKey,
    now: () => 1000,
    bridgeKey: "pcp_synthetic",
    fetcher: transport,
  });
  await expect(c(f.input)).rejects.toThrow("redirect_rejected");
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0]?.[1]?.redirect).toBe("manual");
});
it("dispatch failure leaves a consumed uncertain nonce and never repeats it", async () => {
  const f = fixture();
  f.dispatch.mockRejectedValueOnce(Error());
  await expect(f.client(f.input)).rejects.toThrow();
  expect((await f.handler(f.requests[0]!)).status).toBe(409);
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});
it("rejects forged signed responses", async () => {
  const f = fixture();
  const c = makeRouteClient({
    sender: "studio",
    privateKey: f.studio.privateKey,
    peerKey: f.host.publicKey,
    now: () => 1000,
    bridgeKey: "pcp_synthetic",
    fetcher: async () => new Response(JSON.stringify({ token: "forged" })),
  });
  await expect(c(f.input)).rejects.toThrow();
});
it("bounds a stalled unauthenticated request body before dispatch", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    let cancelled = false;
    const stream = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request(ROUTES.paperclip, {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    const pending = f.handler(request);
    await vi.advanceTimersByTimeAsync(5001);
    expect((await pending).status).toBe(403);
    expect(cancelled).toBe(true);
    expect(f.dispatch).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it("allows only one simultaneous dispatch for identical signed nonce", async () => {
  const f = fixture();
  let release!: (v: { state: string }) => void;
  f.dispatch.mockImplementationOnce(
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  const first = f.client(f.input);
  await vi.waitFor(() => expect(f.dispatch).toHaveBeenCalledTimes(1));
  const duplicate = await f.handler(f.requests[0]!.clone());
  expect(duplicate.status).toBe(409);
  release({ state: "ready" });
  await first;
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});
import { verifySignedJson } from "./studio-research-coordinator-authority.server";
import { scopedBridgeAuthenticator } from "./studio-research-route-transport.server";
import { makeSignedRoutePlugin } from "../../packages/studio-research-coordinator/src/signed-routes";
it.each(["nonce", "requestDigest", "requestId", "operation"] as const)(
  "rejects validly signed response with wrong %s",
  async (field) => {
    const f = fixture();
    const c = makeRouteClient({
      sender: "studio",
      privateKey: f.studio.privateKey,
      peerKey: f.host.publicKey,
      now: () => 1000,
      bridgeKey: "pcp_synthetic",
      fetcher: async (_u, i) => {
        const e = verifySignedJson(f.studio.publicKey, JSON.parse(String(i?.body)).token) as any;
        const p = {
          domain: "studio-coordinator-response/v1",
          nonce: e.nonce,
          requestDigest: digest(e),
          requestId: e.requestId,
          operation: e.operation,
          issuedAt: 1000,
          expiresAt: 2000,
          body: { state: "ready" },
          [field]: field === "operation" ? "read" : randomUUID(),
        };
        const b = Buffer.from(JSON.stringify(p));
        return new Response(
          JSON.stringify({
            token:
              b.toString("base64url") +
              "." +
              sign(null, b, f.host.privateKey).toString("base64url"),
          }),
        );
      },
    });
    await expect(c(f.input)).rejects.toThrow("response_binding_invalid");
  },
);
it("requires actual scoped bridge identity and paused agent, not a caller actor label", async () => {
  const f = fixture();
  const identity = {
    id: COORDINATOR.agentId,
    companyId: COORDINATOR.companyId,
    status: "paused",
    keyScope: {
      kind: "task_bridge",
      projectId: COORDINATOR.projectId,
      allowedAssigneeAgentIds: [COORDINATOR.agentId],
    },
  };
  const fetcher = vi.fn(async () => Response.json(identity));
  const auth = scopedBridgeAuthenticator(fetcher);
  const r = new Request(ROUTES.paperclip, { headers: { Authorization: "Bearer pcp_synthetic" } });
  const e = {
    ...f.input,
    domain: "studio-coordinator-route/v1" as const,
    sender: "studio" as const,
    nonce: randomUUID(),
    issuedAt: 1000,
    expiresAt: 2000,
  };
  await auth(r, e);
  identity.keyScope.kind = "standard";
  await expect(auth(r, e)).rejects.toThrow();
  identity.keyScope.kind = "task_bridge";
  identity.status = "active";
  await expect(auth(r, e)).rejects.toThrow("native_agent_not_paused");
});
it("SDK wrapper remains disabled and refuses missing forwarded scoped auth", async () => {
  const input = {
    companyId: COORDINATOR.companyId,
    method: "POST",
    routeKey: "signed-read",
    path: "/",
    params: { requestId: randomUUID(), issueId: randomUUID() },
    query: {},
    headers: {},
    body: { token: "synthetic" },
    actor: { actorType: "user" as const, actorId: "user" },
  };
  expect((await makeSignedRoutePlugin().definition.onApiRequest!(input)).status).toBe(503);
  const handler = vi.fn(async () => Response.json({}));
  expect((await makeSignedRoutePlugin(handler).definition.onApiRequest!(input)).status).toBe(403);
  expect(handler).not.toHaveBeenCalled();
});

it("returns only bounded launch diagnostic codes",()=>{
 expect(routeDiagnostic(Error("bridge_unavailable"))).toBe("bridge_unavailable");
 expect(routeDiagnostic(Error("private token or provider detail"))).toBe("route_unknown");
 expect(routeDiagnostic({diagnostic:"route_http_403"})).toBe("route_unknown");
});

for(const [body,code] of [["RPC call timed out after 30000ms","route_rpc_timeout"],["Cannot serialize BigInt","route_rpc_serialization"],["unknown method","route_rpc_method"],["private token arbitrary detail","route_http_502"],["x".repeat(2001)+"timed out","route_http_502"]])it(`bounds RPC diagnostic ${code}`,async()=>{const f=fixture();const client=makeRouteClient({sender:"studio",privateKey:f.studio.privateKey,peerKey:f.host.publicKey,now:()=>1000,bridgeKey:"pcp_synthetic",fetcher:async()=>new Response(body,{status:502})});let diagnostic;try{await client(f.input);}catch(e){diagnostic=routeDiagnostic(e);}expect(diagnostic).toBe(code);});
