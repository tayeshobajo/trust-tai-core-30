/**
 * Suite-wide intelligence freshness audit.
 *
 * One question: for each room, is the intelligence layer reading it now, only
 * partly, or not at all? Pure over a context bundle and the shared activity
 * stream. It never repairs anything and never guesses, a room with no rows
 * reads MISSING, which is a truthful answer.
 */

import type { ActivityEvent } from "@/domain/activity";
import type { ContextBlock, ContextSourceApp, WithheldSource } from "@/domain/signals";

export type FreshnessStatus = "current" | "partial" | "missing";

export const FRESHNESS_LABEL: Record<FreshnessStatus, string> = {
  current: "CURRENT",
  partial: "PARTIAL",
  missing: "MISSING",
};

export const AUDITED_APPS: ContextSourceApp[] = [
  "scout",
  "comms",
  "roadmap",
  "projects",
  "steward",
  "ops",
  "studio",
  "website",
];

export const APP_LABEL: Record<ContextSourceApp, string> = {
  scout: "Scout",
  comms: "Comms",
  roadmap: "Roadmap",
  projects: "Projects",
  studio: "Studio",
  ops: "Ops",
  steward: "Steward",
  website: "Website",
};

export interface AppFreshness {
  appId: ContextSourceApp;
  label: string;
  status: FreshnessStatus;
  /** Context blocks the intelligence layer currently holds for this room. */
  blockCount: number;
  /** Rows this room contributed to the shared activity stream. */
  eventCount: number;
  latestContextAt: string | null;
  latestEventAt: string | null;
  /** Whole days since the newest thing this room said. `null` when nothing. */
  ageDays: number | null;
  /** The newest event name, so the sequence is traceable. */
  latestEventName: string | null;
  because: string;
  withheldReason?: WithheldSource["reason"];
}

export interface FreshnessAudit {
  generatedAt: string;
  apps: AppFreshness[];
  current: number;
  partial: number;
  missing: number;
}

const DAY = 86_400_000;
/** Beyond this a room's read is stale enough to call PARTIAL. */
export const CURRENT_WINDOW_DAYS = 14;

function appOfEvent(event: ActivityEvent): string {
  const fromProvenance = event.provenance.appId;
  if (fromProvenance) return fromProvenance;
  return event.name.split(".")[0] ?? "";
}

function newest(values: (string | undefined | null)[]): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isNaN(ms) || ms <= bestMs) continue;
    bestMs = ms;
    best = value;
  }
  return best;
}

export function auditIntelligenceFreshness(input: {
  blocks: ContextBlock[];
  events: ActivityEvent[];
  withheld?: WithheldSource[];
  now?: string;
}): FreshnessAudit {
  const nowIso = input.now ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const withheld = new Map((input.withheld ?? []).map((entry) => [entry.appId, entry.reason]));

  const apps = AUDITED_APPS.map((appId): AppFreshness => {
    const blocks = input.blocks.filter((block) => block.appId === appId);
    const events = input.events.filter((event) => appOfEvent(event) === appId);
    const latestEvent = events
.slice()
.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0];
    const latestContextAt = newest(blocks.map((block) => block.at));
    const latestEventAt = latestEvent?.occurredAt ?? null;
    const latest = newest([latestContextAt, latestEventAt]);
    const ageDays =
      latest && !Number.isNaN(nowMs)
        ? Math.max(0, Math.floor((nowMs - Date.parse(latest)) / DAY))
: null;

    let status: FreshnessStatus;
    let because: string;
    if (blocks.length === 0 && events.length === 0) {
      status = "missing";
      because = withheld.has(appId)
        ? `Nothing read. The room reported: ${withheld.get(appId)?.replace(/_/g, " ")}.`
: "This room contributed no context and no activity rows.";
    } else if (blocks.length === 0) {
      status = "partial";
      because = `${events.length} activity row${events.length === 1 ? "": "s"}, but nothing reached the context layer.`;
    } else if (ageDays !== null && ageDays > CURRENT_WINDOW_DAYS) {
      status = "partial";
      because = `Newest fact is ${ageDays} days old, past the ${CURRENT_WINDOW_DAYS}-day window.`;
    } else {
      status = "current";
      because = `${blocks.length} context block${blocks.length === 1 ? "": "s"} and ${events.length} activity row${events.length === 1 ? "": "s"} inside the ${CURRENT_WINDOW_DAYS}-day window.`;
    }

    return {
      appId,
      label: APP_LABEL[appId],
      status,
      blockCount: blocks.length,
      eventCount: events.length,
      latestContextAt,
      latestEventAt,
      ageDays,
      latestEventName: latestEvent?.name ?? null,
      because,
...(withheld.has(appId) ? { withheldReason: withheld.get(appId)! }: {}),
    };
  });

  return {
    generatedAt: nowIso,
    apps,
    current: apps.filter((app) => app.status === "current").length,
    partial: apps.filter((app) => app.status === "partial").length,
    missing: apps.filter((app) => app.status === "missing").length,
  };
}
