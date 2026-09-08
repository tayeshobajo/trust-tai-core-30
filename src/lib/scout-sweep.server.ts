/**
 * The scheduled half of the bounded watchlist sweep.
 *
 * Nobody is present when this runs, so it is deliberately narrow: curated
 * watchlist rows only, at most ten per organization per run, only when their
 * evidence is missing or older than thirty days, one company at a time, behind
 * a single-flight lease.
 *
 * It reads public pages through the same `scout-research` function the app
 * uses, merges what it observed over what was already held, and records the
 * counts. It never adds a company, never sends anything, never scores a person,
 * and never decides that something moved.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { trustTaiSupabaseUrl } from "./trust-tai-backend.server";
import { mergeObservedRows } from "@/data/scout/research-run";
import {
  DEFAULT_SWEEP_SETTINGS,
  planSweep,
  summarizeSweep,
  type SweepCandidate,
  type SweepOutcome,
  type SweepSummary,
} from "@/data/scout/sweep";
import { evaluateScoutFit } from "@/data/scout-fit-evaluator";
import { appendResearchRun, runFromEvaluation } from "@/data/prospect-modules";

/** How long one organization's lease is held before it is considered dead. */
export const SWEEP_LEASE_MINUTES = 15;

type Row = Record<string, unknown>;

export interface SweepRunReport {
  organizations: number;
  swept: Array<{ organizationId: string } & Pick<SweepSummary, "read" | "changed" | "unreadable">>;
  skipped: Array<{ organizationId: string; because: string }>;
}

function serviceKey(): string | null {
  return (
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
    null
  );
}

export function sweepConfigured(): boolean {
  return Boolean(serviceKey());
}

function serviceClient(): SupabaseClient {
  const key = serviceKey();
  if (!key) throw new Error("The scheduled sweep has no server credentials configured.");
  return createClient(trustTaiSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* --------------------------------------------------------------- reading -- */

interface ResearchPayload {
  website_url?: string;
  hostname?: string;
  observed?: unknown[];
  inferred?: Row;
  suggested?: Row;
  provenance?: Row;
  pages_researched?: string[];
  error?: string;
  message?: string;
}

/** Read one company's public pages through the managed research function. */
export async function readPublicPages(websiteUrl: string): Promise<ResearchPayload> {
  const key = serviceKey();
  if (!key) throw new Error("No server credentials to read public pages with.");
  const response = await fetch(`${trustTaiSupabaseUrl()}/functions/v1/scout-research`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ website_url: websiteUrl }),
  });
  if (!response.ok) {
    throw new Error(`The research service answered ${response.status}.`);
  }
  const payload = (await response.json()) as ResearchPayload;
  if (payload.error) throw new Error(payload.error);
  if (!Array.isArray(payload.observed) || payload.observed.length === 0) {
    throw new Error("No readable public pages were found.");
  }
  return payload;
}

/* -------------------------------------------------------------- planning -- */

/** A stored prospect row reduced to what the shared planner needs. */
export function candidateFromRow(row: Row): SweepCandidate {
  const provenance = (row["provenance"] ?? {}) as Row;
  const observedAt =
    (typeof provenance["observed_at"] === "string" ? provenance["observed_at"] : null) ??
    (typeof provenance["researched_at"] === "string" ? provenance["researched_at"] : null);
  const scoreable = Array.isArray(row["observed"]) && (row["observed"] as unknown[]).length > 0;
  const consent = ((row["metadata"] ?? {}) as Row)["scout_research_consent"] as Row | undefined;
  const stated = ((row["metadata"] ?? {}) as Row)["stated"] as Row | undefined;

  // Inbound testimony is the only thing that can withhold permission. Without
  // a founder packet there is nothing to honour, so public pages may be read.
  let canResearch = true;
  let because = "";
  if (stated) {
    const decision = typeof consent?.["decision"] === "string" ? consent["decision"] : null;
    if (decision === "granted") canResearch = true;
    else if (decision === "withheld") {
      canResearch = false;
      because = "A person here decided not to research this company.";
    } else {
      canResearch = false;
      because = "Research permission for this inbound company has not been settled.";
    }
  }

  return {
    prospectId: String(row["id"]),
    name: String(row["company_name"] ?? "This company"),
    websiteUrl: (row["website_url"] as string | null) ?? null,
    lastResearchedAt: scoreable ? (observedAt ?? (row["updated_at"] as string | null)) : null,
    canResearch,
    permissionBecause: because,
    status: String(row["status"] ?? "discovered"),
  };
}

/* ------------------------------------------------------------------ run --- */

async function watchedRows(db: SupabaseClient, organizationId: string): Promise<Row[]> {
  const { data, error } = await db
    .from("prospects")
    .select("*")
    .eq("organization_id", organizationId)
    .not("metadata->scout_watchlist", "is", null);
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

async function organizationsWithWatchlist(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db
    .from("prospects")
    .select("organization_id")
    .not("metadata->scout_watchlist", "is", null);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((row) => String((row as Row)["organization_id"])))];
}

/**
 * Take this organization's sweep lease. Returns false when automatic checking
 * is off, or when another run already holds it.
 */
