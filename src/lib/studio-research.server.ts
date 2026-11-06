/**
 * Coordinator wired by the staged authenticated Studio research server functions.
 * Dispatch remains gated by server configuration and verified worker admission.
 * Atomic durable claims must be installed before activation.
 */
import {
  researchIssueDescription,
  researchRequestSchema,
  parseResearchResult,
  type ResearchRequest,
  type ResearchResult,
} from "@/domain/studio-research";

export type ResearchRun = {
  id: string;
  request: ResearchRequest;
  companyId: string;
  agentId: string;
  issueId: string | null;
  state: "dispatching" | "submitted" | "dispatch_uncertain";
};

export interface ResearchDeps {
  /** Verify session, active org membership AND Studio work/read grant on server. */
  authorize(token: string, organizationId: string, action: "read" | "work"): Promise<boolean>;
  /** Server-resolved org binding; never accept company/agent IDs from a browser. */
  configuration(organizationId: string): Promise<{
    enabled: boolean;
    organizationId: string;
    companyId: string;
    agentId: string;
    owningApp: string;
    capabilities: string[];
  } | null>;
  agent(
    id: string,
  ): Promise<{ id: string; companyId: string; status: string; pausedAt?: string | null }>;
  /**
   * Atomic insert-if-absent keyed by (organizationId, requestId). A unique
   * constraint plus INSERT/ON CONFLICT or reviewed RPC must decide `claimed`.
   * An existing request with different topic must return conflict, not replay.
   * Never reclaim an uncertain/dispatching request based only on elapsed time.
   */
  reserve(
    request: ResearchRequest,
    companyId: string,
    agentId: string,
  ): Promise<
    | { kind: "claimed"; run: ResearchRun }
    | { kind: "existing"; run: ResearchRun }
    | { kind: "conflict" }
  >;
  /** Single attempt. Must not retry a POST on timeout, 5xx, or lost response. */
  createIssue(input: {
    companyId: string;
    assigneeAgentId: string;
    correlationId: string;
    title: string;
    description: string;
  }): Promise<{ id: string; companyId: string; assigneeAgentId: string }>;
  /** Atomic, org-scoped compare-and-set from dispatching to submitted. */
  attachIssue(run: ResearchRun, issueId: string): Promise<void>;
  markUncertain(run: ResearchRun): Promise<void>;
  /** Org-scoped lookup; never fetch a Paperclip issue supplied by the browser. */
  readRun(organizationId: string, requestId: string): Promise<ResearchRun | null>;
  /** Bounded read of the bound issue, with provenance verified by transport. */
  readIssue(
    companyId: string,
    issueId: string,
  ): Promise<{
    id: string;
    companyId: string;
    assigneeAgentId: string;
    status: string;
    comments: Array<{
      id: string;
      companyId: string;
      issueId: string;
      authorAgentId: string | null;
      deletedAt: string | null;
      body: string;
    }>;
  }>;
}

export type ResearchStart =
  | { status: "submitted"; requestId: string; issueId: string }
  | {
      status: "blocked";
      reason:
        | "not_authorized"
        | "not_configured"
        | "agent_unavailable"
        | "conflict"
        | "storage_unavailable";
    }
  | { status: "dispatch_uncertain"; requestId: string };

function sameRequest(a: ResearchRequest, b: ResearchRequest): boolean {
  return (
    a.requestId === b.requestId && a.organizationId === b.organizationId && a.topic === b.topic
  );
}

