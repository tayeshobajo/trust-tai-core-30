/** Cloudflare-compatible durable route ledger: PostgREST RPC, never local SQLite/cache. */
import { z } from "zod";
import { digest, COORDINATOR } from "./studio-research-coordinator-contracts";
import type { RouteEnvelope, RouteLedger } from "./studio-research-route-transport.server";
const origin = "https://okydosoacqdnursmmenf.supabase.co";
export function createSupabaseRouteLedger(key: string, fetcher: typeof fetch): RouteLedger {
  if (!key) throw Error("route_storage_unavailable");
  async function rpc(name: "studio_route_claim" | "studio_route_finish", body: unknown) {
    const controller = new AbortController();
    let rejectDeadline!: (error: Error) => void;
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = reject;
    });
    const timer = setTimeout(() => {
      controller.abort();
      rejectDeadline(Error("timeout"));
    }, 10000);
    try {
      const r = await Promise.race([
        fetcher(`${origin}/rest/v1/rpc/${name}`, {
          method: "POST",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            apikey: key,
            ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        deadline,
      ]);
      if (!r.ok || r.status >= 300) throw Error();
      const reader = r.body?.getReader();
      if (!reader) throw Error();
      let bytes = 0,
        text = "";
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const item = await Promise.race([reader.read(), deadline]);
          if (item.done) break;
          bytes += item.value.length;
          if (bytes > 200000) throw Error();
          text += decoder.decode(item.value, { stream: true });
        }
        return JSON.parse(text + decoder.decode());
      } finally {
        void reader.cancel().catch(() => {});
      }
    } catch {
      throw Error("route_storage_unconfirmed");
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async claim(e: RouteEnvelope) {
      if (
        e.sender !== "coordinator" ||
        e.organizationId !== COORDINATOR.organizationId ||
        e.companyId !== COORDINATOR.companyId ||
        e.projectId !== COORDINATOR.projectId ||
        e.agentId !== COORDINATOR.agentId ||
        !["authority", "admission", "result"].includes(e.operation)
      )
        throw Error("route_storage_scope");
      const hash = digest(e);
      const result = z
        .object({
          claimed: z.boolean(),
          response: z.string().max(190000).nullable(),
          claimId: z.string().uuid().nullable(),
          digest: z.literal(hash),
        })
        .strict()
        .parse(
          await rpc("studio_route_claim", {
            p_nonce: e.nonce,
            p_digest: hash,
            p_subject: e.subjectId,
            p_request: e.requestId,
            p_issue: e.issueId,
            p_approval: e.approvalDigest,
            p_operation: e.operation,
            p_issued_ms: e.issuedAt,
            p_expires_ms: e.expiresAt,
          }),
        );
      if (result.claimed ? !result.claimId || result.response !== null : result.claimId !== null)
        throw Error("route_storage_invalid");
      return result;
    },
    async finish(e: RouteEnvelope, token: string, claimId?: string | null) {
      z.string().uuid().parse(claimId);
      if (token.length > 190000) throw Error("response_limit");
      const result = await rpc("studio_route_finish", {
        p_nonce: e.nonce,
        p_digest: digest(e),
        p_claim: claimId,
        p_response: token,
      });
      if (result !== true) throw Error("route_storage_unconfirmed");
    },
  };
}
