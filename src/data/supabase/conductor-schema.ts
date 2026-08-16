/**
 * Conductor schema health.
 *
 * The Conductor's three tables live in the shared Trust Tai project and are
 * applied by hand from docs/conductor-v1-schema.sql. Until that has happened,
 * a save fails silently-looking and a person is left guessing. This module
 * asks the plain question before anything is written: does the table exist,
 * and may this person read and write it?
 *
 * The probe is a zero-row read per table — cheap, side-effect free, and
 * scoped to one organization, so RLS answers the permission half honestly.
 */

import type { PostgrestError } from "@supabase/supabase-js";

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";

export const CONDUCTOR_TABLES = [
  "business_intents",
  "business_figures",
  "conductor_corrections",
] as const;

export type ConductorTable = (typeof CONDUCTOR_TABLES)[number];

export type TableStatus = "ready" | "missing" | "forbidden" | "unknown";

export interface TableHealth {
  table: ConductorTable;
  status: TableStatus;
  /** The database's own words, kept verbatim when something is wrong. */
  detail?: string;
}

export interface ConductorSchemaHealth {
  /** True only when every table exists and is readable by this person. */
  ready: boolean;
  /** True when at least one table has not been created yet. */
  missing: ConductorTable[];
  /** True when the table exists but this person may not read it. */
  forbidden: ConductorTable[];
  tables: TableHealth[];
  /** One plain sentence, safe to show a person as-is. */
  message: string;
  checkedAt: string;
}

/**
 * Read a Postgrest failure for what it actually means.
 *
 * PostgREST reports an absent table through its schema cache (PGRST205) or
 * Postgres' own undefined_table (42P01); a missing GRANT or a policy that
 * refuses the role arrives as insufficient_privilege (42501).
 */
export function classifyError(error: PostgrestError | null): TableStatus {
  if (!error) return "ready";
  const code = error.code ?? "";
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202") return "missing";
  if (text.includes("does not exist") || text.includes("could not find the table")) {
    return "missing";
  }
  if (code === "42501" || text.includes("permission denied")) return "forbidden";
  return "unknown";
}

/** One sentence a person can act on, chosen by what is actually wrong. */
export function healthMessage(
  missing: ConductorTable[],
  forbidden: ConductorTable[],
  unknown: TableHealth[],
): string {
  if (missing.length > 0) {
    return `The Conductor's ledger has not been created yet (${missing.join(", ")}). Apply docs/conductor-v1-schema.sql to the Trust Tai Supabase project — nothing can be recorded until then.`;
  }
  if (forbidden.length > 0) {
    return `The ledger exists but this account cannot reach it (${forbidden.join(", ")}). Check that you are an active member of this organization and that the table grants from docs/conductor-v1-schema.sql were applied.`;
  }
  if (unknown.length > 0) {
    return `The ledger could not be read just now: ${unknown[0]?.detail ?? "unknown error"}. Nothing was changed.`;
  }
  return "Ledger reachable. Figures and corrections will be saved.";
}

