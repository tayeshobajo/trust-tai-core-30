/** Headless intake preparation only. Never calls wake/resume/runtime APIs. */
import { researchRequestSchema, researchIssueDescription } from "@/domain/studio-research";
import { COORDINATOR } from "./studio-research-coordinator-contracts";
import type { ResearchDeps } from "./studio-research.server";
export type IntakeDeps = {
  mode: "offline-synthetic" | "linux-public-preview" | "production";
  authorize(request: Request, org: string): Promise<{ userId: string }>;
  owner(org: string, id: string): Promise<string | null>;
  agent: ResearchDeps["agent"];
  reserve: ResearchDeps["reserve"];
  attachIssue: ResearchDeps["attachIssue"];
  markUncertain: ResearchDeps["markUncertain"];
  createIssue: ResearchDeps["createIssue"];
};
export async function prepareManualResearchRequest(request: Request, raw: unknown, d: IntakeDeps) {
  if (!["offline-synthetic", "linux-public-preview"].includes(d.mode))
    return { status: "blocked" as const, reason: "intake_unavailable" };
  const input = researchRequestSchema.parse(raw);
  if (input.organizationId !== COORDINATOR.organizationId || request.method !== "POST")
    throw Error("not_authorized");
  const user = await d.authorize(request, input.organizationId);
  const agent = await d.agent(COORDINATOR.agentId);
  if (
    agent.id !== COORDINATOR.agentId ||
    agent.companyId !== COORDINATOR.companyId ||
    agent.status !== "paused"
  )
    return { status: "blocked" as const, reason: "native_agent_not_paused" };
  const reserved = await d.reserve(input, COORDINATOR.companyId, COORDINATOR.agentId);
  if (reserved.kind === "conflict")
    return { status: "blocked" as const, reason: "request_conflict" };
  const run = reserved.run;
  if (
    (await d.owner(input.organizationId, input.requestId)) !== user.userId ||
    run.request.organizationId !== input.organizationId ||
    run.request.requestId !== input.requestId ||
    run.request.topic !== input.topic ||
    run.companyId !== COORDINATOR.companyId ||
    run.agentId !== COORDINATOR.agentId
  )
    throw Error("request_not_owned");
  if (reserved.kind === "existing")
    return run.state === "submitted" && run.issueId
      ? { status: "prepared" as const, requestId: input.requestId, issueId: run.issueId }
      : { status: "uncertain" as const, requestId: input.requestId };
  if (run.state !== "dispatching" || run.issueId) throw Error("claim_invalid");
  try {
    const current = await d.authorize(request, input.organizationId);
    if (current.userId !== user.userId) throw Error("authorization_changed");
    const latestAgent = await d.agent(COORDINATOR.agentId);
    if (
      latestAgent.id !== COORDINATOR.agentId ||
      latestAgent.companyId !== COORDINATOR.companyId ||
      latestAgent.status !== "paused"
    )
      throw Error("agent_status_changed");
    const issue = await d.createIssue({
      companyId: COORDINATOR.companyId,
      assigneeAgentId: COORDINATOR.agentId,
      correlationId: `studio:research:${input.organizationId}:${input.requestId}`,
      title: `Studio research: ${input.topic.slice(0, 100)}`,
      description: researchIssueDescription(input),
    });
    if (issue.companyId !== COORDINATOR.companyId || issue.assigneeAgentId !== COORDINATOR.agentId)
      throw Error("issue_mismatch");
    await d.attachIssue(run, issue.id);
    return { status: "prepared" as const, requestId: input.requestId, issueId: issue.id };
  } catch {
    await d.markUncertain(run).catch(() => undefined);
    return { status: "uncertain" as const, requestId: input.requestId };
  }
}
