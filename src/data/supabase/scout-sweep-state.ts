/**
 * Sweep settings and the last run's counts, per organization.
 *
 * Deliberately forgiving: if `scout_sweep_state` has not been applied to the
 * database yet, Scout reports default settings and no previous run rather than
 * failing the Watchlist. A manual sweep still works without it.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import {
  DEFAULT_SWEEP_SETTINGS,
  type SweepCadence,
  type SweepSettings,
  type SweepSummary,
} from "@/data/scout/sweep";

export interface SweepLastRun {
  at: string;
  kind: "manual" | "scheduled";
  watched: number;
  read: number;
  changed: number;
  alreadyCurrent: number;
  unreadable: number;
  skipped: number;
  deferred: number;
}

export interface SweepState {
  settings: SweepSettings;
  lastRun: SweepLastRun | null;
  /** False when the state table is not available yet. */
  stored: boolean;
}

type Row = Record<string, unknown>;

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toState(row: Row | null): SweepState {
  if (!row) return { settings: DEFAULT_SWEEP_SETTINGS, lastRun: null, stored: true };
  const cadence: SweepCadence = row["cadence"] === "weekly" ? "weekly" : "daily";
  const at = typeof row["last_run_at"] === "string" ? row["last_run_at"] : null;
  return {
    settings: { enabled: row["enabled"] !== false, cadence },
    stored: true,
    lastRun: at
      ? {
          at,
          kind: row["last_run_kind"] === "scheduled" ? "scheduled" : "manual",
          watched: number(row["watched_count"]),
          read: number(row["read_count"]),
          changed: number(row["changed_count"]),
          alreadyCurrent: number(row["current_count"]),
          unreadable: number(row["unreadable_count"]),
          skipped: number(row["skipped_count"]),
          deferred: number(row["deferred_count"]),
        }
      : null,
  };
}

export async function readSweepState(organizationId: ID): Promise<SweepState> {
  const { data, error } = await supabase
    .from("scout_sweep_state")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) return { settings: DEFAULT_SWEEP_SETTINGS, lastRun: null, stored: false };
  return toState((data ?? null) as Row | null);
}

export async function saveSweepSettings(
  organizationId: ID,
  settings: SweepSettings,
): Promise<SweepSettings> {
  const { error } = await supabase.from("scout_sweep_state").upsert(
    {
      organization_id: organizationId,
      enabled: settings.enabled,
      cadence: settings.cadence,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  if (error) throw new Error(error.message);
  return settings;
}

/** Record what a run did. Counts only; a failure here never fails the run. */
export async function recordSweepRun(
  organizationId: ID,
  summary: SweepSummary,
  kind: "manual" | "scheduled",
): Promise<void> {
  const { error } = await supabase.from("scout_sweep_state").upsert(
    {
      organization_id: organizationId,
      last_run_at: new Date().toISOString(),
      last_run_kind: kind,
      watched_count: summary.watched,
      read_count: summary.read,
      changed_count: summary.changed,
      current_count: summary.alreadyCurrent,
      unreadable_count: summary.unreadable,
      skipped_count: summary.skipped,
      deferred_count: summary.deferred,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  if (error) {
    // The sweep really happened; only the summary line is unavailable.
    console.warn("[scout] sweep summary not recorded:", error.message);
  }
}
