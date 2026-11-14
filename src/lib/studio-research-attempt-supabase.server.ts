/** Explicit v2 persistence adapter, never selected by the legacy callback assembly. */
import { z } from "zod";
import { digest, validateBrief } from "./studio-research-coordinator-contracts";
import { parseAttemptApproval, verifyPhaseChain } from "./studio-research-attempt-contracts.server";
import {
  admissionV2Schema,
  type AttemptCallbackRepository,
  type CallbackAttemptState,
} from "./studio-research-attempt-callback.server";
import type { RouteLedger, RouteEnvelope } from "./studio-research-route-transport.server";
import { type KeyObject } from "node:crypto";
export const attemptStateSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    admission: admissionV2Schema.nullable(),
    tokens: z.array(z.string().max(8192)).max(64),
    terminal: z.enum(["ready", "uncertain"]).nullable(),
    cancelled: z.boolean(),
    packetDigests: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(3),
    result: z.unknown().nullable(),
  })
  .strict();
export function createAttemptSupabaseRepository(
  key: string,
  peerKey: KeyObject,
  fetcher: typeof fetch,
  version: 2 | 3 = 2,
): AttemptCallbackRepository & { ledger: RouteLedger } {
  if (!key) throw Error("attempt_storage_unavailable");
  const origin = "https://okydosoacqdnursmmenf.supabase.co/rest/v1";
  async function request(path: string, body?: unknown) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(Error("attempt_storage_timeout"));
      }, 5000);
    });
    try {
      const response = await Promise.race([
        fetcher(origin + (version === 3 ? path.replaceAll("_v2", "_v3") : path), {
          method: body === undefined ? "GET" : "POST",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            apikey: key,
            ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        timeout,
      ]);
      if (!response.ok || response.status >= 300) throw Error("attempt_storage_unconfirmed");
      const reader = response.body?.getReader();
      if (!reader) throw Error("attempt_storage_unconfirmed");
      let size = 0,
        text = "";
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const item = await Promise.race([reader.read(), timeout]);
          if (item.done) break;
          size += item.value.length;
          if (size > 190000) throw Error("attempt_storage_limit");
          text += decoder.decode(item.value, { stream: true });
        }
        return JSON.parse(text + decoder.decode());
      } finally {
        void reader.cancel().catch(() => {});
      }
    } catch {
      throw Error("attempt_storage_unconfirmed");
    } finally {
      clearTimeout(timer);
    }
  }
  const identity = (e: RouteEnvelope) => {
    const payload = z
      .object({ version: z.literal(2), attemptId: z.string().uuid() })
      .passthrough()
      .parse(e.payload);
    if (e.sender !== "coordinator" || !["authority", "admission", "result"].includes(e.operation))
      throw Error("attempt_route_scope");
    return payload.attemptId;
  };
  return {
    ledger: {
      async claim(e) {
        return z
          .object({ claimed: z.boolean(), response: z.string().max(190000).nullable() })
          .strict()
          .parse(
            await request("/rpc/studio_attempt_nonce_claim_v2", {
              p_attempt_id: identity(e),
              p_approval_digest: e.approvalDigest,
              p_nonce: e.nonce,
              p_digest: digest(e),
            }),
          );
      },
      async finish(e, token) {
        if (
          (await request("/rpc/studio_attempt_nonce_finish_v2", {
            p_attempt_id: identity(e),
            p_nonce: e.nonce,
            p_digest: digest(e),
            p_response: token,
          })) !== true
        )
          throw Error("attempt_nonce_unconfirmed");
      },
    },
    async read(id) {
      z.string().uuid().parse(id);
      const rows = z
        .array(
          z
            .object({
              approval: z.unknown(),
              approval_digest: z.string(),
              state: attemptStateSchema,
            })
            .strict(),
        )
        .length(1)
        .parse(
          await request(
            `/studio_research_attempts_v2?attempt_id=eq.${id}&select=approval,approval_digest,state`,
          ),
        );
      const row = rows[0]!,
        approval = parseAttemptApproval(row.approval);
      if (approval.version !== version || approval.attemptId !== id || digest(approval) !== row.approval_digest)
        throw Error("attempt_storage_binding");
      const chain = verifyPhaseChain(row.state.tokens, peerKey, approval);
      let result = null;
      if (row.state.terminal === "ready") {
        if (!chain.complete || !row.state.admission || !row.state.result)
          throw Error("attempt_storage_result");
        result = validateBrief(
          JSON.stringify(row.state.result),
          approval.historicalApproval,
          row.state.admission.evidence,
        );
      } else if (row.state.result !== null) throw Error("attempt_storage_result");
      return { approval, state: { ...row.state, result } as CallbackAttemptState };
    },
    async cancel(id) {
      z.string().uuid().parse(id);
      if ((await request("/rpc/studio_attempt_cancel_v2", { p_attempt_id: id })) !== true)
        throw Error("attempt_cancel_unconfirmed");
    },
    async commit(id, revision, state, token) {
      z.string().uuid().parse(id);
      attemptStateSchema.parse(state);
      if (
        (await request("/rpc/studio_attempt_commit_v2", {
          p_attempt_id: id,
          p_revision: revision,
          p_state: state,
          p_token: token,
        })) !== true
      )
        throw Error("attempt_storage_unconfirmed");
    },
  };
}