/** Probe all three tables at once and report in plain language. */
export async function checkConductorSchema(
  organizationId: ID,
): Promise<ConductorSchemaHealth> {
  const tables = await Promise.all(
    CONDUCTOR_TABLES.map(async (table): Promise<TableHealth> => {
      const { error } = await supabase
        .from(table)
        .select("id", { head: true, count: "exact" })
        .eq("organization_id", organizationId)
        .limit(1);
      const status = classifyError(error);
      return {
        table,
        status,
        ...(error ? { detail: error.message } : {}),
      };
    }),
  );

  const missing = tables.filter((t) => t.status === "missing").map((t) => t.table);
  const forbidden = tables.filter((t) => t.status === "forbidden").map((t) => t.table);
  const unknown = tables.filter((t) => t.status === "unknown");

  return {
    ready: tables.every((t) => t.status === "ready"),
    missing,
    forbidden,
    tables,
    message: healthMessage(missing, forbidden, unknown),
    checkedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------- control ledger */

/**
 * The V2 control ledger is separate on purpose: the Conductor can still
 * reason and answer without it. Only approval and routing depend on it, so a
 * missing V2 migration disables the queue rather than the whole room.
 */
export const CONTROL_TABLES = ["conductor_actions", "conductor_receipts"] as const;

export type ControlTable = (typeof CONTROL_TABLES)[number];

export interface ControlSchemaHealth {
  ready: boolean;
  missing: ControlTable[];
  forbidden: ControlTable[];
  tables: { table: ControlTable; status: TableStatus; detail?: string }[];
  message: string;
  checkedAt: string;
}

export async function checkControlSchema(organizationId: ID): Promise<ControlSchemaHealth> {
  const tables = await Promise.all(
    CONTROL_TABLES.map(async (table) => {
      const { error } = await supabase
        .from(table)
        .select("id", { head: true, count: "exact" })
        .eq("organization_id", organizationId)
        .limit(1);
      const status = classifyError(error);
      return { table, status, ...(error ? { detail: error.message } : {}) };
    }),
  );

  const missing = tables.filter((t) => t.status === "missing").map((t) => t.table);
  const forbidden = tables.filter((t) => t.status === "forbidden").map((t) => t.table);
  const unknown = tables.filter((t) => t.status === "unknown");

  const message =
    missing.length > 0
      ? `The approval queue has no ledger yet (${missing.join(", ")}). Apply docs/conductor-v2-schema.sql — until then the Conductor can reason, but nothing can be approved or routed.`
      : forbidden.length > 0
        ? `The control ledger exists but this account cannot reach it (${forbidden.join(", ")}). Check your membership and the grants in docs/conductor-v2-schema.sql.`
        : unknown.length > 0
          ? `The control ledger could not be read just now: ${unknown[0]?.detail ?? "unknown error"}. Nothing was changed.`
          : "Control ledger reachable. Approvals and handovers are recorded.";

  return {
    ready: tables.every((t) => t.status === "ready"),
    missing,
    forbidden,
    tables,
    message,
    checkedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------ learning ledger */

/**
 * The V3 outcome and learning tables are checked on their own, for the same
 * reason V2 is: without them the Conductor still reasons, approves and routes
 * — it simply cannot remember what happened afterwards. A person should be
 * told that plainly rather than watching an empty panel and guessing.
 */
export const LEARNING_TABLES = ["conductor_observations", "conductor_learning"] as const;

export type LearningTable = (typeof LEARNING_TABLES)[number];

export interface LearningSchemaHealth {
  ready: boolean;
  missing: LearningTable[];
  forbidden: LearningTable[];
  tables: { table: LearningTable; status: TableStatus; detail?: string }[];
  message: string;
  checkedAt: string;
}

export async function checkLearningSchema(organizationId: ID): Promise<LearningSchemaHealth> {
  const tables = await Promise.all(
    LEARNING_TABLES.map(async (table) => {
      const { error } = await supabase
        .from(table)
        .select("id", { head: true, count: "exact" })
        .eq("organization_id", organizationId)
        .limit(1);
      const status = classifyError(error);
      return { table, status, ...(error ? { detail: error.message } : {}) };
    }),
  );

  const missing = tables.filter((t) => t.status === "missing").map((t) => t.table);
  const forbidden = tables.filter((t) => t.status === "forbidden").map((t) => t.table);
  const unknown = tables.filter((t) => t.status === "unknown");

  const message =
    missing.length > 0
      ? `Outcomes cannot be remembered yet (${missing.join(", ")}). Apply docs/conductor-v3-schema.sql to the Trust Tai Supabase project — until then the Conductor can act, but learns nothing from what happens next.`
      : forbidden.length > 0
        ? `The learning ledger exists but this account cannot reach it (${forbidden.join(", ")}). Check your membership and the grants in docs/conductor-v3-schema.sql.`
        : unknown.length > 0
          ? `The learning ledger could not be read just now: ${unknown[0]?.detail ?? "unknown error"}. Nothing was changed.`
          : "Learning ledger reachable. Outcomes are observed and lessons recorded.";

  return {
    ready: tables.every((t) => t.status === "ready"),
    missing,
    forbidden,
    tables,
    message,
    checkedAt: new Date().toISOString(),
  };
}
