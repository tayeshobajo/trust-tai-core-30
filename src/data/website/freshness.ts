/**
 * Freshness, kept deliberately small.
 *
 * The provider ledger is the source of truth for when a source last reported,
 * never the age of the rows it produced. A page published last December does
 * not make the inventory stale, and a quiet day does not make GA4 old.
 *
 * Four truths have to stay apart: reporting and fresh, reporting but old, ran
 * successfully with nothing to report, and tried and failed.
 */

import type {
  ProviderReadiness,
  ProviderState,
  ProviderSyncRecord,
} from "@/domain/website-analytics";

/** How old a source may be before the room calls it stale. */
export const STALE_AFTER_HOURS: Record<string, number> = {
  ga4: 48,
  search_console: 96,
  page_inventory: 96,
  first_party_events: 72,
  site_health: 168,
};

const hoursSince = (value: string | null, now: number): number | null => {
  if (!value) return null;
  const then = Date.parse(value);
  if (Number.isNaN(then)) return null;
  return (now - then) / 3_600_000;
};

/** The moment a provider last reported, ledger first. */
export function reportedAt(
  readiness: ProviderReadiness,
  record: ProviderSyncRecord | undefined,
): string | null {
  return record?.lastSuccessAt ?? record?.lastRunAt ?? readiness.lastSyncedAt ?? null;
}

/** Decides one provider's state from what actually happened. */
export function providerState(
  readiness: ProviderReadiness,
  record: ProviderSyncRecord | undefined,
  now = Date.now(),
): ProviderState {
  if (record && !record.configured) return "not_configured";
  if (record?.lastError) return "failed";

  const capable = Boolean(
    record?.configured || readiness.capabilityAvailable || readiness.connected,
  );
  if (!capable) return "not_configured";

  const last = record?.lastSuccessAt ?? readiness.lastSyncedAt ?? null;
  if (!last) return "quiet";

  const age = hoursSince(last, now);
  const limit = STALE_AFTER_HOURS[readiness.id] ?? 72;
  if (age !== null && age > limit) return "stale";

  return readiness.connected ? "live" : "quiet";
}

/** Words a person can read, matched to the state. */
export function stateLabel(state: ProviderState): string {
  switch (state) {
    case "live":
      return "Live";
    case "stale":
      return "Stale";
    case "quiet":
      return "Quiet";
    case "failed":
      return "Last run failed";
    default:
      return "Not configured";
  }
}

/** One honest line per state, so nothing contradicts the label above it. */
export function stateNote(entry: ProviderReadiness): string {
  switch (entry.state ?? (entry.connected ? "live" : "not_configured")) {
    case "live":
      return entry.note;
    case "stale":
      return "Connected. The last successful run is older than we would like.";
    case "quiet":
      return "Connected. Nothing was returned for this window yet.";
    case "failed":
      return entry.lastError ? `The last run failed: ${entry.lastError}` : "The last run failed.";
    default:
      return entry.note;
  }
}

/** Folds sync records into readiness without changing what was observed. */
export function withFreshness(
  readiness: ProviderReadiness[],
  records: ProviderSyncRecord[],
  now = Date.now(),
): ProviderReadiness[] {
  const byProvider = new Map(records.map((record) => [record.provider, record]));
  return readiness.map((entry) => {
    const record =
      byProvider.get(entry.id) ??
      (entry.derivedFrom ? byProvider.get(entry.derivedFrom) : undefined);
    const state = providerState(entry, record, now);
    return {
      ...entry,
      state,
      lastError: record?.lastError ?? null,
      lastRunAt: record?.lastRunAt ?? null,
      lastSyncedAt: reportedAt(entry, record),
    };
  });
}

/** The freshest successful report across the room, for the Updated stamp. */
export function freshestSyncAt(readiness: ProviderReadiness[]): string | null {
  let best: string | null = null;
  for (const entry of readiness) {
    if (entry.state === "failed" || entry.state === "not_configured") continue;
    const value = entry.lastSyncedAt;
    if (!value) continue;
    if (!best || value > best) best = value;
  }
  return best;
}
