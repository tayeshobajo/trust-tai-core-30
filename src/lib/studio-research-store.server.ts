import { z } from "zod";
import {
  researchRequestSchema,
  researchResultSchema,
  type ResearchResult,
} from "@/domain/studio-research";
import type { ResearchDeps, ResearchRun } from "./studio-research.server";
import { trustTaiSupabaseUrl } from "./trust-tai-backend.server";

const rowSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  request_id: z.string().uuid(),
  topic: z.string(),
  company_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  issue_id: z.string().uuid().nullable(),
  state: z.enum(["dispatching", "submitted", "dispatch_uncertain"]),
  result: researchResultSchema.nullable(),
  result_comment_id: z.string().uuid().nullable(),
});
type Row = z.infer<typeof rowSchema>;
function run(row: Row): ResearchRun {
  return {
    id: row.id,
    request: researchRequestSchema.parse({
      organizationId: row.organization_id,
      requestId: row.request_id,
      topic: row.topic,
    }),
    companyId: row.company_id,
    agentId: row.agent_id,
    issueId: row.issue_id,
    state: row.state,
  };
}
/** Server service credential only. No browser table grants or client-provided bindings. */
export function createResearchStore(userId: string, key: string, fetcher: typeof fetch = fetch) {
  if (!key) throw new Error("Research storage is unavailable.");
  async function query(method: string, params: URLSearchParams, body?: unknown) {
    const response = await fetcher(
      `${trustTaiSupabaseUrl()}/rest/v1/studio_research_requests?${params}`,
      {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          apikey: key,
          ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    if (response.status === 409 && method === "POST") return null;
    if (!response.ok) throw new Error("Research storage is unavailable.");
    return z.array(rowSchema).parse(await response.json());
  }
  function where(org: string, requestId?: string) {
    return new URLSearchParams({
      organization_id: `eq.${z.string().uuid().parse(org)}`,
      ...(requestId ? { request_id: `eq.${z.string().uuid().parse(requestId)}` } : {}),
    });
  }
  async function readRow(org: string, requestId: string) {
    const rows = await query("GET", where(org, requestId));
    return rows?.[0] ?? null;
  }
  const reserve: ResearchDeps["reserve"] = async (request, companyId, agentId) => {
    const rows = await query("POST", new URLSearchParams(), {
      organization_id: request.organizationId,
      request_id: request.requestId,
      topic: request.topic,
      company_id: companyId,
      agent_id: agentId,
      created_by: userId,
    });
    if (rows?.length === 1) return { kind: "claimed", run: run(rows[0]!) };
    const existing = await readRow(request.organizationId, request.requestId);
    if (
      !existing ||
      existing.topic !== request.topic ||
      existing.company_id !== companyId ||
      existing.agent_id !== agentId
    )
      return { kind: "conflict" };
    return { kind: "existing", run: run(existing) };
  };
  async function transition(value: ResearchRun, body: unknown) {
    const params = where(value.request.organizationId, value.request.requestId);
    params.set("id", `eq.${value.id}`);
    params.set("state", "eq.dispatching");
    params.set("issue_id", "is.null");
    const rows = await query("PATCH", params, body);
    if (rows?.length !== 1) throw new Error("Research claim changed.");
  }
  return {
    reserve,
    attachIssue: (value: ResearchRun, issueId: string) =>
      transition(value, { issue_id: z.string().uuid().parse(issueId), state: "submitted" }),
    markUncertain: (value: ResearchRun) => transition(value, { state: "dispatch_uncertain" }),
    readRun: async (org: string, id: string) => {
      const row = await readRow(org, id);
      return row ? run(row) : null;
    },
    list: async (org: string) => {
      const params = where(org);
      params.set("order", "created_at.desc");
      params.set("limit", "20");
      return ((await query("GET", params)) ?? []).map(run);
    },
    saveResult: async (
      org: string,
      requestId: string,
      commentId: string,
      result: ResearchResult,
    ) => {
      const parsed = researchResultSchema.parse(result);
      if (parsed.requestId !== requestId) throw new Error("Research result mismatch.");
      const params = where(org, requestId);
      params.set("state", "eq.submitted");
      params.set("result_comment_id", "is.null");
      const rows = await query("PATCH", params, {
        result: parsed,
        result_comment_id: z.string().uuid().parse(commentId),
      });
      if (rows?.length === 1) return;
      const existing = await readRow(org, requestId);
      if (
        existing?.result_comment_id !== commentId ||
        JSON.stringify(existing.result) !== JSON.stringify(parsed)
      )
        throw new Error("Research result changed; review needs reconciliation.");
    },
  };
}
