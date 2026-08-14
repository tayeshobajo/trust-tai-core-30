/**
 * Connection state for Comms' external sources.
 *
 * A member may see whether a mailbox is connected, which account, and when it
 * last synced. Tokens are never selectable here: they live in the private
 * schema behind the server. A failed read is reported as itself, and a table
 * that has not been created yet reads as "not connected" rather than an error
 * dressed up as data.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type {
  IntegrationConnection,
  IntegrationProvider,
  IntegrationStatus,
} from "@/domain/comms-integrations";

const COLUMNS =
  "id, organization_id, provider, status, account_email, scopes, cursor, last_sync_at, last_error, connected_by, updated_at";

const STATUSES: IntegrationStatus[] = ["disconnected", "connected", "error", "revoked"];
const PROVIDERS: IntegrationProvider[] = ["gmail"];

interface IntegrationRow {
  id: string;
  organization_id: string;
  provider: string;
  status: string;
  account_email: string | null;
  scopes: unknown;
  cursor: unknown;
  last_sync_at: string | null;
  last_error: string | null;
  connected_by: string | null;
  updated_at: string | null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function toConnection(row: IntegrationRow): IntegrationConnection {
  return {
    id: row.id,
    organizationId: row.organization_id,
    provider: PROVIDERS.includes(row.provider as IntegrationProvider)
      ? (row.provider as IntegrationProvider)
      : "gmail",
    status: STATUSES.includes(row.status as IntegrationStatus)
      ? (row.status as IntegrationStatus)
      : "disconnected",
    ...(text(row.account_email) ? { accountEmail: text(row.account_email)! } : {}),
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    cursor:
      row.cursor && typeof row.cursor === "object"
        ? (row.cursor as Record<string, unknown>)
        : {},
    ...(text(row.last_sync_at) ? { lastSyncAt: text(row.last_sync_at)! } : {}),
    ...(text(row.last_error) ? { lastError: text(row.last_error)! } : {}),
    ...(text(row.connected_by) ? { connectedBy: text(row.connected_by)! } : {}),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  };
}

/** True when the integration tables have not been created in Supabase yet. */
function notProvisioned(message: string): boolean {
  return /relation .*comms_integrations.* does not exist|could not find the table|schema cache/i.test(
    message,
  );
}

export interface IntegrationsRead {
  connections: IntegrationConnection[];
  /** False until `docs/comms-integrations-schema.sql` has been applied. */
  provisioned: boolean;
}

export async function listIntegrations(organizationId: ID): Promise<IntegrationsRead> {
  const { data, error } = await supabase
    .from("comms_integrations")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .order("provider", { ascending: true });

  if (error) {
    if (notProvisioned(error.message)) return { connections: [], provisioned: false };
    throw new Error(error.message);
  }

  return {
    connections: ((data ?? []) as unknown as IntegrationRow[]).map(toConnection),
    provisioned: true,
  };
}
