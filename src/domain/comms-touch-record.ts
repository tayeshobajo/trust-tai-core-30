/**
 * The record behind one interaction.
 *
 * A touch can be corrected or withdrawn, but never rewritten into something it
 * was not. Its original wording, the moment it happened, and who put it on the
 * record all survive every edit; corrections are appended, not substituted, and
 * a retraction hides the claim without deleting the history of having made it.
 *
 * Everything here is pure: it reads and rebuilds the `provenance` jsonb that
 * already travels with each touch, so no new table is needed.
 */

import type { ISODateTime } from "./entities";

export interface TouchEdit {
  at: ISODateTime;
  by?: string;
  /** The wording this edit replaced, so the trail reads backwards. */
  previousSummary?: string;
}

export interface TouchProvenance {
  app_key?: string;
  actor?: string;
  logged_at?: string;
  added_by?: string;
  original_summary?: string;
  original_body?: string | null;
  original_occurred_at?: string;
  edits?: TouchEdit[];
  retracted_at?: string;
  retracted_by?: string;
  retracted_because?: string;
  [key: string]: unknown;
}

export interface TouchRecordRead {
  retracted: boolean;
  retractedAt?: ISODateTime;
  retractedBy?: string;
  retractedBecause?: string;
  edited: boolean;
  editCount: number;
  lastEditedAt?: ISODateTime;
  lastEditedBy?: string;
  originalSummary?: string;
  addedBy?: string;
  loggedAt?: ISODateTime;
}

function asProvenance(value: unknown): TouchProvenance {
  return value && typeof value === "object" ? (value as TouchProvenance) : {};
}

/** What a person should be told about how this entry came to read as it does. */
export function readTouchRecord(value: unknown): TouchRecordRead {
  const provenance = asProvenance(value);
  const edits = Array.isArray(provenance.edits) ? provenance.edits : [];
  const last = edits[edits.length - 1];
  return {
    retracted: Boolean(provenance.retracted_at),
    ...(provenance.retracted_at ? { retractedAt: provenance.retracted_at } : {}),
    ...(provenance.retracted_by ? { retractedBy: provenance.retracted_by } : {}),
    ...(provenance.retracted_because ? { retractedBecause: provenance.retracted_because } : {}),
    edited: edits.length > 0,
    editCount: edits.length,
    ...(last?.at ? { lastEditedAt: last.at } : {}),
    ...(last?.by ? { lastEditedBy: last.by } : {}),
    ...(provenance.original_summary ? { originalSummary: provenance.original_summary } : {}),
    ...(provenance.added_by ? { addedBy: provenance.added_by } : {}),
    ...(provenance.logged_at ? { loggedAt: provenance.logged_at } : {}),
  };
}

/** One line a person can read under a corrected or withdrawn entry. */
export function recordNote(read: TouchRecordRead): string | null {
  const when = (value?: string) => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : ` ${date.toLocaleDateString()}`;
  };
  if (read.retracted) {
    const by = read.retractedBy ? ` by ${read.retractedBy}` : "";
    const because = read.retractedBecause ? `: ${read.retractedBecause}` : "";
    return `Retracted${when(read.retractedAt)}${by}${because}. The original record is kept.`;
  }
  if (read.edited) {
    const by = read.lastEditedBy ? ` by ${read.lastEditedBy}` : "";
    return `Edited${when(read.lastEditedAt)}${by}. Originally: “${read.originalSummary ?? "not recorded"}”.`;
  }
  return null;
}

/**
 * Provenance for a corrected touch. The first edit captures the original
 * wording; later edits append to the trail and never overwrite it.
 */
export function editedProvenance(
  current: unknown,
  input: {
    previousSummary: string;
    previousBody?: string | null;
    occurredAt?: ISODateTime;
    at: ISODateTime;
    by?: string;
  },
): TouchProvenance {
  const provenance = { ...asProvenance(current) };
  const edits = Array.isArray(provenance.edits) ? [...provenance.edits] : [];
  if (!provenance.original_summary) {
    provenance.original_summary = input.previousSummary;
    provenance.original_body = input.previousBody ?? null;
  }
  if (!provenance.original_occurred_at && input.occurredAt) {
    provenance.original_occurred_at = input.occurredAt;
  }
  edits.push({
    at: input.at,
    ...(input.by ? { by: input.by } : {}),
    previousSummary: input.previousSummary,
  });
  provenance.edits = edits;
  return provenance;
}

/** Provenance for a withdrawn touch. Nothing is removed, only marked. */
export function retractedProvenance(
  current: unknown,
  input: { at: ISODateTime; by?: string; because?: string },
): TouchProvenance {
  const provenance = { ...asProvenance(current) };
  provenance.retracted_at = input.at;
  if (input.by) provenance.retracted_by = input.by;
  if (input.because?.trim()) provenance.retracted_because = input.because.trim();
  return provenance;
}

/** Bringing an entry back: the retraction is cleared, its having happened is not. */
export function restoredProvenance(current: unknown, input: { at: ISODateTime }): TouchProvenance {
  const provenance = { ...asProvenance(current) };
  const history = Array.isArray(provenance["retractions"])
    ? [...(provenance["retractions"] as unknown[])]
    : [];
  if (provenance.retracted_at) {
    history.push({
      at: provenance.retracted_at,
      by: provenance.retracted_by,
      because: provenance.retracted_because,
      restored_at: input.at,
    });
  }
  delete provenance.retracted_at;
  delete provenance.retracted_by;
  delete provenance.retracted_because;
  provenance["retractions"] = history;
  return provenance;
}
