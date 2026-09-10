/**
 * Trust Tai OS, the shared weekly operating snapshot.
 *
 * There is exactly one composition path from the canonical weekly truth to a
 * read surface. `readWeeklyScoreboard()` already owns the week itself: the
 * organization's own business week, the locked revenue law, and the unknown
 * vs zero semantics per source. This module does not replace any of that and
 * does not add a second source of truth. It is the thin, deterministic
 * composition every downstream room (Home today, Pulse when it is ready)
 * calls instead of each assembling its own inputs.
 *
 * Laws this module keeps:
 *
 *   * It writes nothing. There is no stored dashboard snapshot anywhere.
 *   * It owns no truth. Clients, Projects and Comms remain the owners; this
 *     is a read-only projection of what the scoreboard already read.
 *   * It is model-free and deterministic: given the same board it returns
 *     the same snapshot, every time.
 *   * A source that could not be read stays unknown and carries its reason.
 *     A source that was read and was empty stays a real zero.
 *   * Two rooms calling it for the same organization and week see identical
 *     numbers, because they run the same composition over the same board.
 */

import {
  readWeeklyScoreboard,
  type ScoreboardSource,
  type WeeklyScoreboard,
} from "@/data/supabase/commercial-service";
import {
  hasUnreadableNumber,
  homeFloorReadings,
  homeWeekNote,
  homeWeekNumbers,
  type HomeNumber,
  type HomeWeekInput,
  type HomeWeekSourceNotes,
} from "@/domain/home-week";
import { floorBreaches, type FloorReading, type TodayCandidate } from "@/domain/today-ordering";
import type { ID } from "@/domain/entities";

export interface WeeklySnapshot {
  /** The week window the board resolved, in the organization's own timezone. */
  week: WeeklyScoreboard["week"];
  timeZone: string;
  timeZoneFallback: boolean;
  timeZoneBecause?: string | undefined;
  /** The raw values and agreed targets, exactly as the board reported them. */
  input: HomeWeekInput;
  /** The canonical four numbers, in charter order. */
  numbers: HomeNumber[];
  /** True when at least one of the four could not be read. */
  unreadable: boolean;
  /** The floor readings Today may treat as breaches. */
  floorReadings: FloorReading[];
  /** Those readings already turned into ordered-Today candidates. */
  floorCandidates: TodayCandidate[];
  /** One honest sentence about which week this is, and in whose timezone. */
  note: string;
  /**
   * Standing state, not a number this week produced: deliberately not one of
   * the four, exposed here only because it is read from the same board.
   */
  runClients: number | null;
  sources: WeeklyScoreboard["sources"];
}

/** The single query key, so two rooms share one cache entry rather than two. */
export function weeklySnapshotKey(organizationId: ID): [string, ID] {
  return ["weekly-snapshot", organizationId];
}

/**
 * Which source's failure explains which number. Written once here so no room
 * can quietly attribute an unknown to the wrong reason.
 */
function sourceNotes(sources: WeeklyScoreboard["sources"]): HomeWeekSourceNotes {
  const because = (source: ScoreboardSource): string | undefined =>
    source.available ? undefined : source.because;
  return {
    revenue: because(sources.clients) ?? because(sources.proposals) ?? because(sources.tierChanges),
    firstTouches: because(sources.firstTouches) ?? because(sources.touches),
    discoveryCalls: because(sources.touches),
    proposalsSent: because(sources.proposals),
  };
}

/**
 * Pure composition. Every read surface goes through this, so divergence
 * between rooms is not possible without changing this one function.
 */
export function composeWeeklySnapshot(board: WeeklyScoreboard): WeeklySnapshot {
  const input: HomeWeekInput = {
    targets: board.targets,
    revenue: board.revenue,
    firstTouches: board.firstTouches,
    discoveryCalls: board.discoveryCalls,
    proposalsSent: board.proposalsSent,
    timeZone: board.timeZone,
    timeZoneFallback: board.timeZoneFallback,
    timeZoneBecause: board.timeZoneBecause,
  };

  const numbers = homeWeekNumbers(input, sourceNotes(board.sources));
  const floorReadings = homeFloorReadings(input);

  return {
    week: board.week,
    timeZone: board.timeZone,
    timeZoneFallback: board.timeZoneFallback,
    timeZoneBecause: board.timeZoneBecause,
    input,
    numbers,
    unreadable: hasUnreadableNumber(numbers),
    floorReadings,
    floorCandidates: floorBreaches(floorReadings),
    note: homeWeekNote(input),
    runClients: board.runClients,
    sources: board.sources,
  };
}

/** Read the canonical board once, then compose. Writes nothing. */
export async function readWeeklySnapshot(
  organizationId: ID,
  now: Date | string = new Date(),
): Promise<WeeklySnapshot> {
  return composeWeeklySnapshot(await readWeeklyScoreboard(organizationId, now));
}
