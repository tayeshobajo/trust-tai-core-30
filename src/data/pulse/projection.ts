/**
 * Signal → PulseSignal.
 *
 * Pure, deterministic presentation logic. No model judgment, no new business
 * state: every attention level, impact and action label below comes from a
 * written rule over what `deriveSignals` already read from the suite.
 */

import type { EvidenceRef } from "@/domain/confidence";
import type { ID } from "@/domain/entities";
import {
  NOT_NOW_DAYS,
  NOT_USEFUL_THRESHOLD,
  PULSE_SEVERITY_ORDER,
  signalKindOf,
  type PulseArea,
  type PulseFeedback,
  type PulseImpactLevel,
  type PulseSeverity,
  type PulseSignal,
} from "@/domain/pulse";
import type { RouteLedgerEntry } from "@/domain/route-ledger";
import { routeStanding } from "@/domain/route-ledger";
import { ROUTE_TARGET_LABEL } from "@/domain/project-routing";
import type { Signal, SignalCategory } from "@/domain/signals";

const DAY = 86_400_000;

export const PULSE_ROOM_LABEL: Record<string, string> = {
  scout: "Scout",
  comms: "Comms",
  roadmap: "Roadmap",
  projects: "Projects",
  studio: "Studio",
  ops: "Ops",
  steward: "Steward",
  conductor: "Conductor",
  activity: "Activity",
  website: "Website",
};

/** The room's own verb for each attention level. Never a generic button. */
const ACTION_LABEL: Record<string, Partial<Record<PulseSeverity, string>> & { default: string }> = {
  projects: { act_now: "Resolve blocker", evaluate: "Review", default: "Review" },
  comms: { act_now: "Reply", evaluate: "Assign", watch_closely: "Monitor", default: "Open" },
  roadmap: { act_now: "Decide", evaluate: "Decide", watch_closely: "Monitor", default: "Review" },
  scout: {
    act_now: "Review company",
    evaluate: "Assign",
    watch_closely: "Monitor",
    default: "View",
  },
  ops: { act_now: "Open issue", evaluate: "Review incident", default: "Open issue" },
  steward: { act_now: "Follow up", evaluate: "Decide", default: "Open" },
  studio: { default: "Open" },
  website: {
    act_now: "Open the submission",
    evaluate: "Open the submission",
    default: "Open the submission",
  },
  conductor: { default: "Open" },
};

const AREA_OF: Record<SignalCategory, PulseArea> = {
  client_stewardship: "stewardship",
  pipeline: "opportunities",
  delivery: "delivery",
  relationship: "outreach",
  pattern: "outreach",
  growth: "opportunities",
  technical_risk: "delivery",
  stewardship: "stewardship",
};

/** Categories where the work is a person's judgment rather than execution. */
const JUDGMENT_CATEGORIES: SignalCategory[] = [
  "pipeline",
  "client_stewardship",
  "pattern",
  "stewardship",
];

export function daysBetween(at: string, now: string): number {
  const a = new Date(at).getTime();
  const b = new Date(now).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / DAY));
}

/**
 * Attention level. Written rules only:
 *  - growth and anything quiet is information,
 *  - urgent execution or an overdue promise is Act now,
 *  - open judgment is Evaluate,
 *  - everything still moving is watched.
 */
export function severityOf(signal: Signal): PulseSeverity {
  if (signal.category === "growth") return "good_to_know";
  if (signal.urgency >= 85) return "act_now";
  if (signal.urgency >= 60) {
    return JUDGMENT_CATEGORIES.includes(signal.category) ? "evaluate" : "act_now";
  }
  if (signal.urgency >= 55 && JUDGMENT_CATEGORIES.includes(signal.category)) return "evaluate";
  if (signal.urgency >= 35) return "watch_closely";
  return "good_to_know";
}

export function impactOf(signal: Signal): PulseImpactLevel {
  if (signal.urgency >= 80) return "high";
  if (signal.urgency >= 50) return "medium";
  return "low";
}

function actionLabelOf(appId: string, severity: PulseSeverity): string {
  const room = ACTION_LABEL[appId];
  if (!room) return "Open";
  return room[severity] ?? room.default;
}

function reasonOf(signal: Signal, ageDays: number, room: string): string {
  const age =
    ageDays <= 0 ? "It was read just now" : `It has stood for ${ageDays} day${ageDays === 1 ? "" : "s"}`;
  return `${signal.why} ${age}, and ${room} owns the change.`;
}

export interface PulseProjectionInput {
  organizationId: ID;
  now: string;
  signals: Signal[];
  /** Routed work nobody answered. Read only; Projects still owns it. */
  routes?: RouteLedgerEntry[];
  feedback?: PulseFeedback[];
}

/** Signals a person parked, and rule families they told Pulse were not useful. */
export function suppression(feedback: PulseFeedback[], now: string) {
  const parked = new Set<ID>();
  const dismissed = new Map<string, number>();
  for (const item of feedback) {
    if (item.kind === "not_now" && daysBetween(item.at, now) < NOT_NOW_DAYS) {
      parked.add(item.signalId);
    }
    if (item.kind === "not_useful") {
      dismissed.set(item.signalKind, (dismissed.get(item.signalKind) ?? 0) + 1);
    }
  }
  const quiet = new Set<string>();
  for (const [kind, count] of dismissed) {
    if (count >= NOT_USEFUL_THRESHOLD) quiet.add(kind);
  }
  return { parked, quiet };
}

