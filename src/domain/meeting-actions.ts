/**
 * Meetings & Actions, staged locally.
 *
 * Pure, browser-safe helpers. Nothing here reads or writes the database:
 * imported meeting deliverables live only in the person's session until a
 * separate, deliberate confirmation step (not built yet) turns them into
 * existing Steward tasks. Unknown stays unknown: an owner is never guessed and
 * spoken timing is never treated as a date.
 */

export type ActionStatus = "proposed" | "confirmed" | "in_progress" | "blocked" | "complete";
export type DueCertainty = "exact" | "said" | "none";

export interface StagedAction {
  id: string;
  statement: string;
  status: ActionStatus;
  /** Status before completion, so Reopen can return to it. */
  previousStatus?: ActionStatus;
  owner: string | null;
  dueCertainty: DueCertainty;
  /** ISO date (YYYY-MM-DD) only when dueCertainty is "exact". */
  dueDate: string | null;
  /** The words used when dueCertainty is "said". */
  dueText: string | null;
  nextStep: string | null;
  dependsOn: string[];
  blockedBecause: string | null;
  sourceTitle: string | null;
  sourceAt: string | null;
  quote: string | null;
}

export type ActionFilter =
  | "all"
  | "proposed"
  | "confirmed"
  | "blocked"
  | "overdue"
  | "complete"
  | "unknown_owner";

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  proposed: "Proposed",
  confirmed: "Confirmed",
  in_progress: "In progress",
  blocked: "Blocked",
  complete: "Done",
};

const STATUSES: ActionStatus[] = ["proposed", "confirmed", "in_progress", "blocked", "complete"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Stable key used to find an existing Steward task for the same item. */
export function correlationKeyFor(sourceKey: string, statement: string): string {
  return `meeting:${sourceKey}:${hash(statement.toLowerCase().replace(/\s+/g, " ").trim())}`;
}

function normalize(raw: Record<string, unknown>, index: number): StagedAction | null {
  const statement = text(raw["statement"]) ?? text(raw["title"]);
  if (!statement) return null;
  const rawStatus = text(raw["status"]);
  let status: ActionStatus = STATUSES.includes(rawStatus as ActionStatus)
    ? (rawStatus as ActionStatus)
    : "proposed";
  const blockedBecause = text(raw["blocked_because"]) ?? text(raw["blockedBecause"]);
  // Blocked without a recorded reason is not honest; keep it proposed.
  if (status === "blocked" && !blockedBecause) status = "proposed";
  const due = text(raw["due"]);
  const dueDate = due && ISO_DATE.test(due) ? due : null;
  const dueText = dueDate ? null : (due ?? text(raw["due_text"]));
  const depends = raw["depends_on"] ?? raw["dependsOn"];
  return {
    id: text(raw["id"]) ?? `item-${index + 1}`,
    statement,
    status,
    owner: text(raw["owner"]),
    dueCertainty: dueDate ? "exact" : dueText ? "said" : "none",
    dueDate,
    dueText: dueText ?? null,
    nextStep: text(raw["next_step"]) ?? text(raw["nextStep"]),
    dependsOn: Array.isArray(depends) ? depends.map(String).filter(Boolean) : [],
    blockedBecause,
    sourceTitle: text(raw["source"]) ?? text(raw["source_title"]),
    sourceAt: text(raw["source_at"]) ?? text(raw["timestamp"]),
    quote: text(raw["quote"]),
  };
}

/**
 * Parse pasted or uploaded content. JSON (array, or { items: [] }) is read
 * field by field; plain text treats each bullet line as one proposed action
 * with an optional "@Owner" and "due:YYYY-MM-DD" or "due:next week".
 */
export function parseMeetingActions(input: string): StagedAction[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed: unknown = JSON.parse(trimmed);
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : [];
    return list
      .map((entry, i) =>
        entry && typeof entry === "object" ? normalize(entry as Record<string, unknown>, i) : null,
      )
      .filter((x): x is StagedAction => x !== null);
  }
  return trimmed
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*(?:\[[ xX]\]\s*)?/, "").trim())
    .filter((line) => line.length > 0)
    .map((line, i) => {
      const owner = /@([\p{L}][\p{L}'-]*(?:\s[\p{L}][\p{L}'-]*)?)/u.exec(line)?.[1] ?? null;
      const due = /due:\s*([^@]+?)\s*$/i.exec(line)?.[1] ?? null;
      const statement = line
        .replace(/@[\p{L}][\p{L}'-]*(?:\s[\p{L}][\p{L}'-]*)?/u, "")
        .replace(/due:.*$/i, "")
        .trim();
      return normalize({ statement, owner, due }, i);
    })
    .filter((x): x is StagedAction => x !== null);
}

/** Overdue only when an exact date has passed and the item is not done. */
export function isOverdue(item: StagedAction, today: string): boolean {
  return (
    item.status !== "complete" &&
    item.dueCertainty === "exact" &&
    item.dueDate !== null &&
    item.dueDate < today
  );
}

export function filterActions(
  items: StagedAction[],
  filter: ActionFilter,
  today: string,
): StagedAction[] {
  switch (filter) {
    case "all":
      return items;
    case "overdue":
      return items.filter((i) => isOverdue(i, today));
    case "unknown_owner":
      return items.filter((i) => i.owner === null);
    default:
      return items.filter((i) => i.status === filter);
  }
}

export function completeAction(item: StagedAction): StagedAction {
  if (item.status === "complete") return item;
  return { ...item, previousStatus: item.status, status: "complete" };
}

export function reopenAction(item: StagedAction): StagedAction {
  if (item.status !== "complete") return item;
  const { previousStatus, ...rest } = item;
  return { ...rest, status: previousStatus ?? "confirmed" };
}
