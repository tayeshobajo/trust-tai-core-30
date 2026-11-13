/** Concrete PostgREST mapping, disconnected from startup and existing routes. */
import { z } from "zod";
import { trustTaiSupabaseUrl } from "./trust-tai-backend.server";
import {
  approvalSchema,
  digest,
  type Approval,
  type Brief,
} from "./studio-research-coordinator-contracts";
export const coordinatorRowSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  request_id: z.string().uuid(),
  created_by: z.string().uuid(),
  topic: z.string(),
  company_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  issue_id: z.string().uuid().nullable(),
  state: z.string(),
  result: z.unknown().nullable(),
  result_comment_id: z.string().uuid().nullable(),
  coordinator_state: z.enum(["approved", "running", "ready", "cancelled"]).nullable(),
  coordinator_approval: z.unknown().nullable(),
  coordinator_approval_digest: z.string().nullable(),
  coordinator_admission: z.unknown().nullable(),
  coordinator_brief: z.unknown().nullable(),
  coordinator_result_digest: z.string().nullable(),
  intake_recovery_authorization: z.unknown().nullable().optional(),
  intake_recovery_receipt: z.unknown().nullable().optional(),
});
export type CoordinatorRow = z.infer<typeof coordinatorRowSchema>;
export function createCoordinatorRequestStore(key: string, fetcher: typeof fetch = fetch, backendUrl?: string) {
  if (!key) throw Error("coordinator_storage_unavailable");
  const backend = new URL(backendUrl ?? trustTaiSupabaseUrl());
  if (
    backend.origin !== "https://okydosoacqdnursmmenf.supabase.co" ||
    backend.pathname !== "/" ||
    backend.search ||
    backend.hash ||
    backend.username ||
    backend.password
  )
    throw Error("coordinator_backend_invalid");
  async function query(method: "GET" | "PATCH", params: URLSearchParams, body?: unknown) {
    const response = await fetcher(`${backend.origin}/rest/v1/studio_research_requests?${params}`, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      headers: {
        apikey: key,
        ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok || response.status >= 300) throw Error("coordinator_storage_rejected");
    const reader = response.body?.getReader();
    if (!reader) throw Error("coordinator_storage_rejected");
    let size = 0;
    const parts: Uint8Array[] = [];
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 450000) throw Error();
        parts.push(value);
      }
    } catch {
      await reader.cancel();
      throw Error("coordinator_storage_rejected");
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const p of parts) {
      bytes.set(p, offset);
      offset += p.length;
    }
    return z
      .array(coordinatorRowSchema)
      .max(1)
      .parse(JSON.parse(new TextDecoder().decode(bytes)));
  }
  const where = (org: string, id: string) =>
    new URLSearchParams({
      organization_id: `eq.${z.string().uuid().parse(org)}`,
      request_id: `eq.${z.string().uuid().parse(id)}`,
      limit: "1",
    });
  async function read(org: string, id: string) {
    return (await query("GET", where(org, id)))[0] ?? null;
  }
  async function patch(row: CoordinatorRow, expected: string | null, body: unknown) {
    const p = where(row.organization_id, row.request_id);
    p.delete("limit");
    p.set("id", `eq.${row.id}`);
    p.set("created_by", `eq.${row.created_by}`);
    p.set("company_id", `eq.${row.company_id}`);
    p.set("agent_id", `eq.${row.agent_id}`);
    p.set("issue_id", `eq.${row.issue_id}`);
    p.set("state", "eq.submitted");
    p.set("result", "is.null");
    p.set("result_comment_id", "is.null");
    p.set("coordinator_state", expected === null ? "is.null" : `eq.${expected}`);
    if (row.coordinator_approval_digest)
      p.set("coordinator_approval_digest", `eq.${row.coordinator_approval_digest}`);
    return (await query("PATCH", p, body))[0] ?? null;
  }
  async function recoveryPatch(row: CoordinatorRow, expectedReceipt: unknown, body: unknown) {
    const p = where(row.organization_id, row.request_id); p.delete("limit");
    for (const [key, value] of Object.entries({id:row.id,created_by:row.created_by,company_id:row.company_id,agent_id:row.agent_id,topic:row.topic})) p.set(key, `eq.${value}`);
    p.set("state", "eq.dispatch_uncertain");
    for (const key of ["issue_id","result","result_comment_id","coordinator_state","coordinator_approval","coordinator_approval_digest","coordinator_admission","coordinator_brief","coordinator_result_digest"]) p.set(key,"is.null");
    p.set("intake_recovery_authorization", `eq.${JSON.stringify(row.intake_recovery_authorization)}`);
    p.set("intake_recovery_receipt", expectedReceipt === null ? "is.null" : `eq.${JSON.stringify(expectedReceipt)}`);
    return (await query("PATCH",p,body))[0] ?? null;
  }
  return {
    read,
    claimIntakeRecovery: (row: CoordinatorRow, receipt: unknown) => recoveryPatch(row,null,{intake_recovery_receipt:receipt}),
    attachIntakeRecovery: (row: CoordinatorRow, receipt: unknown, issueId: string) => recoveryPatch(row,row.intake_recovery_receipt,{state:"submitted",issue_id:z.string().uuid().parse(issueId),intake_recovery_receipt:receipt}),
    async approve(row: CoordinatorRow, raw: Approval) {
      const a = approvalSchema.parse(raw);
      return patch(row, null, {
        coordinator_state: "approved",
        coordinator_approval: a,
        coordinator_approval_digest: digest(a),
      });
    },
    admit: (row: CoordinatorRow, admission: unknown) =>
      patch(row, "approved", { coordinator_state: "running", coordinator_admission: admission }),
    accept: (row: CoordinatorRow, brief: Brief) =>
      patch(row, "running", {
        coordinator_state: "ready",
        coordinator_brief: brief,
        coordinator_result_digest: digest(brief),
      }),
    cancel: (row: CoordinatorRow) =>
      patch(row, row.coordinator_state, { coordinator_state: "cancelled" }),
  };
}
export type CoordinatorRequestStore = ReturnType<typeof createCoordinatorRequestStore>;