export async function startStudioResearch(
  token: string,
  raw: unknown,
  deps: ResearchDeps,
): Promise<ResearchStart> {
  const request = researchRequestSchema.parse(raw);
  if (!token || !(await deps.authorize(token, request.organizationId, "work"))) {
    return { status: "blocked", reason: "not_authorized" };
  }
  const config = await deps.configuration(request.organizationId);
  if (
    !config?.enabled ||
    config.organizationId !== request.organizationId ||
    !config.companyId ||
    !config.agentId ||
    config.owningApp !== "studio" ||
    !config.capabilities.includes("studio.research")
  ) {
    return { status: "blocked", reason: "not_configured" };
  }
  try {
    const agent = await deps.agent(config.agentId);
    if (
      agent.id !== config.agentId ||
      agent.companyId !== config.companyId ||
      agent.pausedAt ||
      !["active", "idle", "running"].includes(agent.status)
    ) {
      return { status: "blocked", reason: "agent_unavailable" };
    }
  } catch {
    return { status: "blocked", reason: "agent_unavailable" };
  }

  let reserved: Awaited<ReturnType<ResearchDeps["reserve"]>>;
  try {
    reserved = await deps.reserve(request, config.companyId, config.agentId);
  } catch {
    return { status: "blocked", reason: "storage_unavailable" };
  }
  if (reserved.kind === "conflict") return { status: "blocked", reason: "conflict" };
  const run = reserved.run;
  if (
    !sameRequest(run.request, request) ||
    run.companyId !== config.companyId ||
    run.agentId !== config.agentId
  ) {
    return { status: "blocked", reason: "conflict" };
  }
  if (reserved.kind === "existing") {
    return run.state === "submitted" && run.issueId
      ? { status: "submitted", requestId: request.requestId, issueId: run.issueId }
      : { status: "dispatch_uncertain", requestId: request.requestId };
  }
  if (run.state !== "dispatching" || run.issueId) return { status: "blocked", reason: "conflict" };
  try {
    const issue = await deps.createIssue({
      companyId: config.companyId,
      assigneeAgentId: config.agentId,
      correlationId: `studio:research:${request.organizationId}:${request.requestId}`,
      title: `Studio research: ${request.topic.slice(0, 100)}`,
      description: researchIssueDescription(request),
    });
    if (
      !issue.id ||
      issue.companyId !== config.companyId ||
      issue.assigneeAgentId !== config.agentId
    ) {
      throw new Error("Unverified issue binding.");
    }
    await deps.attachIssue(run, issue.id);
    return { status: "submitted", requestId: request.requestId, issueId: issue.id };
  } catch {
    // An error may occur AFTER the external issue exists. Never dispatch again.
    // If marking fails, the durable dispatching claim must still block retries.
    await deps.markUncertain(run).catch(() => undefined);
    return { status: "dispatch_uncertain", requestId: request.requestId };
  }
}

export type ResearchReview =
  | {
      status: "blocked";
      reason: "not_authorized" | "not_found" | "source_unavailable" | "binding_mismatch";
    }
  | { status: "waiting" | "dispatch_uncertain" | "failed" | "invalid_result" }
  | { status: "review_ready"; commentId: string; result: ResearchResult };

export async function readStudioResearch(
  token: string,
  organizationId: string,
  requestId: string,
  deps: ResearchDeps,
): Promise<ResearchReview> {
  if (!token || !(await deps.authorize(token, organizationId, "read"))) {
    return { status: "blocked", reason: "not_authorized" };
  }
  const run = await deps.readRun(organizationId, requestId);
  if (!run) return { status: "blocked", reason: "not_found" };
  if (run.request.organizationId !== organizationId || run.request.requestId !== requestId) {
    return { status: "blocked", reason: "binding_mismatch" };
  }
  if (!run.issueId || run.state !== "submitted") return { status: "dispatch_uncertain" };
  try {
    const issue = await deps.readIssue(run.companyId, run.issueId);
    if (
      issue.id !== run.issueId ||
      issue.companyId !== run.companyId ||
      issue.assigneeAgentId !== run.agentId
    ) {
      return { status: "blocked", reason: "binding_mismatch" };
    }
    if (["cancelled", "canceled"].includes(issue.status)) return { status: "failed" };
    if (issue.status !== "done") return { status: "waiting" };
    // A done issue alone is not evidence of a usable result. Exactly one matching
    // result is required; ambiguous revisions remain for explicit reconciliation.
    const results: Array<{ commentId: string; result: ResearchResult }> = [];
    for (const comment of issue.comments.slice(0, 100)) {
      if (
        comment.deletedAt ||
        comment.companyId !== run.companyId ||
        comment.issueId !== run.issueId ||
        comment.authorAgentId !== run.agentId
      )
        continue;
      try {
        results.push({
          commentId: comment.id,
          result: parseResearchResult(comment.body, requestId),
        });
      } catch {
        /* Progress comments and malformed outputs are not accepted. */
      }
    }
    if (issue.comments.length > 100 || results.length !== 1) return { status: "invalid_result" };
    return { status: "review_ready", ...results[0]! };
  } catch {
    return { status: "blocked", reason: "source_unavailable" };
  }
}