function routeSignals(input: PulseProjectionInput): PulseSignal[] {
  const routes = input.routes ?? [];
  return routes.map((entry) => {
    const evidence: EvidenceRef[] = [
      ...entry.evidence,
      { label: `Requested of ${ROUTE_TARGET_LABEL[entry.targetApp]}`, kind: "computed" },
    ];
    const severity: PulseSeverity = entry.ageDays >= 3 ? "act_now" : "watch_closely";
    return {
      id: `route:${entry.key}`,
      organizationId: input.organizationId,
      severity,
      category: "delivery" as SignalCategory,
      area: "delivery" as PulseArea,
      title: `Routed work is unanswered after ${entry.ageDays} day${entry.ageDays === 1 ? "" : "s"}`,
      summary: entry.requestedOutcome,
      reason: routeStanding(entry),
      sourceApp: "projects",
      sourceAppLabel: "Projects",
      entityPath: `${entry.projectName} › ${ROUTE_TARGET_LABEL[entry.targetApp]}`,
      impact: (entry.ageDays >= 3 ? "high" : "medium") as PulseImpactLevel,
      ageDays: entry.ageDays,
      actionLabel: severity === "act_now" ? "Chase or withdraw" : "Review",
      actionRoute: `/modules/projects/${entry.projectId}`,
      evidence,
      confidence: "high" as const,
      at: entry.requestedAt,
    } satisfies PulseSignal;
  });
}

export function toPulseSignals(input: PulseProjectionInput): PulseSignal[] {
  const { parked, quiet } = suppression(input.feedback ?? [], input.now);

  const mapped = input.signals.map((signal) => {
    const room = PULSE_ROOM_LABEL[signal.destination.appId] ?? signal.destination.appId;
    const ageDays = daysBetween(signal.at, input.now);
    let severity = severityOf(signal);
    const kind = signalKindOf(signal.id);
    if (parked.has(signal.id) || quiet.has(kind)) severity = "good_to_know";

    const projected: PulseSignal = {
      id: signal.id,
      organizationId: input.organizationId,
      severity,
      category: signal.category,
      area: AREA_OF[signal.category] ?? "delivery",
      title: signal.title,
      summary: signal.why,
      reason: reasonOf(signal, ageDays, room),
      sourceApp: signal.destination.appId,
      sourceAppLabel: room,
      entityPath: signal.subject?.label ?? room,
      impact: impactOf(signal),
      ageDays,
      actionLabel: actionLabelOf(signal.destination.appId, severity),
      actionRoute: signal.destination.route,
      evidence: signal.evidence,
      confidence: signal.confidence,
      at: signal.at,
    };
    return signal.subject ? { ...projected, subject: signal.subject } : projected;
  });

  const all = [...mapped, ...routeSignals(input)];
  const rank = (severity: PulseSeverity) => PULSE_SEVERITY_ORDER.indexOf(severity);
  const impactRank = { high: 0, medium: 1, low: 2 } as const;

  return all.sort(
    (a, b) =>
      rank(a.severity) - rank(b.severity) ||
      impactRank[a.impact] - impactRank[b.impact] ||
      b.ageDays - a.ageDays ||
      a.title.localeCompare(b.title),
  );
}

/* ---------------------------------------------------------------- grouping */

export interface PulseGroup {
  severity: PulseSeverity;
  signals: PulseSignal[];
}

export function groupSignals(signals: PulseSignal[]): PulseGroup[] {
  return PULSE_SEVERITY_ORDER.map((severity) => ({
    severity,
    signals: signals.filter((signal) => signal.severity === severity),
  })).filter((group) => group.signals.length > 0);
}

export type PulseCounts = Record<PulseSeverity, number> & { total: number };

export function countSignals(signals: PulseSignal[]): PulseCounts {
  const counts = {
    act_now: 0,
    evaluate: 0,
    watch_closely: 0,
    good_to_know: 0,
    total: signals.length,
  } satisfies PulseCounts;
  for (const signal of signals) counts[signal.severity] += 1;
  return counts;
}

export interface PulseAreaCount {
  area: PulseArea;
  count: number;
}

export function topAreas(signals: PulseSignal[], limit = 4): PulseAreaCount[] {
  const tally = new Map<PulseArea, number>();
  for (const signal of signals) tally.set(signal.area, (tally.get(signal.area) ?? 0) + 1);
  return [...tally.entries()]
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => b.count - a.count || a.area.localeCompare(b.area))
    .slice(0, limit);
}

export interface PulseTrend {
  /** High-impact signals that appeared in the last seven days. */
  delta: number;
  direction: "up" | "down" | "flat";
  meaning: string;
}

/**
 * One trend, stated in full. High-impact means Act now or Evaluate: the two
 * levels that cost a person something.
 */
export function weeklyTrend(signals: PulseSignal[], now: string): PulseTrend {
  const highImpact = signals.filter(
    (signal) => signal.severity === "act_now" || signal.severity === "evaluate",
  );
  const fresh = highImpact.filter((signal) => daysBetween(signal.at, now) < 7).length;
  return {
    delta: fresh,
    direction: fresh > 0 ? "up" : "flat",
    meaning:
      fresh > 0
        ? `${fresh} high-impact signal${fresh === 1 ? "" : "s"} appeared in the last 7 days.`
        : "No new high-impact signals in the last 7 days.",
  };
}

export interface PulseRecentItem {
  signal: PulseSignal;
  /** "23m ago", "1h ago", "3d ago". */
  ago: string;
}

export function relativeAge(at: string, now: string): string {
  const minutes = Math.max(
    0,
    Math.floor((new Date(now).getTime() - new Date(at).getTime()) / 60_000),
  );
  if (!Number.isFinite(minutes)) return "just now";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function recentlyUpdated(
  signals: PulseSignal[],
  now: string,
  limit = 3,
): PulseRecentItem[] {
  return [...signals]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit)
    .map((signal) => ({ signal, ago: relativeAge(signal.at, now) }));
}