async function takeLease(db: SupabaseClient, organizationId: string, at: Date): Promise<boolean> {
  const { data } = await db
    .from("scout_sweep_state")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  const state = (data ?? null) as Row | null;
  const enabled = state ? state["enabled"] !== false : DEFAULT_SWEEP_SETTINGS.enabled;
  if (!enabled) return false;

  const held = typeof state?.["lease_until"] === "string" ? Date.parse(state["lease_until"]) : 0;
  if (held && held > at.getTime()) return false;

  const leaseUntil = new Date(at.getTime() + SWEEP_LEASE_MINUTES * 60 * 1000).toISOString();
  const { error } = await db.from("scout_sweep_state").upsert(
    {
      organization_id: organizationId,
      lease_until: leaseUntil,
      lease_owner: "scheduled",
      updated_at: at.toISOString(),
    },
    { onConflict: "organization_id" },
  );
  // A missing state table must not silently double-sweep, so treat it as taken
  // only when the write succeeded.
  return !error;
}

async function releaseLease(
  db: SupabaseClient,
  organizationId: string,
  summary: SweepSummary,
): Promise<void> {
  await db.from("scout_sweep_state").upsert(
    {
      organization_id: organizationId,
      lease_until: null,
      lease_owner: null,
      last_run_at: new Date().toISOString(),
      last_run_kind: "scheduled",
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
}

async function writeObservation(
  db: SupabaseClient,
  row: Row,
  payload: ResearchPayload,
): Promise<boolean> {
  const previous = Array.isArray(row["observed"]) ? (row["observed"] as unknown[]) : [];
  const merge = mergeObservedRows({ previous, incoming: payload.observed ?? [] });
  const at = new Date().toISOString();
  const evaluation = evaluateScoutFit({
    observed: merge.merged,
    inferred: payload.inferred ?? {},
    suggested: payload.suggested ?? {},
    scoreable: true,
    icpVersion: null,
    pagesResearched: payload.pages_researched?.length ?? 0,
  });

  const metadata = { ...((row["metadata"] ?? {}) as Row) };
  metadata["scout_fit"] = evaluation;
  metadata["research_history"] = appendResearchRun(
    row["metadata"],
    runFromEvaluation(evaluation, evaluation.evaluatedAt),
  );

  const { error } = await db
    .from("prospects")
    .update({
      observed: merge.merged,
      inferred: payload.inferred ?? row["inferred"] ?? {},
      suggested: payload.suggested ?? row["suggested"] ?? {},
      fit_score: evaluation.score,
      metadata,
      provenance: {
        ...((row["provenance"] ?? {}) as Row),
        ...(payload.provenance ?? {}),
        app_key: "scout",
        source_kind: "live_website",
        observed_at: at,
        swept_by: "scheduled",
      },
      updated_at: at,
    })
    .eq("id", row["id"] as string);
  if (error) throw new Error(error.message);

  const changed = merge.added > 0 || merge.replaced > 0;

  await db.from("activities").upsert(
    {
      organization_id: row["organization_id"],
      app_key: "scout",
      event_type: "prospect.researched",
      entity_type: "prospect",
      entity_id: row["id"],
      summary: `${row["company_name"]} was re-read from its public website during the scheduled watchlist check.`,
      source_event_key: `scout:sweep:${row["id"]}:${at.slice(0, 13)}`,
      occurred_at: at,
      payload: {
        source: "scheduled_sweep",
        observations_added: merge.added,
        observations_replaced: merge.replaced,
        observations_preserved: merge.kept,
        fit_score: evaluation.score,
      },
    },
    { onConflict: "organization_id,app_key,source_event_key", ignoreDuplicates: true },
  );

  return changed;
}

/** Sweep one organization's watchlist. Bounded, sequential, lease-protected. */
export async function sweepOrganization(
  db: SupabaseClient,
  organizationId: string,
): Promise<SweepSummary | null> {
  const at = new Date();
  const taken = await takeLease(db, organizationId, at);
  if (!taken) return null;

  const rows = await watchedRows(db, organizationId);
  const byId = new Map(rows.map((row) => [String(row["id"]), row]));
  const plan = planSweep({ candidates: rows.map(candidateFromRow), now: at.toISOString() });

  const outcomes: SweepOutcome[] = [];
  for (const target of plan.due) {
    const row = byId.get(target.prospectId);
    if (!row) continue;
    try {
      const payload = await readPublicPages(target.websiteUrl ?? "");
      const changed = await writeObservation(db, row, payload);
      outcomes.push({ prospectId: target.prospectId, name: target.name, state: "read", changed });
    } catch (error) {
      // One unreadable site never stops the run, and never downgrades the
      // company: its previous evidence stays exactly as it was.
      outcomes.push({
        prospectId: target.prospectId,
        name: target.name,
        state: "unreadable",
        changed: false,
        because: (error as Error).message,
      });
    }
  }

  const summary = summarizeSweep({ plan, outcomes });
  await releaseLease(db, organizationId, summary);
  return summary;
}

/** The whole scheduled pass: every organization that curates a watchlist. */
export async function runScheduledSweep(): Promise<SweepRunReport> {
  const db = serviceClient();
  const organizations = await organizationsWithWatchlist(db);
  const report: SweepRunReport = { organizations: organizations.length, swept: [], skipped: [] };

  for (const organizationId of organizations) {
    try {
      const summary = await sweepOrganization(db, organizationId);
      if (!summary) {
        report.skipped.push({
          organizationId,
          because: "Automatic checking is off, or a run is already in progress.",
        });
        continue;
      }
      report.swept.push({
        organizationId,
        read: summary.read,
        changed: summary.changed,
        unreadable: summary.unreadable,
      });
    } catch (error) {
      report.skipped.push({ organizationId, because: (error as Error).message });
    }
  }

  return report;
}
