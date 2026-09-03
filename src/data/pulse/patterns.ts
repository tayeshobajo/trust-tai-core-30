/**
 * Pattern labels on Pulse signals.
 *
 * Pulse stays a room of actionable signals. The canon is allowed to put one
 * short phrase on a signal that already exists, and nothing else: no pattern
 * cards, no second feed, no reordering by hunch. A label appears only when a
 * match clears the evidence threshold, nothing contradicts it, and a signal
 * from the owning room is already on screen.
 */

import type { PatternMatch } from "@/domain/intelligence-canon";
import type { PulseSignal } from "@/domain/pulse";

import { conciseLabel, describeMatch } from "@/data/intelligence/canon";

/** The room a match would send a person to, when it has one. */
function owningApp(match: PatternMatch): string | undefined {
  return match.possibleNextMoves[0]?.appId;
}

/**
 * At most one label per room, best match first. Signals are returned in the
 * same order they arrived: enrichment never changes what Pulse decided to show.
 *
 * A labelled signal also carries references back to the reading, so a person
 * who acts on it can open a case. Carrying those references records nothing.
 */
export function labelSignalsWithPatterns(
  signals: PulseSignal[],
  matches: PatternMatch[],
): PulseSignal[] {
  const byRoom = new Map<string, PatternMatch>();
  for (const match of [...matches].sort((a, b) => b.score - a.score)) {
    if (conciseLabel(match) === null) continue;
    const app = owningApp(match);
    if (!app || byRoom.has(app)) continue;
    byRoom.set(app, match);
  }
  if (byRoom.size === 0) return signals;

  const used = new Set<string>();
  return signals.map((signal) => {
    const match = byRoom.get(signal.sourceApp);
    if (!match || used.has(signal.sourceApp)) return signal;
    used.add(signal.sourceApp);
    const label = conciseLabel(match);
    if (!label) return signal;
    return {
      ...signal,
      patternLabel: label,
      patternRead: {
        patternId: match.patternId,
        patternVersion: 1,
        hypothesis: describeMatch(match),
        observationIds: match.matched.map((entry) => entry.observationId),
      },
    };
  });
}
