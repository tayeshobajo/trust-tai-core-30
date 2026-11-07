import { it, expect, vi } from "vitest";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { createSupabaseRouteLedger } from "./studio-research-route-ledger-supabase.server";
import {
  makeRouteHandler,
  ROUTES,
  type RouteEnvelope,
} from "./studio-research-route-transport.server";
import { COORDINATOR, digest } from "./studio-research-coordinator-contracts";
const envelope = (): RouteEnvelope => ({
  domain: "studio-coordinator-route/v1",
  sender: "coordinator",
  companyId: COORDINATOR.companyId,
  projectId: COORDINATOR.projectId,
  agentId: COORDINATOR.agentId,
  organizationId: COORDINATOR.organizationId,
  subjectId: randomUUID(),
  requestId: randomUUID(),
  issueId: randomUUID(),
  approvalDigest: digest("approval"),
  operation: "result",
  nonce: randomUUID(),
  issuedAt: 1000,
  expiresAt: 31000,
  payload: { receipt: "synthetic" },
});
// Intercepted atomic-RPC contract model, NOT PostgreSQL concurrency evidence.
function fixture() {
  const rows = new Map<string, { hash: string; lease: string; response: string | null }>();
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const p = JSON.parse(String(init?.body));
    if (String(url).endsWith("/studio_route_claim")) {
      let r = rows.get(p.p_nonce);
      if (r && r.hash !== p.p_digest) return new Response("", { status: 409 });
      const claimed = !r;
      if (!r) {
        r = { hash: p.p_digest, lease: randomUUID(), response: null };
        rows.set(p.p_nonce, r);
      }
      return Response.json({
        claimed,
        claimId: claimed ? r.lease : null,
        response: r.response,
        digest: r.hash,
      });
    }
    const r = rows.get(p.p_nonce);
    if (
      !r ||
      r.hash !== p.p_digest ||
      r.lease !== p.p_claim ||
      (r.response && r.response !== p.p_response)
    )
      return new Response("", { status: 409 });
    r.response = p.p_response;
    return Response.json(true);
  });
  return { fetcher, rows, ledger: createSupabaseRouteLedger("sb_secret_synthetic", fetcher) };
}
it("RPC claim binds exact nonce/digest/owner/request/issue/policy and completion lease", async () => {
  const f = fixture(),
    e = envelope(),
    c = await f.ledger.claim(e);
  expect(c.claimed).toBe(true);
  const [url, init] = f.fetcher.mock.calls[0]!;
  expect(url).toBe("https://okydosoacqdnursmmenf.supabase.co/rest/v1/rpc/studio_route_claim");
  expect(init?.redirect).toBe("manual");
  expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  expect(JSON.parse(String(init?.body))).toMatchObject({
    p_nonce: e.nonce,
    p_digest: digest(e),
    p_subject: e.subjectId,
    p_request: e.requestId,
    p_issue: e.issueId,
    p_approval: e.approvalDigest,
  });
  await f.ledger.finish(e, "signed-result", c.claimId);
  expect(await f.ledger.claim(e)).toMatchObject({
    claimed: false,
    response: "signed-result",
    claimId: null,
  });
});
it("unknown/crashed claim stays consumed and wrong lease cannot finish", async () => {
  const f = fixture(),
    e = envelope();
  await f.ledger.claim(e);
  const other = createSupabaseRouteLedger("sb_secret_synthetic", f.fetcher);
  expect(await other.claim(e)).toMatchObject({ claimed: false, response: null });
  await expect(other.finish(e, "forged", randomUUID())).rejects.toThrow();
  await expect(other.claim({ ...e, payload: { changed: true } })).rejects.toThrow();
});
it.each([302, 401, 500])("never retries HTTP %s or follows redirects", async (status) => {
  const f = vi.fn(async () => new Response(null, { status }));
  await expect(createSupabaseRouteLedger("synthetic", f).claim(envelope())).rejects.toThrow();
  expect(f).toHaveBeenCalledTimes(1);
});
it("rejects foreign scope before RPC", async () => {
  const f = fixture();
  await expect(
    f.ledger.claim({ ...envelope(), organizationId: randomUUID() as never }),
  ).rejects.toThrow();
  expect(f.fetcher).not.toHaveBeenCalled();
});
it("rejects forged claim digest and oversized response", async () => {
  const e = envelope();
  const f = vi.fn(async () =>
    Response.json({ claimed: true, claimId: randomUUID(), response: null, digest: "a".repeat(64) }),
  );
  await expect(createSupabaseRouteLedger("synthetic", f).claim(e)).rejects.toThrow();
  const large = vi.fn(async () => new Response("x".repeat(200001)));
  await expect(createSupabaseRouteLedger("synthetic", large).claim(e)).rejects.toThrow();
});
it("two handlers sharing durable-RPC contract dispatch exactly once; expiry during claim never dispatches", async () => {
  const f = fixture(),
    e = envelope(),
    keys = generateKeyPairSync("ed25519");
  let now = 1000;
  const body = Buffer.from(JSON.stringify(e)),
    token =
      body.toString("base64url") + "." + sign(null, body, keys.privateKey).toString("base64url");
  const request = () =>
    new Request(`${ROUTES.studio}/${e.requestId}/result`, {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  const dispatch = vi.fn(async () => ({ stored: true }));
  const make = () =>
    makeRouteHandler({
      receiver: "studio",
      privateKey: keys.privateKey,
      peerKey: keys.publicKey,
      now: () => now,
      ledger: createSupabaseRouteLedger("synthetic", f.fetcher),
      authenticate: async () => {},
      authorizeCurrent: async () => {},
      dispatch,
    });
  const a = make(),
    b = make();
  await Promise.all([a(request()), b(request())]);
  expect(dispatch).toHaveBeenCalledTimes(1);
  const late = makeRouteHandler({
    receiver: "studio",
    privateKey: keys.privateKey,
    peerKey: keys.publicKey,
    now: () => now,
    ledger: {
      claim: async () => {
        now = 31000;
        return { claimed: true, response: null, claimId: randomUUID() };
      },
      finish: async () => {},
    },
    authenticate: async () => {},
    authorizeCurrent: async () => {},
    dispatch,
  });
  expect((await late(request())).status).toBe(403);
  expect(dispatch).toHaveBeenCalledTimes(1);
});
it("staged SQL keeps service DML revoked, bounded binding, atomic ownership and no recycling", () => {
  const sql = readFileSync(
    "qa/studio-research/staged/20261106030000_studio_route_nonce_ledger.sql",
    "utf8",
  );
  expect(sql).toContain("on conflict(nonce) do nothing");
  expect(sql).toContain("for update");
  expect(sql).toContain("r.claim_id=p_claim");
  expect(sql).toContain("force row level security");
  expect(sql).toContain("from public,anon,authenticated,service_role");
  expect(sql).not.toMatch(/grant\s+(select|insert|update|delete|all)\s+on\s+table/i);
  expect(sql).not.toMatch(/delete\s+from/i);
  expect(sql).toContain("is not true");
});
it("deadline rejects stalled RPC without retry", async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const promise = createSupabaseRouteLedger("synthetic", fetcher).claim(envelope());
    const rejected = expect(promise).rejects.toThrow("route_storage_unconfirmed");
    await vi.advanceTimersByTimeAsync(10001);
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
it("commit then lost response preserves consumed claim and committed completion", async () => {
  const f = fixture(),
    e = envelope(),
    base = f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementationOnce(async (...args) => {
    await base(...args);
    throw Error("lost claim response");
  });
  await expect(f.ledger.claim(e)).rejects.toThrow("route_storage_unconfirmed");
  expect(await f.ledger.claim(e)).toMatchObject({ claimed: false, response: null, claimId: null });
  const second = envelope(),
    claim = await f.ledger.claim(second);
  f.fetcher.mockImplementationOnce(async (...args) => {
    await base(...args);
    throw Error("lost finish response");
  });
  await expect(f.ledger.finish(second, "signed-cached", claim.claimId)).rejects.toThrow(
    "route_storage_unconfirmed",
  );
  expect(await f.ledger.claim(second)).toMatchObject({
    claimed: false,
    response: "signed-cached",
    claimId: null,
  });
});
it("revocation during awaited claim consumes nonce but never dispatches", async () => {
  const f = fixture(),
    e = envelope(),
    keys = generateKeyPairSync("ed25519");
  let allowed = true;
  const bytes = Buffer.from(JSON.stringify(e)),
    token =
      bytes.toString("base64url") + "." + sign(null, bytes, keys.privateKey).toString("base64url");
  const dispatch = vi.fn();
  const handler = makeRouteHandler({
    receiver: "studio",
    peerKey: keys.publicKey,
    privateKey: keys.privateKey,
    now: () => 1000,
    ledger: {
      claim: async (x) => {
        const claim = await f.ledger.claim(x);
        allowed = false;
        return claim;
      },
      finish: f.ledger.finish,
    },
    authenticate: async () => {},
    authorizeCurrent: async () => {
      if (!allowed) throw Error("revoked");
    },
    dispatch,
  });
  expect(
    (
      await handler(
        new Request(`${ROUTES.studio}/${e.requestId}/result`, {
          method: "POST",
          body: JSON.stringify({ token }),
        }),
      )
    ).status,
  ).toBe(403);
  expect(dispatch).not.toHaveBeenCalled();
  expect(await f.ledger.claim(e)).toMatchObject({ claimed: false, response: null });
});
