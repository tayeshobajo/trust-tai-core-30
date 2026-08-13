/**
 * The relationship queue: bucketing and coverage.
 *
 * Pure and deterministic. The Comms Lead's whole job is answered here — what
 * is late, what is waiting, and what nobody is carrying.
 */

import {
  dueState,
  isActive,
  type DueState,
  type Relationship,
  type RelationshipSource,
} from "@/domain/comms";

export type QueueBucket =
  | "needs_you"
  | "waiting_on_them"
  | "new_from_scout"
  | "met_in_person"
  | "warm"
  | "quiet";

export const BUCKET_LABEL: Record<QueueBucket, string> = {
  needs_you: "Needs you",
  waiting_on_them: "Waiting on them",
  new_from_scout: "New from Scout",
  met_in_person: "Met in person",
  warm: "Warm",
  quiet: "Gone quiet",
};

export const BUCKET_ORDER: QueueBucket[] = [
  "needs_you",
  "new_from_scout",
  "met_in_person",
  "waiting_on_them",
  "warm",
  "quiet",
];

const NEEDS_YOU: DueState[] = ["overdue", "today"];

/** One relationship belongs to exactly one bucket. Urgency wins. */
export function bucketFor(relationship: Relationship, now: Date = new Date()): QueueBucket {
  const due = dueState(relationship, now);
  if (NEEDS_YOU.includes(due)) return "needs_you";
  if (relationship.stage === "new" && relationship.source === "scout_handoff") {
    return "new_from_scout";
  }
  if (relationship.stage === "new" && relationship.source === "in_person") return "met_in_person";
  if (due === "dormant") return "quiet";
  if (relationship.responseDueAt || relationship.followUpDueAt) return "waiting_on_them";
  return "warm";
}

export interface QueueGroup {
  bucket: QueueBucket;
  label: string;
  relationships: Relationship[];
}

const DUE_WEIGHT: Record<DueState, number> = {
  overdue: 0,
  today: 1,
  this_week: 2,
  dormant: 3,
  clear: 4,
};

/** Most pressing first, then longest since we last spoke. */
export function sortQueue(relationships: Relationship[], now: Date = new Date()): Relationship[] {
  return [...relationships].sort((a, b) => {
    const weight = DUE_WEIGHT[dueState(a, now)] - DUE_WEIGHT[dueState(b, now)];
    if (weight !== 0) return weight;
    const at = new Date(a.lastTouchAt ?? a.createdAt).getTime();
    const bt = new Date(b.lastTouchAt ?? b.createdAt).getTime();
    return at - bt;
  });
}

export function groupQueue(relationships: Relationship[], now: Date = new Date()): QueueGroup[] {
  const groups = new Map<QueueBucket, Relationship[]>();
  for (const relationship of relationships) {
    if (relationship.stage === "archived") continue;
    const bucket = bucketFor(relationship, now);
    const list = groups.get(bucket) ?? [];
    list.push(relationship);
    groups.set(bucket, list);
  }

  return BUCKET_ORDER.filter((bucket) => (groups.get(bucket) ?? []).length > 0).map((bucket) => ({
    bucket,
    label: BUCKET_LABEL[bucket],
    relationships: sortQueue(groups.get(bucket) ?? [], now),
  }));
}

/** What the Comms Lead needs in one glance. Truth, not a scoreboard. */
export interface CoverageRead {
  total: number;
  overdue: number;
  dueToday: number;
  unowned: number;
  withoutNextMove: number;
  quiet: number;
}

export function coverage(relationships: Relationship[], now: Date = new Date()): CoverageRead {
  const live = relationships.filter((entry) => entry.stage !== "archived");
  let overdue = 0;
  let dueToday = 0;
  let quiet = 0;
  let unowned = 0;
  let withoutNextMove = 0;

  for (const relationship of live) {
    const due = dueState(relationship, now);
    if (due === "overdue") overdue += 1;
    if (due === "today") dueToday += 1;
    if (due === "dormant") quiet += 1;
    if (!relationship.ownerUserId) unowned += 1;
    if (isActive(relationship) && !relationship.nextAction?.trim()) withoutNextMove += 1;
  }

  return { total: live.length, overdue, dueToday, unowned, withoutNextMove, quiet };
}

export function matchesSearch(relationship: Relationship, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    relationship.fullName,
    relationship.companyName,
    relationship.email,
    relationship.metWhere,
    relationship.nextAction,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(needle));
}

export const SOURCE_FILTERS: (RelationshipSource | "all")[] = [
  "all",
  "scout_handoff",
  "in_person",
  "inbound",
  "manual",
];
