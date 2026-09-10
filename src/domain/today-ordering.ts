/**
 * Trust Tai OS, the Today ordering law (P2-05).
 *
 * Home answers one question: are we on pace this week? Today sits above the
 * four This Week numbers and says what to do first. The order is fixed by the
 * charter and is not a score:
 *
 *   1. An existing obligation at risk. Something already promised to a person
 *      or a client is about to break, or has broken. Kept promises come first.
 *   2. A floor breach. The week is below the floor we agreed a good week has.
 *   3. A decision opportunity. Nothing is breaking; a decision would move
 *      something forward.
 *
 * Nothing here invents an item. Every entry is built from a real obligation,
 * a real recorded floor, or a real open decision. An absence produces no card,
 * never a zero card, and a source that could not be read is the caller's
 * problem to report honestly, not this module's to guess at.
 */

export type TodayKind = "obligation_at_risk" | "floor_breach" | "decision_opportunity";

/** The charter order. Index is the rank; lower comes first. */
export const TODAY_KIND_ORDER: TodayKind[] = [
  "obligation_at_risk",
  "floor_breach",
  "decision_opportunity",
];

export interface TodayCandidate {
  /** Stable identity so the list does not reshuffle between reads. */
  key: string;
  kind: TodayKind;
  /** The number a person reads. An item with nothing to count is dropped. */
  count: number;
  label: string;
  /** Room slug that owns the truth behind this item. */
  slug: string;
  /**
   * How overdue the obligation is, in whole days. Negative means it is not yet
   * due. Only meaningful for an obligation; ignored for the other two kinds.
   */
  overdueDays?: number;
}

export function todayRank(kind: TodayKind): number {
  return TODAY_KIND_ORDER.indexOf(kind);
}

/**
 * Order the day. Kind first, always. Inside one kind: the most overdue
 * obligation first, then the larger number, then the key, so the same input
 * always produces the same order.
 */
export function orderToday(candidates: TodayCandidate[]): TodayCandidate[] {
  return candidates
    .filter((item) => item.count > 0)
    .slice()
    .sort((a, b) => {
      const byKind = todayRank(a.kind) - todayRank(b.kind);
      if (byKind !== 0) return byKind;
      const byOverdue =
        (b.overdueDays ?? Number.NEGATIVE_INFINITY) - (a.overdueDays ?? Number.NEGATIVE_INFINITY);
      if (byOverdue !== 0 && Number.isFinite(byOverdue)) return byOverdue;
      if (b.count !== a.count) return b.count - a.count;
      return a.key.localeCompare(b.key);
    });
}

/**
 * A floor is breached when the week's real actual is below the low end of the
 * agreed range. Being inside or above the range is not a breach, and a floor
 * of zero can never be breached, because nothing was agreed.
 */
export function isFloorBreached(actual: number, floor: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(floor)) return false;
  if (floor <= 0) return false;
  return actual < floor;
}

export interface FloorReading {
  key: string;
  label: string;
  actual: number;
  floor: number;
  slug: string;
}

/** Turn real weekly readings into floor-breach candidates, shortfall counted. */
export function floorBreaches(readings: FloorReading[]): TodayCandidate[] {
  return readings
    .filter((reading) => isFloorBreached(reading.actual, reading.floor))
    .map((reading) => ({
      key: reading.key,
      kind: "floor_breach" as const,
      count: reading.floor - reading.actual,
      label: reading.label,
      slug: reading.slug,
    }));
}
