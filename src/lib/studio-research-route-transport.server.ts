/** Exact server-to-server candidate. No default fetch, keys, routes or startup registration. */
import { sign, type KeyObject, randomUUID } from "node:crypto";
import { z } from "zod";
import { COORDINATOR, digest } from "./studio-research-coordinator-contracts";
import { verifySignedJson } from "./studio-research-coordinator-authority.server";
export const ROUTES = {
  paperclip: "https://agents.trusttai.com/api/plugins/trusttai.studio-research-coordinator/api",
  studio:
    "https://id-preview--65944e34-ede5-4757-befb-870e1ff97444.lovable.app/api/studio/research/coordinator",
} as const;
const operation = z.enum([
  "run",
  "read",
  "cancel",
  "review",
  "reconcile",
  "authority",
  "admission",
  "result",
]);
const envelope = z
  .object({
    domain: z.literal("studio-coordinator-route/v1"),
    sender: z.enum(["studio", "coordinator"]),
    companyId: z.literal(COORDINATOR.companyId),
    projectId: z.literal(COORDINATOR.projectId),
    agentId: z.literal(COORDINATOR.agentId),
    organizationId: z.literal(COORDINATOR.organizationId),
    subjectId: z.string().uuid(),
    requestId: z.string().uuid(),
    issueId: z.string().uuid(),
    approvalDigest: z.string().regex(/^[a-f0-9]{64}$/),
    operation,
    nonce: z.string().uuid(),
    issuedAt: z.number().finite(),
    expiresAt: z.number().finite(),
    payload: z.unknown(),
  })
  .strict();
export type RouteEnvelope = z.infer<typeof envelope>;
const response = z
  .object({
    domain: z.literal("studio-coordinator-response/v1"),
    nonce: z.string().uuid(),
    requestDigest: z.string(),
    requestId: z.string().uuid(),
    operation,
    issuedAt: z.number(),
    expiresAt: z.number(),
    body: z.unknown(),
  })
  .strict();
