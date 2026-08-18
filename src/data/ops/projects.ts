/**
 * Reading the synchronized Ops project projection.
 *
 * Read-only, under RLS, for the current organization. If the projection table
 * has not been provisioned yet, that is reported as "not provisioned" rather
 * than as an error or, worse, as an empty portfolio pretending to be truth.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import { readOpsProjectRow, type OpsProjectRow } from "@/domain/ops-projection";

export const OPS_PROJECTION_TABLE = "ops_project_projection";

export interface OpsProjectionRead {
  rows: OpsProjectRow[];
  /** True when the read itself succeeded, whatever it returned. */
  ok: boolean;
  /** True when the table does not exist in this database yet. */
  provisioned: boolean;
}

/** Postgres/PostgREST codes that mean "this table is not there yet". */
function missingTable(code: string | undefined, message: string): boolean {
  if (code === "42P01" || code === "PGRST205" || code === "PGRST200") return true;
  return /does not exist|could not find the table/i.test(message);
}

export async function loadOpsProjection(organizationId: string): Promise<OpsProjectionRead> {
  const { data, error } = await supabase
    .from(OPS_PROJECTION_TABLE as never)
    .select("*")
    .eq("organization_id", organizationId)
    .neq("lifecycle_state", "removed")
    .order("synced_at", { ascending: false, nullsFirst: false })
    .limit(500);

  if (error) {
    const provisioned = !missingTable(error.code, error.message ?? "");
    return { rows: [], ok: false, provisioned };
  }

  const rows: OpsProjectRow[] = [];
  for (const raw of (data ?? []) as unknown as Record<string, unknown>[]) {
    const row = readOpsProjectRow(raw);
    // Cross-organization safety belt on top of RLS: a row that is not ours
    // never renders, whatever the database returned.
    if (row && row.organizationId === organizationId && !row.removed) rows.push(row);
  }
  return { rows, ok: true, provisioned: true };
}
