/**
 * Managing the daily attention list without losing the reason.
 *
 * "Worth your attention today" is derived, never stored. What a person decides
 * about it is theirs: snooze a relationship until a date, or mark it reviewed
 * for the rest of today. Neither decision changes the relationship, the move,
 * or its evidence, so when the entry comes back it comes back with its reason
 * intact.
 *
 * The state is a small, local preference. It is kept per organization in
 * localStorage rather than in the shared backend, because it is a view
 * decision, not business truth.
 */

import type { AttentionEntry } from "./comms-attention";

export interface AttentionState {
  /** relationship id -> ISO datetime the entry may reappear. */
  snoozedUntil: Record<string, string>;
  /** relationship id -> ISO datetime it was marked reviewed. */
  reviewedAt: Record<string, string>;
}

export const EMPTY_ATTENTION_STATE: AttentionState = { snoozedUntil: {}, reviewedAt: {} };

export const SNOOZE_CHOICES = [
  { id: "tomorrow", label: "Tomorrow", days: 1 },
  { id: "three_days", label: "In 3 days", days: 3 },
  { id: "next_week", label: "Next week", days: 7 },
] as const;

export type SnoozeChoice = (typeof SNOOZE_CHOICES)[number]["id"];

function startOfNextDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
}

export function snoozeUntil(choice: SnoozeChoice, now: Date = new Date()): Date {
  const days = SNOOZE_CHOICES.find((entry) => entry.id === choice)?.days ?? 1;
  const target = startOfNextDay(now);
  target.setDate(target.getDate() + (days - 1));
  return target;
}

export function snoozeRelationship(
  state: AttentionState,
  relationshipId: string,
  until: Date,
): AttentionState {
  return {
    reviewedAt: { ...state.reviewedAt },
    snoozedUntil: { ...state.snoozedUntil, [relationshipId]: until.toISOString() },
  };
}

export function markReviewed(
  state: AttentionState,
  relationshipId: string,
  at: Date = new Date(),
): AttentionState {
  return {
    snoozedUntil: { ...state.snoozedUntil },
    reviewedAt: { ...state.reviewedAt, [relationshipId]: at.toISOString() },
  };
}

/** Undo either decision, so an entry can be pulled back into today. */
export function clearAttentionDecision(
  state: AttentionState,
  relationshipId: string,
): AttentionState {
  const snoozedUntil = { ...state.snoozedUntil };
  const reviewedAt = { ...state.reviewedAt };
  delete snoozedUntil[relationshipId];
  delete reviewedAt[relationshipId];
  return { snoozedUntil, reviewedAt };
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export interface AttentionSplit {
  /** Entries still asking for attention today. */
  shown: AttentionEntry[];
  /** Entries a person set aside, with the decision that set them aside. */
  set_aside: { entry: AttentionEntry; because: string }[];
}

/**
 * Split today's list by what a person already decided. A snooze holds until its
 * date; "reviewed" holds only for the rest of the same day, so a real reason
 * returns tomorrow rather than disappearing.
 */
export function splitAttention(
  entries: AttentionEntry[],
  state: AttentionState,
  now: Date = new Date(),
): AttentionSplit {
  const shown: AttentionEntry[] = [];
  const set_aside: { entry: AttentionEntry; because: string }[] = [];

  for (const entry of entries) {
    const id = entry.relationship.id;
    const until = state.snoozedUntil[id];
    const reviewed = state.reviewedAt[id];

    if (until && Date.parse(until) > now.getTime()) {
      set_aside.push({
        entry,
        because: `Snoozed until ${new Date(until).toLocaleDateString()}`,
      });
      continue;
    }
    if (reviewed) {
      const at = new Date(reviewed);
      if (!Number.isNaN(at.getTime()) && sameDay(at, now)) {
        set_aside.push({ entry, because: "Reviewed today" });
        continue;
      }
    }
    shown.push(entry);
  }

  return { shown, set_aside };
}

/* ----------------------------------------------------------- persistence */

const KEY = "trust-tai:comms:attention";

function storageKey(organizationId: string): string {
  return `${KEY}:${organizationId}`;
}

export function loadAttentionState(organizationId: string): AttentionState {
  if (typeof window === "undefined") return EMPTY_ATTENTION_STATE;
  try {
    const raw = window.localStorage.getItem(storageKey(organizationId));
    if (!raw) return EMPTY_ATTENTION_STATE;
    const parsed = JSON.parse(raw) as Partial<AttentionState>;
    return {
      snoozedUntil: parsed.snoozedUntil ?? {},
      reviewedAt: parsed.reviewedAt ?? {},
    };
  } catch {
    return EMPTY_ATTENTION_STATE;
  }
}

export function saveAttentionState(organizationId: string, state: AttentionState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(organizationId), JSON.stringify(state));
  } catch {
    /* A full or blocked store is not a reason to break the room. */
  }
}
