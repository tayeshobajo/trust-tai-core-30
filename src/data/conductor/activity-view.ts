/**
 * The filtered activity view behind the Conductor rail.
 *
 * The rail states three small truths, what happened today, what is waiting on
 * a person, what has actually moved. Each one is a link, and this module is
 * what the link opens: the same truth, unabridged, read from the same sources
 * the rail counted. Nothing new is inferred here; the view only widens.
 */

import type { ActivityEvent } from "@/domain/activity";
import type { ControlledAction, ExecutionReceipt } from "@/domain/conductor-control";

import { recentlyMoved, roomLabel, type MovedItem } from "./page-projection";

export const ACTIVITY_VIEWS = ["today", "needs", "moved"] as const;
export type ActivityView = (typeof ACTIVITY_VIEWS)[number];

export const ACTIVITY_VIEW_LABEL: Record<ActivityView, string> = {
  today: "Today",
  needs: "Needs Tai",
  moved: "Recently moved",
};

/** A defensive read of the `view` search param: anything else means Today. */
export function readActivityView(search: Record<string, unknown>): ActivityView {
  const raw = search["view"];
  return ACTIVITY_VIEWS.includes(raw as ActivityView) ? (raw as ActivityView) : "today";
}

export const ACTIVITY_KINDS = ["all", "completed", "reordered", "reassigned", "other"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  all: "Everything",
  completed: "Completed",
  reordered: "Reordered",
  reassigned: "Reassigned",
  other: "Everything else",
};

/** A defensive read of the `kind` search param: anything else means all. */
export function readActivityKind(search: Record<string, unknown>): ActivityKind {
  const raw = search["kind"];
  return ACTIVITY_KINDS.includes(raw as ActivityKind) ? (raw as ActivityKind) : "all";
}

/** A defensive read of the free-text `q` search param. */
export function readActivityQuery(search: Record<string, unknown>): string {
  const raw = search["q"];
  return typeof raw === "string" ? raw.slice(0, 120) : "";
}

/**
 * What kind of work an event describes, said in the words a person uses when
 * looking for it later. Reordering and reassignment are both recorded as
 * updates or assignments, so the summary decides between them.
 */
export function activityKind(name: string, summary: string): ActivityKind {
  const said = summary.toLowerCase();
  if (name.endsWith(".completed") || said.includes("completed")) return "completed";
  if (name.endsWith(".assigned") || said.includes("now carried by") || said.includes("sent to"))
    return "reassigned";
  if (said.includes("moved above") || said.includes("above ") || said.includes("priority"))
    return "reordered";
  return "other";
}

/** Free text and kind, applied to any of the three readings. */
export function filterActivity(
  rows: ActivityRow[],
  input: { query?: string; kind?: ActivityKind },
): ActivityRow[] {
  const needle = (input.query ?? "").trim().toLowerCase();
  const kind = input.kind ?? "all";
  return rows.filter((row) => {
    if (kind !== "all" && row.kind !== kind) return false;
    if (!needle) return true;
    return `${row.label} ${row.roomLabel} ${row.standing}`.toLowerCase().includes(needle);
  });
}

/** How many rows a single page of activity shows. */
export const ACTIVITY_PAGE_SIZE = 25;

/** A defensive read of the `page` search param: anything else means page 1. */
export function readActivityPage(search: Record<string, unknown>): number {
  const raw = search["page"];
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

export interface ActivityPage {
  rows: ActivityRow[];
  page: number;
  pageCount: number;
  total: number;
  hasMore: boolean;
}

/**
 * Cumulative paging: page N shows the first N * size rows, so "Show more"
 * grows the same list and the URL still restores exactly what was shared.
 */
export function pageActivity(rows: ActivityRow[], page: number): ActivityPage {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, Math.floor(page)), pageCount);
  const shown = rows.slice(0, safePage * ACTIVITY_PAGE_SIZE);
  return {
    rows: shown,
    page: safePage,
    pageCount,
    total,
    hasMore: shown.length < total,
  };
}

export interface ActivityRow {
  id: string;
  label: string;
  roomLabel: string;
  /** Said plainly, in the person's language: "handed over", "awaiting you". */
  standing: string;
  /** What sort of change this was, for filtering. */
  kind: ActivityKind;
  at: string | null;
  route?: string;
}

/** Same calendar day as `now`, in the reader's own timezone. */
function sameDay(iso: string, now: Date): boolean {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return false;
  return (
    when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() &&
    when.getDate() === now.getDate()
  );
}

/** Everything the suite recorded today, newest first. */
export function todaysActivity(events: ActivityEvent[], now: Date): ActivityRow[] {
  return events
    .filter((event) => sameDay(event.occurredAt, now))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .map((event) => ({
      id: event.id,
      label: event.summary || event.subject.label || event.subject.id,
      roomLabel: roomLabel(event.provenance.appId),
      standing: "recorded",
      kind: activityKind(event.name, event.summary ?? ""),
      at: event.occurredAt,
    }));
}

/**
 * Only bounded steps a person has not yet settled. Work already approved or
 * routed is not waiting on anyone and is deliberately absent.
 */
export function awaitingJudgment(actions: ControlledAction[]): ActivityRow[] {
  return actions
    .filter((action) => action.status === "proposed" && action.requiresApproval)
    .map((action) => ({
      id: action.id,
      label: action.intent,
      roomLabel: roomLabel(action.owningApp),
      standing: "awaiting your authorisation",
      kind: activityKind("", action.intent ?? ""),
      at: action.createdAt ?? null,
      route: action.route,
    }));
}

/** Every recorded movement, not just the last few the rail had room for. */
export function movements(input: {
  receipts: ExecutionReceipt[];
  actions: ControlledAction[];
}): ActivityRow[] {
  const rows: MovedItem[] = recentlyMoved({ ...input, limit: input.receipts.length });
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    roomLabel: row.roomLabel,
    standing: row.outcome,
    kind: activityKind("", row.label ?? ""),
    at: row.at,
  }));
}
