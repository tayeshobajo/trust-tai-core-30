/**
 * One relationship, in order.
 *
 * The middle column is the relationship's source of truth: what they wrote,
 * what we wrote, texts either way, calls, meetings, notes, suggestions Comms
 * made, and drafts that were never sent. Nothing is invented here, every entry
 * is a record that already exists.
 *
 * Every event carries provenance when it matters, so a line Tai typed himself
 * never reads as something an integration observed.
 */

import type { CommsDraft, Touch } from "@/domain/comms";
import type { StoredMailboxMessage } from "@/domain/comms-integrations";
import { readTouchRecord, recordNote } from "@/domain/comms-touch-record";
import { draftProvenanceLabel, readDraftVerification } from "@/domain/comms-verification";
import type { ISODateTime } from "@/domain/entities";

export type ConversationEventKind =
  | "we_emailed"
  | "they_emailed"
  | "they_texted"
  | "i_texted"
  | "phone_call"
  | "meeting"
  | "note"
  | "suggestion"
  | "draft";

export const EVENT_LABEL: Record<ConversationEventKind, string> = {
  we_emailed: "We emailed",
  they_emailed: "They emailed",
  they_texted: "They texted",
  i_texted: "I texted",
  phone_call: "Phone call",
  meeting: "Meeting",
  note: "Note",
  suggestion: "Comms suggestion",
  draft: "Draft, not sent",
};

/** Which side of the thread an event sits on. */
export function eventSide(kind: ConversationEventKind): "them" | "us" | "center" {
  if (kind === "they_emailed" || kind === "they_texted") return "them";
  if (kind === "we_emailed" || kind === "i_texted" || kind === "draft") return "us";
  return "center";
}

export interface ConversationEvent {
  id: string;
  kind: ConversationEventKind;
  occurredAt: ISODateTime;
  title: string;
  body?: string;
  /** Where this came from, in plain words. Never a vendor id. */
  source?: string;
  meta?: string;
  /** Set when this event is an interaction that can be corrected. */
  touchId?: string;
  /** Withdrawn entries stay visible, marked, never deleted. */
  retracted?: boolean;
}

export function kindOfTouch(touch: Touch): ConversationEventKind {
  switch (touch.channel) {
    case "call":
      return "phone_call";
    case "meeting":
      return "meeting";
    case "note":
      return "note";
    case "text":
      return touch.direction === "inbound" ? "they_texted" : "i_texted";
    case "email":
      return touch.direction === "inbound" ? "they_emailed" : "we_emailed";
    default:
      return touch.direction === "inbound" ? "they_texted" : "i_texted";
  }
}

/**
 * Touches, synced mailbox messages, and drafts as one ordered thread, oldest
 * first. A synced message is its own record — it is never copied into a touch
 * — and says so in plain words, so a line an integration observed never reads
 * as something a person typed.
 */
export function conversationTimeline(
  touches: Touch[],
  drafts: CommsDraft[] = [],
  messages: StoredMailboxMessage[] = [],
): ConversationEvent[] {
  const events: ConversationEvent[] = [];

  for (const touch of touches) {
    const record = readTouchRecord(touch.provenance);
    const note = recordNote(record);
    events.push({
      id: `touch:${touch.id}`,
      touchId: touch.id,
      kind: kindOfTouch(touch),
      occurredAt: touch.occurredAt,
      title: touch.summary,
      ...(touch.body ? { body: touch.body } : {}),
      ...(note ? { source: note } : {}),
      ...(record.retracted ? { retracted: true } : {}),
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
