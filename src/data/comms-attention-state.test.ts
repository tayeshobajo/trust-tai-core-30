import { describe, expect, it } from "vitest";

import type { AttentionEntry } from "./comms-attention";
import {
  clearAttentionDecision,
  EMPTY_ATTENTION_STATE,
  markReviewed,
  snoozeRelationship,
  snoozeUntil,
  splitAttention,
} from "./comms-attention-state";

function entry(id: string): AttentionEntry {
  return {
    relationship: { id, fullName: `Person ${id}` },
    move: { action: "Follow up", whyNow: "A promise is open." },
  } as unknown as AttentionEntry;
}

const now = new Date("2026-02-10T12:00:00.000Z");

describe("attention decisions", () => {
  it("holds a snoozed relationship until its date, then lets it return", () => {
    const until = snoozeUntil("three_days", now);
    const state = snoozeRelationship(EMPTY_ATTENTION_STATE, "a", until);

    const held = splitAttention([entry("a")], state, now);
    expect(held.shown).toHaveLength(0);
    expect(held.set_aside[0]?.because).toContain("Snoozed until");

    const later = splitAttention([entry("a")], state, new Date("2026-02-20T12:00:00.000Z"));
    expect(later.shown).toHaveLength(1);
  });

  it("keeps a reviewed relationship aside for the day only", () => {
    const state = markReviewed(EMPTY_ATTENTION_STATE, "b", now);

    expect(splitAttention([entry("b")], state, now).set_aside[0]?.because).toBe("Reviewed today");
    expect(
      splitAttention([entry("b")], state, new Date("2026-02-11T08:00:00.000Z")).shown,
    ).toHaveLength(1);
  });

  it("brings an entry back when the decision is cleared", () => {
    const state = snoozeRelationship(EMPTY_ATTENTION_STATE, "c", snoozeUntil("next_week", now));
    const cleared = clearAttentionDecision(state, "c");
    expect(splitAttention([entry("c")], cleared, now).shown).toHaveLength(1);
  });

  it("leaves other relationships untouched", () => {
    const state = markReviewed(EMPTY_ATTENTION_STATE, "b", now);
    const split = splitAttention([entry("a"), entry("b")], state, now);
    expect(split.shown.map((item) => item.relationship.id)).toEqual(["a"]);
  });
});