function signed(key: KeyObject, p: unknown) {
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") throw Error("signer_invalid");
  const b = Buffer.from(JSON.stringify(p));
  return b.toString("base64url") + "." + sign(null, b, key).toString("base64url");
}
function current(p: { issuedAt: number; expiresAt: number }, now: number) {
  if (
    p.issuedAt > now ||
    p.expiresAt <= now ||
    p.expiresAt <= p.issuedAt ||
    p.expiresAt - p.issuedAt > 60000
  )
    throw Error("route_expired");
}
function path(e: RouteEnvelope) {
  return e.sender === "studio"
    ? `/issues/${e.issueId}/research/${e.requestId}/${e.operation}`
    : `/${e.requestId}/${e.operation}`;
}
function permitted(e: RouteEnvelope) {
  return e.sender === "studio"
    ? ["run", "read", "cancel", "review", "reconcile"].includes(e.operation)
    : ["authority", "admission", "result"].includes(e.operation);
}
export function makeRouteClient(d: {
  sender: RouteEnvelope["sender"];
  privateKey: KeyObject;
  peerKey: KeyObject;
  now(): number;
  fetcher: typeof fetch;
  bridgeKey?: string;
}) {
  return async (
    input: Omit<RouteEnvelope, "domain" | "sender" | "nonce" | "issuedAt" | "expiresAt">,
  ) => {
    const now = d.now(),
      e = envelope.parse({
        ...input,
        domain: "studio-coordinator-route/v1",
        sender: d.sender,
        nonce: randomUUID(),
        issuedAt: now,
        expiresAt: now + (d.sender === "studio" && input.operation === "run" ? 60000 : 30000),
      });
    if (!permitted(e)) throw Error("route_invalid");
    const token = signed(d.privateKey, e);
    if (Buffer.byteLength(token) > 190000) throw Error("request_limit");
    // Bridge key is supplied only by the Studio secret store and never goes to Studio or redirects.
    if (d.sender === "studio" && (!d.bridgeKey || !d.bridgeKey.startsWith("pcp_")))
      throw Error("bridge_unavailable");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    };
    if (d.sender === "studio") headers["Authorization"] = `Bearer ${d.bridgeKey}`;
    const r = await d.fetcher(
      (d.sender === "studio" ? ROUTES.paperclip : ROUTES.studio) + path(e),
      {
        method: "POST",
        headers,
        body: JSON.stringify({ token }),
        redirect: "manual",
        signal: AbortSignal.timeout(65000),
      },
    );
    if (r.status !== 200)
      throw Error(r.status >= 300 && r.status < 400 ? "redirect_rejected" : "route_unconfirmed");
    const reader = r.body?.getReader();
    if (!reader) throw Error("response_missing");
    let raw = "",
      bytes = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > 190000) throw Error("response_limit");
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
    }
    const receipt = response.parse(verifySignedJson(d.peerKey, JSON.parse(raw).token));
    current(receipt, d.now());
    if (
      receipt.nonce !== e.nonce ||
      receipt.requestId !== e.requestId ||
      receipt.operation !== e.operation ||
      receipt.requestDigest !== digest(e)
    )
      throw Error("response_binding_invalid");
    return receipt.body;
  };
}
export type RouteLedger = {
  claim(
    e: RouteEnvelope,
  ):
    | { claimed: boolean; response: string | null; claimId?: string | null }
    | Promise<{ claimed: boolean; response: string | null; claimId?: string | null }>;
  finish(e: RouteEnvelope, token: string, claimId?: string | null): void | Promise<void>;
};
export function makeRouteHandler(d: {
  receiver: "studio" | "coordinator";
  peerKey: KeyObject;
  privateKey: KeyObject;
  now(): number;
  ledger: RouteLedger;
  /** Host MUST authenticate scoped bridge and compare project/agent or verify server signature path; actor metadata alone insufficient. */
  authenticate(request: Request, e: RouteEnvelope): Promise<void>;
  /** Studio must recheck current membership/request ownership/revocation before each effect. */
  authorizeCurrent(e: RouteEnvelope): Promise<void>;
  dispatch(e: RouteEnvelope): Promise<unknown>;
}) {
  return async (request: Request) => {
    const headers = { "Cache-Control": "no-store", "Content-Type": "application/json" };
    try {
      if (request.method !== "POST" || new URL(request.url).search) throw Error("method_invalid");
      const content = await boundedRequest(request);
      const outer = z
        .object({ token: z.string().max(190000) })
        .strict()
        .parse(JSON.parse(content));
      const e = envelope.parse(verifySignedJson(d.peerKey, outer.token));
      current(e, d.now());
      if (e.sender === d.receiver || !permitted(e)) throw Error("route_invalid");
      const expected = (d.receiver === "coordinator" ? ROUTES.paperclip : ROUTES.studio) + path(e);
      if (request.url !== expected) throw Error("route_binding_invalid");
      await d.authenticate(request, e);
      await d.authorizeCurrent(e);
      current(e, d.now());
      const claim = await d.ledger.claim(e);
      current(e, d.now());
      await d.authorizeCurrent(e);
      current(e, d.now());
      if (!claim.claimed) {
        if (!claim.response)
          return new Response(JSON.stringify({ error: "operation_uncertain" }), {
            status: 409,
            headers,
          });
        return new Response(JSON.stringify({ token: claim.response }), { status: 200, headers });
      }
      // A rejected/ambiguous dispatch leaves its nonce consumed. No relaunch on crash or duplicate.
      const body = await d.dispatch(e);
      const now = d.now();
      const token = signed(d.privateKey, {
        domain: "studio-coordinator-response/v1",
        nonce: e.nonce,
        requestDigest: digest(e),
        requestId: e.requestId,
        operation: e.operation,
        issuedAt: now,
        expiresAt: now + 30000,
        body,
      });
      if (Buffer.byteLength(token) > 190000) throw Error("response_limit");
      await d.ledger.finish(e, token, claim.claimId);
      return new Response(JSON.stringify({ token }), { status: 200, headers });
    } catch {
      return new Response(JSON.stringify({ error: "route_rejected" }), { status: 403, headers });
    }
  };
}

async function boundedRequest(request: Request) {
  const r = request.body?.getReader();
  if (!r) throw Error("request_missing");
  let size = 0,
    text = "";
  const decoder = new TextDecoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void r.cancel().catch(() => {});
      reject(Error("request_timeout"));
    }, 5000);
  });
  try {
    while (true) {
      const c = await Promise.race([r.read(), deadline]);
      if (c.done) break;
      size += c.value.length;
      if (size > 200000) throw Error("request_limit");
      text += decoder.decode(c.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    clearTimeout(timer);
    void r.cancel().catch(() => {});
  }
}

/** Authenticate actual task_bridge scope using the existing verified transport, never SDK actor metadata. */
export function scopedBridgeAuthenticator(fetcher: typeof fetch) {
  return async (request: Request, e: RouteEnvelope) => {
    if (e.sender !== "studio") throw Error("bridge_sender_invalid");
    const value = request.headers.get("Authorization");
    if (!value?.startsWith("Bearer ") || value.length > 4096) throw Error("bridge_missing");
    const transport = createStudioTransport(
      {
        origin: "https://agents.trusttai.com",
        key: value.slice(7),
        companyId: COORDINATOR.companyId,
        projectId: COORDINATOR.projectId,
        agentId: COORDINATOR.agentId,
      },
      fetcher,
    );
    const agent = await transport.readAgent(COORDINATOR.agentId);
    if (agent.status !== "paused") throw Error("native_agent_not_paused");
  };
}
import { createStudioTransport } from "./studio-research-transport.server.mjs";
