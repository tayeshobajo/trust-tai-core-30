/**
 * Domain contract for the tables the Trust Tai execution bridge touches.
 *
 * `src/integrations/supabase/types.ts` is still the empty placeholder schema,
 * so a plain `createClient()` resolves every `.from()` row type to `never`.
 * This local schema gives the service-role client real Row/Insert/Update
 * contracts for exactly the tables the bridge reads and writes, nothing more.
 */

export type ExecutionJson = Record<string, unknown>;

export type ExecutionAgentRow = {
  id: string;
  organization_id: string;
  paperclip_agent_id: string;
  name: string;
  owning_app: string;
  principal: string;
  capabilities: string[] | null;
  enabled: boolean;
  metadata: ExecutionJson | null;
  // Phase 4-6 sync projection fields
  last_known_status: string | null;
  last_synced_at: string | null;
  paperclip_company_id: string | null;
  paused_at: string | null;
  last_heartbeat_at: string | null;
  routine_ids: string[] | null;
  created_at: string;
  updated_at: string;
};

export type PaperclipSyncStateRow = {
  id: string;
  organization_id: string;
  resource_type: string;
  last_success_at: string | null;
  last_cursor: string | null;
  last_error: string | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
};

export type ExecutionBindingRow = {
  id: string;
  organization_id: string;
  source_app: string;
  source_entity_type: string | null;
  source_entity_id: string | null;
  conductor_action_id: string | null;
  paperclip_company_id: string;
  paperclip_issue_id: string | null;
  paperclip_agent_id: string;
  paperclip_run_id: string | null;
  objective: string;
  expected_outcome: string | null;
  status: string;
  result_summary: string | null;
  business_outputs: ExecutionJson | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
};

export type ProspectRow = {
  id: string;
  organization_id: string;
  company_name: string;
  website_url: string | null;
  status: string;
  source: string | null;
  observed: unknown;
  inferred: unknown;
  suggested: unknown;
  provenance: unknown;
  created_at: string;
  updated_at: string;
};

export type IcpProfileRow = {
  id: string;
  organization_id: string;
  version: number;
  content: string | null;
  format: string | null;
  created_at: string;
  updated_at: string;
};

type TableContract<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type ExecutionDatabase = {
  __InternalSupabase: { PostgrestVersion: "14.15" };
  public: {
    Tables: {
      execution_agents: TableContract<ExecutionAgentRow>;
      execution_bindings: TableContract<ExecutionBindingRow>;
      paperclip_sync_state: TableContract<PaperclipSyncStateRow>;
      prospects: TableContract<ProspectRow>;
      icp_profiles: TableContract<IcpProfileRow>;
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
