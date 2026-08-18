/**
 * Relationships worth your attention today.
 *
 * A small, honest list. Every entry rests on a real move produced by
 * `nextRelationshipMove`, so nothing appears here just because days passed.
 * If nobody needs Tai today, the list is empty and Comms says so.
 */

import type { Relationship } from "@/domain/comms";

import { nextRelationshipMove, type NextRelationshipMove } from "./comms-next-move";

export interface AttentionEntry {
  relationship: Relationship;
  move: NextRelationshipMove;
}

const RANK: Record<NextRelationshipMove["urgency"], number> = {
  now: 0,
  soon: 1,
  when_natural: 2,
  none: 3,
};

/** Ordered by urgency, then by how long the relationship has waited. */
export function relationshipsWorthAttention(
  relationships: Relationship[],
  now: Date = new Date(),
  limit = 5,
): AttentionEntry[] {
  return relationships
    .map((relationship) => ({ relationship, move: nextRelationshipMove(relationship, now) }))
    .filter((entry) => entry.move.needed && entry.move.urgency !== "when_natural")
    .sort((a, b) => {
      const rank = RANK[a.move.urgency] - RANK[b.move.urgency];
      if (rank !== 0) return rank;
      const lastA = Date.parse(a.relationship.lastTouchAt ?? a.relationship.createdAt);
      const lastB = Date.parse(b.relationship.lastTouchAt ?? b.relationship.createdAt);
      return lastA - lastB;
    })
    .slice(0, limit);
}
