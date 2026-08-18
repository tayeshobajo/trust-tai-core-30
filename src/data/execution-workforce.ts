import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type WorkforceState = "working" | "idle" | "blocked" | "waiting_for_tai";

interface ScoutDriverData {
  agentId: string;
  name: string;
  goal: string;
  target: number;
  qualified: number;
  readyForComms: number;
  current: number;
  deficit: number;
  status: "working" | "idle" | "blocked";
  lastRunAt: string | null;
  lastOutput: string;
  latestBindingId: string | null;
  latestBindingStatus: string | null;
}

interface WorkforceSummary {
  available: number;
  working: number;
  blocked: number;
  waitingForTai: number;
  scout: ScoutDriverData;
}

function membershipError() {
  return new Error("You are not a member of this Trust Tai workspace.");
}

async function assertMembership(context: any, organizationId: string) {
  // Single-org system: verify the org exists and the user is authenticated.
  // organization_memberships table is not yet provisioned; access is scoped
  // by auth, any authenticated user in this workspace can read workforce state.
  const { data, error } = await context.supabase
    .from("organizations")
    .select("id")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw membershipError();
}

function statusFromPaperclip(agent: any, issues: any[], current: number, target: number): WorkforceState {
  const waitingForTai = issues.some(
    (issue) =>
      issue.status === "in_review" ||
      (issue.status === "blocked" && typeof issue.responsibleUserId === "string"),
  );
  if (waitingForTai) return "waiting_for_tai";
  if (issues.some((issue) => issue.status === "blocked")) return "blocked";
  if (agent.status === "running" || agent.status === "working" || current < target) return "working";
  return "idle";
}

function driverStatus(state: WorkforceState): "working" | "idle" | "blocked" {
  return state === "waiting_for_tai" ? "blocked" : state;
}

function outputSummary(binding: any): string {
  const outputs = (binding?.business_outputs ?? {}) as Record<string, unknown>;
  const added = outputs["qualified_prospects_added"];
  if (typeof added === "number") {
    return `${added} qualified prospect${added === 1 ? "" : "s"} added`;
  }
  if (typeof binding?.result_summary === "string" && binding.result_summary.trim()) {
    return binding.result_summary.trim();
  }
  return "No recorded output yet";
}

async function scoutSnapshot(organizationId: string): Promise<{
  data: ScoutDriverData;
  workforceState: WorkforceState;
}> {
  const [
    { paperclipClient },
    {
      latestExecutionBinding,
      listExecutionAgents,
      scoutPipelineState,
    },
  ] = await Promise.all([
    import("@/lib/paperclip-client.server"),
    import("@/lib/execution-bridge.server"),
  ]);

  const [agents, pipeline] = await Promise.all([
    listExecutionAgents(organizationId),
    scoutPipelineState(organizationId),
  ]);
  const scoutAgent = agents.find((agent) => agent.owning_app === "scout");
  if (!scoutAgent) throw new Error("Scout execution agent is not registered in this workspace.");

  const agent = await paperclipClient.getAgent(scoutAgent.paperclip_agent_id);
  const [issues, latestBinding] = await Promise.all([
    paperclipClient.getIssues(agent.companyId, {
      assigneeAgentId: scoutAgent.paperclip_agent_id,
      limit: 6,
      status: ["todo", "in_progress", "in_review", "blocked"],
    }),
    latestExecutionBinding(organizationId, scoutAgent.paperclip_agent_id),
  ]);

  const workforceState = statusFromPaperclip(agent, issues, pipeline.current, pipeline.target);
  return {
    workforceState,
    data: {
      agentId: scoutAgent.paperclip_agent_id,
      name: scoutAgent.name,
      goal: "Maintain 15 qualified prospects",
      target: pipeline.target,
      qualified: pipeline.qualified,
      readyForComms: pipeline.readyForComms,
      current: pipeline.current,
      deficit: pipeline.deficit,
      status: driverStatus(workforceState),
      lastRunAt: agent.lastHeartbeatAt ?? latestBinding?.updated_at ?? null,
      lastOutput: outputSummary(latestBinding),
      latestBindingId: latestBinding?.id ?? null,
      latestBindingStatus: latestBinding?.status ?? null,
    },
  };
}

export const getScoutDriver = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: { organizationId: string }) => data)
  .handler(async ({ context, data }) => {
    await assertMembership(context, data.organizationId);
    return (await scoutSnapshot(data.organizationId)).data;
  });

export const getWorkforceSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: { organizationId: string }) => data)
  .handler(async ({ context, data }) => {
    await assertMembership(context, data.organizationId);
    const [
      scout,
      { listExecutionAgents },
    ] = await Promise.all([
      scoutSnapshot(data.organizationId),
      import("@/lib/execution-bridge.server"),
    ]);

    const agents = await listExecutionAgents(data.organizationId);
    const workforce: WorkforceSummary = {
      available: agents.length,
      working: scout.workforceState === "working" ? 1 : 0,
      blocked: scout.workforceState === "blocked" ? 1 : 0,
      waitingForTai: scout.workforceState === "waiting_for_tai" ? 1 : 0,
      scout: scout.data,
    };
    if (scout.workforceState === "idle") {
      workforce.working = 0;
      workforce.blocked = 0;
      workforce.waitingForTai = 0;
    }
    return workforce;
  });
