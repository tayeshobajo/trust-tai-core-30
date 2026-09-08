/**
 * Scout watchlist (Sentinel), curated only.
 *
 * A watchlist entry is NOT a new company entity. It is a marker recorded on a
 * canonical `prospects` row saying: a person here decided this company is
 * worth keeping an eye on, and here is who decided and when.
 *
 * Nothing on the watchlist is scored, ranked or made urgent by being here.
 */

import type { ID, ISODateTime } from "./entities";

/** How a company got onto the watchlist. Both are human decisions. */
export type WatchlistMethod = "manual" | "import";

export interface WatchlistMarker {
  method: WatchlistMethod;
  /** Who decided. Always a person, never the system. */
  by: ID;
  byLabel?: string | null;
  at: ISODateTime;
  /** A person's own words about why this company is being watched. */
  note?: string | null;
  /** Replay key so a retried save never adds the same company twice. */
  sourceKey: string;
}

/** A row waiting to be reviewed by a person. Nothing here is saved yet. */
export type StagedState = "new" | "duplicate" | "unreadable";

export interface StagedCompany {
  /** Stable within one staged batch, used for edit/remove/keep. */
  id: string;
  /** Exactly what was pasted, kept so nothing is quietly rewritten. */
  raw: string;
  name: string;
  websiteUrl: string | null;
  state: StagedState;
  /** Plain reason for the state, shown next to the row. */
  because: string;
  /** A person can drop a row from the batch without deleting the evidence. */
  keep: boolean;
  /**
   * Present when the row came from Smart Import: what Scout read, where it
   * read it, and which parts it inferred. Never written to storage.
   */
  extraction?: ExtractedCompany;
}

export const STAGED_STATE_LABEL: Record<StagedState, string> = {
  new: "New",
  duplicate: "Already on the board",
  unreadable: "Cannot read",
};

/** The one honesty line the watchlist surface carries. */
export const WATCHLIST_HONESTY_NOTE =
  "Scout reports what it observed. No change stays quiet, missing evidence stays unknown, and nothing becomes urgent because Scout wants something to report.";
