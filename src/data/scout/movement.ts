/**
 * Movement, pure logic.
 *
 * A company moves only when a fact Scout actually observed on its public pages
 * changed between two reads. Nothing here looks at fit, scores, criteria, ICP
 * versions, page counts or freshness: a re-read that returned the same evidence
 * is silence, and silence stays silent.
 *
 * The delta is computed at the moment observations are merged (the prior state
 * is not kept anywhere else) and stored as a bounded, append-only marker on the
 * prospect's existing metadata. This module both writes that marker's shape and
 * reads it back into the Movement projection. It never writes to a database.
 */

export type ObservationChangeKind = "added" | "changed" | "removed" | "source_moved";

export interface ObservationChange {
  kind: ObservationChangeKind;
  key: string;
  /** Human label for the observation, when the row carried one. */
  label: string | null;
  /** The statement as it reads now, for added and changed. */
  statement: string | null;
  /** The statement as it read before, for changed and removed. */
  previousStatement: string | null;
  /** The public page the current statement was read from, when there is one. */
  sourceUrl: string | null;
  /** The page it used to be read from, for a source move. */
  previousSourceUrl: string | null;
}

/** One completed read that produced at least one observed change. */
export interface ObservationLogEntry {
  /** ISO timestamp of the read that observed the change. */
  at: string;
  changes: ObservationChange[];
}

export const OBSERVATION_LOG_LIMIT = 10;
const MAX_CHANGES_PER_ENTRY = 25;

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rowKey(row: Row, index: number): string {
  const value = row["key"] ?? row["id"] ?? row["label"];
  return typeof value === "string" && value.trim() ? value.trim() : `row_${index}`;
}

function statementOf(row: Row): string | null {
  return text(row["statement"]) ?? text(row["evidence"]) ?? text(row["value"]);
}

function sourceOf(row: Row): string | null {
  return text(row["source_url"]) ?? text(row["sourceUrl"]);
}

