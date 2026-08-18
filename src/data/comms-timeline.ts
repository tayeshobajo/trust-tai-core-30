/**
 * One thread, in order.
 *
 * The room shows a single chronological conversation: what they wrote, what we
 * wrote, meeting notes, internal notes, and drafts that were prepared. Nothing
 * is invented here, every entry is a record that already exists.
 *
 * Future providers (a Comms driver preparing a draft, a follow-up recommended
 * by Steward) fold into the same `system` kind without a redesign.
 */

import type { CommsDraft, Touch } from "@/domain/comms";
import type { ISODateTime } from "@/domain/entities";

export type ConversationEventKind =
  | "they_wrote"
  | "we_wrote"
  | "meeting"
  | "note"
  | "draft"
  | "system";

export const EVENT_LABEL: Record<ConversationEventKind, string> = {
  they_wrote: "They wrote",
  we_wrote: "We wrote",
  meeting: "Meeting note",
  note: "Internal note",
  draft: "Draft",
  system: "Signal",
};

export interface ConversationEvent {
  id: string;
  kind: ConversationEventKind;
  occurredAt: ISODateTime;
  title: string;
  body?: string;
  /** Where this came from, in plain words. Never a vendor id. */
  source?: string;
  meta?: string;
}

function kindOf(touch: Touch): ConversationEventKind {
  if (touch.channel === "meeting" || touch.channel === "call") return "meeting";
  if (touch.channel === "note") return "note";
  return touch.direction === "inbound" ? "they_wrote" : "we_wrote";
}

/** Touches and drafts as one ordered thread, oldest first. */
export function conversationTimeline(
  touches: Touch[],
  drafts: CommsDraft[] = [],
): ConversationEvent[] {
  const events: ConversationEvent[] = [];

  for (const touch of touches) {
    events.push({
      id: `touch:${touch.id}`,
      kind: kindOf(touch),
      occurredAt: touch.occurredAt,
      title: touch.summary,
      ...(touch.body ? { body: touch.body } : {}),
      meta: touch.channel,
    });
  }

  for (const draft of drafts) {
    if (draft.reviewState === "discarded") continue;
    events.push({
      id: `draft:${draft.id}`,
      kind: "draft",
      occurredAt: draft.createdAt,
      title: draft.subject?.trim() || draft.intent || "Draft prepared",
      body: draft.body,
      source: "Prepared in Comms, not sent",
      meta: draft.reviewState,
    });
  }

  return events.sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );
}

export interface ConversationDay {
  key: string;
  label: string;
  events: ConversationEvent[];
}

function dayLabel(date: Date, now: Date): string {
  const day = 86_400_000;
  const startOf = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(date)) / day);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** The same thread, split by day so it reads like a conversation. */
export function groupByDay(
  events: ConversationEvent[],
  now: Date = new Date(),
): ConversationDay[] {
  const days = new Map<string, ConversationEvent[]>();
  for (const event of events) {
    const date = new Date(event.occurredAt);
    const key = Number.isNaN(date.getTime())
      ? "unknown"
      : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const list = days.get(key) ?? [];
    list.push(event);
    days.set(key, list);
  }

  return [...days.entries()].map(([key, list]) => ({
    key,
    label: key === "unknown" ? "Undated" : dayLabel(new Date(list[0]!.occurredAt), now),
    events: list,
  }));
}
