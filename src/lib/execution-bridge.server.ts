// src/lib/execution-bridge.server.ts
// Validates agent identity, records bindings, enforces capability scope

if (typeof window !== 'undefined') {
  throw new Error('execution-bridge.server.ts must not be imported on the client');
}

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.TRUST_TAI_SUPABASE_URL!,
  process.env.TRUST_TAI_SUPABASE_SERVICE_KEY!
);

export interface AgentContext {
  agentId: string;        // execution_agents.id (UUID)
  paperclipAgentId: string;
  principal: string;
  capabilities: string[];
  organizationId: string;
  owningApp: string;
}

export async function validateAgent(
  executionKey: string,
  paperclipAgentId: string
): Promise<AgentContext> {
  const expectedKey = process.env.TRUST_TAI_EXECUTION_KEY;
  if (!expectedKey || executionKey !== expectedKey) {
    throw Object.assign(new Error('Invalid execution key'), { status: 401 });
  }

  const { data, error } = await supabase
    .from('execution_agents')
    .select('*')
    .eq('paperclip_agent_id', paperclipAgentId)
    .eq('enabled', true)
    .single();

  if (error || !data) {
    throw Object.assign(new Error('Agent not registered or disabled'), { status: 403 });
  }

  return {
    agentId: data.id,
    paperclipAgentId: data.paperclip_agent_id,
    principal: data.principal,
    capabilities: data.capabilities,
    organizationId: data.organization_id,
    owningApp: data.owning_app,
  };
}

export function assertCapability(agent: AgentContext, cap: string) {
  if (!agent.capabilities.includes(cap)) {
    throw Object.assign(
      new Error(`Agent ${agent.principal} lacks capability: ${cap}`),
      { status: 403 }
    );
  }
}

export interface BindingOptions {
  agent: AgentContext;
  sourceApp: string;
  objective: string;
  expectedOutcome?: string;
  idempotencyKey?: string;
  conductorActionId?: string;
  paperclipCompanyId?: string;
  paperclipIssueId?: string;
}

export async function recordBinding(opts: BindingOptions): Promise<string> {
  if (opts.idempotencyKey) {
    const { data: existing } = await supabase
      .from('execution_bindings')
      .select('id, status')
      .eq('idempotency_key', opts.idempotencyKey)
      .single();
    if (existing) return existing.id;
  }

  const { data, error } = await supabase
    .from('execution_bindings')
    .insert({
      organization_id: opts.agent.organizationId,
      source_app: opts.sourceApp,
      paperclip_company_id: opts.paperclipCompanyId ?? '',
      paperclip_agent_id: opts.agent.paperclipAgentId,
      paperclip_issue_id: opts.paperclipIssueId,
      conductor_action_id: opts.conductorActionId ?? null,
      objective: opts.objective,
      expected_outcome: opts.expectedOutcome,
      status: 'running',
      idempotency_key: opts.idempotencyKey,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to record binding: ${error?.message}`);
  }
  return data.id;
}

export async function completeBinding(
  bindingId: string,
  result: { status: 'completed' | 'failed' | 'no_work'; summary?: string; outputs?: Record<string, unknown> }
) {
  await supabase
    .from('execution_bindings')
    .update({
      status: result.status,
      result_summary: result.summary,
      business_outputs: result.outputs ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq('id', bindingId);
}
