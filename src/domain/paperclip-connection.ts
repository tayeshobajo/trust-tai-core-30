/**
 * Paperclip connection state, stated honestly.
 *
 * Paperclip may run laptop-local, so a production deployment often cannot
 * reach its API directly. That is not a failure: the scheduled reconciliation
 * sweep is the reliable production truth source. Three explicit states keep
 * the UI truthful instead of alarming.
 *
 *  live         direct API reachable now
 *  synchronized live API unavailable, reconciliation projection is fresh
 *  interrupted  neither live API nor a fresh reconciliation
 */

export type PaperclipMode = "live" | "synchronized" | "interrupted";

export const PAPERCLIP_MODE_LABEL: Record<PaperclipMode, string> = {
  live: "Paperclip \u00b7 live",
  synchronized: "Paperclip \u00b7 synchronized",
  interrupted: "Paperclip \u00b7 interrupted",
};

/** Freshness of the reconciliation projection. */
export type PaperclipFreshness = "live" | "fresh" | "delayed" | "stale" | "never";

export const FRESH_LIMIT_MS = 10 * 60_000;
export const DELAYED_LIMIT_MS = 30 * 60_000;

export interface PaperclipConnection {
  mode: PaperclipMode;
  freshness: PaperclipFreshness;
  /** "Paperclip · live" | "Paperclip · synchronized" | "Paperclip · interrupted" */
  label: string;
  /** Milliseconds since the last successful reconciliation, when known. */
  ageMs: number | null;
  /** Human age, e.g. "42s ago", "18m ago". Null when never synchronized. */
  ageLabel: string | null;
  /** Only true for interrupted or badly stale state. */
  prominentWarning: boolean;
  /** Amber, non-alarming delayed state. */
  delayed: boolean;
  /** One calm sentence. Safe to show as helper text or tooltip. */
  helper: string;
  /** Whether metric values that only exist on live reads can be trusted. */
  metricsKnown: boolean;
}

export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function paperclipConnection(input: {
  /** True only when a direct Paperclip API read succeeded in this request. */
  liveReachable: boolean;
  /** Last successful reconciliation sweep timestamp (ISO), from the sync cursor. */
  lastSuccessAt: string | null;
  now?: number;
}): PaperclipConnection {
  const now = input.now ?? Date.now();
  const parsed = input.lastSuccessAt ? new Date(input.lastSuccessAt).getTime() : NaN;
  const ageMs = Number.isFinite(parsed) ? Math.max(0, now - parsed) : null;
  const ageLabel = ageMs === null ? null : formatAge(ageMs);

  if (input.liveReachable) {
    return {
      mode: "live",
      freshness: "live",
      label: "Paperclip · live",
      ageMs,
      ageLabel,
      prominentWarning: false,
      delayed: false,
      helper: "Reading Paperclip execution state directly.",
      metricsKnown: true,
    };
  }

  if (ageMs !== null && ageMs <= FRESH_LIMIT_MS) {
    return {
      mode: "synchronized",
      freshness: "fresh",
      label: "Paperclip · synchronized",
      ageMs,
      ageLabel,
      prominentWarning: false,
      delayed: false,
      helper: `Live connection unavailable. Showing synchronized state from ${ageLabel}.`,
      metricsKnown: false,
    };
  }

  if (ageMs !== null && ageMs <= DELAYED_LIMIT_MS) {
    return {
      mode: "synchronized",
      freshness: "delayed",
      label: "Paperclip · synchronized",
      ageMs,
      ageLabel,
      prominentWarning: false,
      delayed: true,
      helper: `Sync delayed · ${ageLabel}.`,
      metricsKnown: false,
    };
  }

  return {
    mode: "interrupted",
    freshness: ageMs === null ? "never" : "stale",
    label: "Paperclip · interrupted",
    ageMs,
    ageLabel,
    prominentWarning: true,
    delayed: false,
    helper:
      ageLabel === null
        ? "Paperclip sync interrupted. No successful reconciliation has been recorded yet, so agent state may be outdated."
        : `Paperclip sync interrupted. Agent state may be outdated · last successful sync ${ageLabel}.`,
    metricsKnown: false,
  };
}

/** Never render an unknown count as a fact. Zero only when zero is proven. */
export function metricText(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : ", ";
}
