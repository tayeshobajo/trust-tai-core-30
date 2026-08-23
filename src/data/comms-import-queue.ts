/**
 * Mailbox import queue: the decision logic behind the labeled-candidate
 * review surface.
 *
 * Deliberately free of React, Supabase, and Gmail. Everything here operates
 * on the candidate set already discovered inside one mailbox's bounded
 * labeled window — the server returns the full set, so filtering, search,
 * selection, and pagination over it are truthful.
 *
 * The laws that hold here:
 * - The default queue is who needs a decision: people not yet in Comms.
 *   Already-tracked people live in their own view, never mixed in.
 * - Selection never crosses a context change. Switching mailbox, view,
 *   search, or page clears it — nothing unseen is ever acted on.
 * - Bulk add is sequential and per-person: each candidate goes through the
 *   same governed creation path, a failure stops nothing else, and a retry
 *   only revisits the people who still need it.
 */

import type { MailboxCandidate } from "@/data/supabase/comms-gmail";
import type { RelationshipInput } from "@/data/supabase/comms-service";

/** The two views over one discovered set: who needs a decision, who is done. */
export type ImportView = "pending" | "tracked";

export const IMPORT_PAGE_SIZE = 25;

export interface ImportQueueState {
  view: ImportView;
  query: string;
  page: number;
  /** Selected candidate emails — only ever rows visible on the current page. */
  selected: string[];
}

export const initialImportQueue: ImportQueueState = {
  view: "pending",
  query: "",
  page: 1,
  selected: [],
};

/**
 * Any context change starts clean. Switching view, search, or mailbox
 * returns to page 1; switching page keeps the context. Every change clears
 * the selection — a selection is only ever the rows someone just looked at.
 */
export function changeImportContext(
  state: ImportQueueState,
  change: { view?: ImportView; query?: string; page?: number; mailbox?: boolean },
): ImportQueueState {
  const resetsPage =
    change.view !== undefined || change.query !== undefined || change.mailbox === true;
  return {
    view: change.view ?? state.view,
    query: change.query ?? state.query,
    page: change.page ?? (resetsPage ? 1 : state.page),
    selected: [],
  };
}

/** Of the discovered correspondents, how many need a decision and how many are done. */
export function countImportViews(candidates: Pick<MailboxCandidate, "alreadyTracked">[]): {
  pending: number;
  tracked: number;
} {
  const tracked = candidates.filter((candidate) => candidate.alreadyTracked).length;
  return { pending: candidates.length - tracked, tracked };
}

/** Name, address, or the company-ish domain behind the address. */
export function matchesImportQuery(
  candidate: Pick<MailboxCandidate, "email" | "name">,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const domain = (candidate.email.split("@")[1] ?? "").replace(/^www\./, "");
  return (
    candidate.email.toLowerCase().includes(needle) ||
    (candidate.name ?? "").toLowerCase().includes(needle) ||
    domain.includes(needle)
  );
}

/** Search applies before pagination; the view decides who is listed at all. */
export function filterImportCandidates<T extends Pick<MailboxCandidate, "email" | "name" | "alreadyTracked">>(
  candidates: T[],
  view: ImportView,
  query: string,
): T[] {
  return candidates.filter(
    (candidate) =>
      (view === "pending" ? !candidate.alreadyTracked : candidate.alreadyTracked) &&
      matchesImportQuery(candidate, query),
  );
}

/** Toggle one row. Selection stays bounded to what the page shows. */
export function toggleImportSelection(state: ImportQueueState, email: string): ImportQueueState {
  const selected = state.selected.includes(email)
    ? state.selected.filter((entry) => entry !== email)
    : [...state.selected, email];
  return { ...state, selected };
}

/**
 * The header checkbox. Select-all touches only the pending rows on the
 * current page — never an unseen page, never someone already in Comms.
 */
export function setImportPageSelection(
  state: ImportQueueState,
  rows: Pick<MailboxCandidate, "email" | "alreadyTracked">[],
  select: boolean,
): ImportQueueState {
  const pageEmails = rows
    .filter((row) => !row.alreadyTracked)
    .map((row) => row.email.toLowerCase());
  const selected = select
    ? [...new Set([...state.selected, ...pageEmails])]
    : state.selected.filter((email) => !pageEmails.includes(email));
  return { ...state, selected };
}

/** Whether every selectable row on the page is selected (header checkbox state). */
export function importPageFullySelected(
  state: ImportQueueState,
  rows: Pick<MailboxCandidate, "email" | "alreadyTracked">[],
): boolean {
  const pageEmails = rows
    .filter((row) => !row.alreadyTracked)
    .map((row) => row.email.toLowerCase());
  return pageEmails.length > 0 && pageEmails.every((email) => state.selected.includes(email));
}

/** The empty state belongs to the view, not to the data. */
export function importEmptyMessage(view: ImportView, query: string): string {
  if (query.trim()) return "No people match this search.";
  return view === "pending"
    ? "You’re caught up — everyone in this labeled window is already in Comms."
    : "No one from this labeled window is in Comms yet.";
}

/* ------------------------------------------------------------- bulk add */

export interface BulkImportFailure {
  email: string;
  error: string;
}

export interface BulkImportOutcome {
  /** Lowercased emails whose relationship now exists. */
  added: string[];
  /** People who still need attention, with why. */
  failed: BulkImportFailure[];
}

/**
 * Add selected people to Comms one at a time, each through the same governed
 * creation path a single import uses — same mailbox, same 30-day labeled
 * backfill. Sequential on purpose: progress is honest, a failure never rolls
 * back a success, and a retry of the remaining people can never duplicate
 * anyone who already made it in (creation dedupes on email regardless).
 */
export async function importCandidatesInOrder(
  drafts: { email: string; input: RelationshipInput }[],
  deps: {
    importOne: (input: RelationshipInput, integrationId?: string) => Promise<unknown>;
    integrationId?: string;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<BulkImportOutcome> {
  const added: string[] = [];
  const failed: BulkImportFailure[] = [];
  let done = 0;
  for (const draft of drafts) {
    try {
      await deps.importOne(
        draft.input,
        ...(deps.integrationId ? [deps.integrationId] : []),
      );
      added.push(draft.email.toLowerCase());
    } catch (error) {
      failed.push({
        email: draft.email.toLowerCase(),
        error: error instanceof Error ? error.message : "That import failed.",
      });
    }
    done += 1;
    deps.onProgress?.(done, drafts.length);
  }
  return { added, failed };
}