/** Whitespace and case are not a change. */
function sameText(a: string | null, b: string | null): boolean {
  const norm = (value: string | null) => (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return norm(a) === norm(b);
}

function indexRows(rows: unknown[]): Map<string, Row> {
  const out = new Map<string, Row>();
  rows.forEach((item, index) => {
    const row = (item ?? {}) as Row;
    const key = rowKey(row, index);
    if (!out.has(key)) out.set(key, row);
  });
  return out;
}

/**
 * The observed difference between what was held and what a pass just read.
 *
 * Conservative by design:
 *   - a first-ever read has nothing to compare against, so it is never movement;
 *   - a key the pass did not reach is preserved, never reported as removed;
 *   - a removal is reported only when the caller states the pass really covered
 *     that key and came back without it.
 */
export function diffObservations(input: {
  previous: unknown[];
  incoming: unknown[];
  /** Keys the pass genuinely re-read. Only these can produce a removal. */
  coveredKeys?: string[];
}): ObservationChange[] {
  // Nothing was ever held: this is a first read, which is coverage, not change.
  if (input.previous.length === 0) return [];

  const previous = indexRows(input.previous);
  const incoming = indexRows(input.incoming);
  const covered = new Set(input.coveredKeys ?? []);
  const changes: ObservationChange[] = [];

  for (const [key, row] of incoming) {
    const before = previous.get(key);
    const statement = statementOf(row);
    const sourceUrl = sourceOf(row);
    const label = text(row["label"]);
    if (!before) {
      changes.push({
        kind: "added",
        key,
        label,
        statement,
        previousStatement: null,
        sourceUrl,
        previousSourceUrl: null,
      });
      continue;
    }
    const previousStatement = statementOf(before);
    const previousSourceUrl = sourceOf(before);
    if (!sameText(statement, previousStatement)) {
      changes.push({
        kind: "changed",
        key,
        label,
        statement,
        previousStatement,
        sourceUrl,
        previousSourceUrl,
      });
      continue;
    }
    if (sourceUrl && previousSourceUrl && sourceUrl !== previousSourceUrl) {
      changes.push({
        kind: "source_moved",
        key,
        label,
        statement,
        previousStatement,
        sourceUrl,
        previousSourceUrl,
      });
    }
  }

  for (const [key, row] of previous) {
    if (incoming.has(key)) continue;
    if (!covered.has(key)) continue;
    changes.push({
      kind: "removed",
      key,
      label: text(row["label"]),
      statement: null,
      previousStatement: statementOf(row),
      sourceUrl: null,
      previousSourceUrl: sourceOf(row),
    });
  }

  return changes.slice(0, MAX_CHANGES_PER_ENTRY);
}

/* -------------------------------------------------------- the stored log --- */

function isChange(value: unknown): value is ObservationChange {
  if (!value || typeof value !== "object") return false;
  const change = value as Partial<ObservationChange>;
  return (
    typeof change.key === "string" &&
    (change.kind === "added" ||
      change.kind === "changed" ||
      change.kind === "removed" ||
      change.kind === "source_moved")
  );
}

/** Read the observed-change log. Oldest → newest, never throws. */
export function readObservationLog(metadata: unknown): ObservationLogEntry[] {
  if (!metadata || typeof metadata !== "object") return [];
  const stored = (metadata as Row)["observation_log"];
  if (!Array.isArray(stored)) return [];
  const entries: ObservationLogEntry[] = [];
  for (const item of stored) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Row;
    const at = text(entry["at"]);
    const changes = Array.isArray(entry["changes"]) ? entry["changes"].filter(isChange) : [];
    if (!at || changes.length === 0) continue;
    entries.push({ at, changes });
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Append one read's observed changes. A read that changed nothing appends
 * nothing at all, and replaying the same read is idempotent.
 */
export function appendObservationLog(
  metadata: unknown,
  entry: ObservationLogEntry,
  limit = OBSERVATION_LOG_LIMIT,
): ObservationLogEntry[] {
  const existing = readObservationLog(metadata);
  if (entry.changes.length === 0) return existing;
  const withoutReplay = existing.filter((item) => item.at !== entry.at);
  return [...withoutReplay, entry].slice(-limit);
}

/* ---------------------------------------------------------- projection --- */

export interface MovementLine {
  kind: ObservationChangeKind;
  /** Plain sentence describing what changed. Never urgent, never scored. */
  text: string;
  sourceUrl: string | null;
}

export interface MovementRow<T> {
  subject: T;
  /** When the change was observed. */
  observedAt: string;
  lines: MovementLine[];
  /** Total observed changes in the latest read, including lines not shown. */
  changeCount: number;
  /** True when the only thing that moved was where a fact is published. */
  sourceMovesOnly: boolean;
}

const MAX_LINES = 3;

function subjectOf(change: ObservationChange): string {
  return change.label ?? change.key.replace(/[._]/g, " ");
}

function clip(value: string, max = 120): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** One observed change, in plain words. No judgement, no urgency. */
export function describeChange(change: ObservationChange): string {
  const what = subjectOf(change);
  switch (change.kind) {
    case "added":
      return change.statement
        ? `Now says: ${clip(change.statement)}`
        : `${what} is now stated on the site`;
    case "changed":
      return change.statement
        ? `${what} now reads: ${clip(change.statement)}`
        : `${what} was reworded`;
    case "removed":
      return `${what} is no longer stated on the page it was read from`;
    case "source_moved":
      return `${what} says the same thing, on a different page`;
  }
}

/**
 * The Movement view's rows. A company appears only when its most recent read
 * actually observed a change, and only substantive change puts it near the top.
 */
export function movementRows<T>(
  entries: { subject: T; log: ObservationLogEntry[] }[],
): MovementRow<T>[] {
  const rows: MovementRow<T>[] = [];
  for (const { subject, log } of entries) {
    const latest = log[log.length - 1];
    if (!latest || latest.changes.length === 0) continue;
    const sourceMovesOnly = latest.changes.every((change) => change.kind === "source_moved");
    rows.push({
      subject,
      observedAt: latest.at,
      changeCount: latest.changes.length,
      sourceMovesOnly,
      lines: latest.changes.slice(0, MAX_LINES).map((change) => ({
        kind: change.kind,
        text: describeChange(change),
        sourceUrl: change.sourceUrl ?? change.previousSourceUrl ?? null,
      })),
    });
  }
  return rows.sort((a, b) => {
    if (a.sourceMovesOnly !== b.sourceMovesOnly) return a.sourceMovesOnly ? 1 : -1;
    return b.observedAt.localeCompare(a.observedAt);
  });
}
