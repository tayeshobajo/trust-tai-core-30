/**
 * Freshness, kept deliberately small.
 *
 * A timestamp and a short last error per provider is enough to tell four
 * truths apart: connected and fresh, connected but stale, not configured, and
 * tried and failed. This is not monitoring, it is honesty about the last run.
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

/** Decides one provider's state from what actually happened. */
export function providerState(
  readiness: ProviderReadiness,
  record: ProviderSyncRecord | undefined,
  now = Date.now(),
): ProviderState {
  if (record && !record.configured) return "not_configured";
  if (record?.lastError) return "failed";
  if (!readiness.connected) return record?.configured ? "quiet" : "not_configured";
  const age = hoursSince(readiness.lastSyncedAt ?? record?.lastSuccessAt ?? null, now);
  const limit = STALE_AFTER_HOURS[readiness.id] ?? 72;
  if (age !== null && age > limit) return "stale";
  return "live";
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

/** Folds sync records into readiness without changing what was observed. */
export function withFreshness(
  readiness: ProviderReadiness[],
  records: ProviderSyncRecord[],
  now = Date.now(),
): ProviderReadiness[] {
  const byProvider = new Map(records.map((record) => [record.provider, record]));
  return readiness.map((entry) => {
    const record = byProvider.get(entry.id);
    const state = providerState(entry, record, now);
    return {
      ...entry,
      state,
      lastError: record?.lastError ?? null,
      lastRunAt: record?.lastRunAt ?? null,
      lastSyncedAt: entry.lastSyncedAt ?? record?.lastSuccessAt ?? null,
    };
  });
}
