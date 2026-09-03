/**
 * The Comms plan.
 *
 * One honest answer to "what happens next with this person?", built only
 * from things a human already recorded: a meeting that is set, a promise that
 * is open, a reply that is owed, a follow-up someone dated.
 *
 * Nothing here is invented. A person with nothing outstanding simply has no
 * plan items, and the calendar for that day stays empty.
 */

import type { Relationship } from "./comms";
import { commitmentsOf } from "./comms-interactions";
import type { ID, ISODateTime } from "./entities";

export type PlanKind = "meeting" | "follow_up" | "reply_due" | "commitment" | "next_action";

export const PLAN_KIND_LABEL: Record<PlanKind, string> = {
  meeting: "Meeting",
  follow_up: "Follow-up",
  reply_due: "Reply owed",
  commitment: "Promise",
  next_action: "Next step",
};

export interface PlanItem {
  id: string;
  kind: PlanKind;
  relationshipId: ID;
  personName: string;
  companyName: string | null;
  prospectId: ID | null;
  /** What happens, in plain words. */
  title: string;
  /** Why it is on the plan. Always rests on something recorded. */
  reason: string;
  dueAt: ISODateTime | null;
  overdue: boolean;
}

export interface PersonPlan {
  relationship: Relationship;
  items: PlanItem[];
  /** The soonest dated item, if this person has one. */
  nextAt: ISODateTime | null;
  overdueCount: number;
}

function time(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const at = new Date(value).getTime();
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
}

function isPast(value: string | null | undefined, now: Date): boolean {
  if (!value) return false;
  const at = new Date(value).getTime();
  return !Number.isNaN(at) && at < now.getTime();
}

function looksLikeMeeting(text: string): boolean {
  return /meeting|call|intro|demo|coffee|zoom|catch ?up|session/i.test(text);
}

/** Every plan item this person genuinely has, soonest first. */
export function planItemsFor(relationship: Relationship, now: Date = new Date()): PlanItem[] {
  if (relationship.stage === "archived") return [];

  const base = {
    relationshipId: relationship.id,
    personName: relationship.fullName,
    companyName: relationship.companyName ?? null,
    prospectId: relationship.prospectId ?? null,
  };
  const items: PlanItem[] = [];

  // Meetings and promises live in the relationship's own memory.
  for (const commitment of commitmentsOf(relationship)) {
    if (commitment.status !== "open") continue;
    const meeting = looksLikeMeeting(commitment.text);
    items.push({
      ...base,
      id: `${relationship.id}:commitment:${commitment.text.slice(0, 40)}`,
      kind: meeting ? "meeting" : "commitment",
      title: commitment.text,
      reason:
        commitment.owner === "them"
          ? "They said they would do this."
          : "You said you would do this.",
      dueAt: commitment.due ?? null,
      overdue: isPast(commitment.due ?? null, now),
    });
  }

  if (relationship.stage === "meeting_set" && !items.some((item) => item.kind === "meeting")) {
    items.push({
      ...base,
      id: `${relationship.id}:meeting-set`,
      kind: "meeting",
      title: `Meeting set with ${relationship.fullName}`,
      reason: "Someone moved this relationship to Meeting set.",
      dueAt: relationship.followUpDueAt ?? null,
      overdue: false,
    });
  }

  if (relationship.responseDueAt) {
    items.push({
      ...base,
      id: `${relationship.id}:reply`,
      kind: "reply_due",
      title: `Reply to ${relationship.fullName}`,
      reason: "A reply is owed on this conversation.",
      dueAt: relationship.responseDueAt,
      overdue: isPast(relationship.responseDueAt, now),
    });
  }

  if (relationship.followUpDueAt) {
    items.push({
      ...base,
      id: `${relationship.id}:follow-up`,
      kind: "follow_up",
      title: relationship.nextAction?.trim() || `Follow up with ${relationship.fullName}`,
      reason: "A person put this date on the calendar.",
      dueAt: relationship.followUpDueAt,
      overdue: isPast(relationship.followUpDueAt, now),
    });
  } else if (relationship.nextAction?.trim()) {
    items.push({
      ...base,
      id: `${relationship.id}:next-action`,
      kind: "next_action",
      title: relationship.nextAction.trim(),
      reason: "Recorded as the next step for this person.",
      dueAt: null,
      overdue: false,
    });
  }

  return items.sort((a, b) => time(a.dueAt) - time(b.dueAt));
}

/** One plan per person, people with the soonest work first. */
export function buildPlan(relationships: Relationship[], now: Date = new Date()): PersonPlan[] {
  return relationships
    .map((relationship) => {
      const items = planItemsFor(relationship, now);
      return {
        relationship,
        items,
        nextAt: items.find((item) => item.dueAt)?.dueAt ?? null,
        overdueCount: items.filter((item) => item.overdue).length,
      } satisfies PersonPlan;
    })
    .filter((plan) => plan.items.length > 0)
    .sort((a, b) => {
      if (a.overdueCount !== b.overdueCount) return b.overdueCount - a.overdueCount;
      return time(a.nextAt) - time(b.nextAt);
    });
}

export type PlanScope = "all" | "overdue" | "week" | "meetings";

export const PLAN_SCOPE_LABEL: Record<PlanScope, string> = {
  all: "Everything",
  overdue: "Overdue",
  week: "Next 7 days",
  meetings: "Meetings",
};

export const PLAN_SCOPES: PlanScope[] = ["all", "overdue", "week", "meetings"];

export function inScope(item: PlanItem, scope: PlanScope, now: Date = new Date()): boolean {
  if (scope === "all") return true;
  if (scope === "overdue") return item.overdue;
  if (scope === "meetings") return item.kind === "meeting";
  if (!item.dueAt) return false;
  const at = new Date(item.dueAt).getTime();
  if (Number.isNaN(at)) return false;
  return at <= now.getTime() + 7 * 24 * 60 * 60 * 1000;
}

/* ---------------------------------------------------------------- calendar */

export function dayKey(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Six weeks of days covering the month, Sunday first, for a calm grid. */
export function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

/** Dated plan items bucketed by calendar day. Undated work never appears. */
export function itemsByDay(plans: PersonPlan[]): Record<string, PlanItem[]> {
  const buckets: Record<string, PlanItem[]> = {};
  for (const plan of plans) {
    for (const item of plan.items) {
      if (!item.dueAt) continue;
      const key = dayKey(item.dueAt);
      if (!key) continue;
      (buckets[key] ??= []).push(item);
    }
  }
  return buckets;
}

export function dueLabel(value: string | null, now: Date = new Date()): string {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  const days = Math.round((date.getTime() - now.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < 0) return `${Math.abs(days)} days ago`;
  if (days < 7) return `In ${days} days`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
