/**
 * Inbox state, as a pure function.
 *
 * The relationship workspace has four operating views, all reading the same
 * derived state — never separate lists, never a pipeline:
 *
 *  - Clients:   established clients and meaningful existing relationships.
 *  - Nurture:   people Trust Tai deliberately chose to develop.
 *  - Needs you: human judgment required, across Clients and Nurture.
 *  - All:       the complete relationship ledger, everyone exactly once.
 *
 * Kept out of the component so the behaviour can be proved rather than
 * eyeballed.
 */

import { relationshipSegment, type Relationship, type Touch } from "@/domain/comms";
import type { ConversationHealth, ConversationHealthStatus } from "@/domain/comms-health";
import { deriveConversationHealth } from "./comms-health";
import { nextRelationshipMove } from "./comms-next-move";
import { matchesSearch } from "./comms-queue";
import { paginate, type PageView } from "./pagination";

export type InboxTab = "clients" | "nurture" | "needs_you" | "all";

export const TAB_LABEL: Record<InboxTab, string> = {
  clients: "Clients",
  nurture: "Nurture",
  needs_you: "Needs you",
  all: "All",
};

export const TABS: InboxTab[] = ["all", "clients", "nurture", "needs_you"];

/**
 * One quiet line under the tabs saying what the current view is for.
 * Calm and descriptive — never a metric, never a judgement.
 */
export const VIEW_SUMMARY: Record<InboxTab, string> = {
  clients: "Established clients and meaningful existing relationships.",
  nurture: "People you have deliberately chosen to develop, ordered by what needs attention.",
  needs_you: "Anyone — client or developing — where your judgment is required now.",
  all: "The complete relationship ledger, everyone exactly once.",
};

export interface InboxEntry {
  relationship: Relationship;
  health: ConversationHealth;
}

/** Pair every relationship with its derived health read. */
export function inboxEntries(
  relationships: Relationship[],
  touchesByRelationship: Record<string, Touch[]>,
  now: Date = new Date(),
): InboxEntry[] {
  return relationships.map((relationship) => ({
    relationship,
    health: deriveConversationHealth(relationship, touchesByRelationship[relationship.id] ?? [], now),
  }));
}

/**
 * The one segment view a conversation belongs to, or null when archived.
 * Archived people stay in the ledger (All) but crowd neither working room.
 */
export function segmentViewOf(entry: InboxEntry): "clients" | "nurture" | null {
  if (entry.relationship.stage === "archived") return null;
  return relationshipSegment(entry.relationship) === "client" ? "clients" : "nurture";
}

/**
 * Needs you, cross-cutting Clients and Nurture. Reuses the two existing
 * attention reads — the conversation waiting on us, and the next-move rules
 * with real urgency — rather than inventing a parallel engine.
 */
export function needsYou(entry: InboxEntry, now: Date = new Date()): boolean {
  if (entry.relationship.stage === "archived") return false;
  if (entry.health.waitingOn === "needs_us") return true;
  const move = nextRelationshipMove(entry.relationship, now);
  return move.needed && move.urgency !== "when_natural";
}

function inView(entry: InboxEntry, tab: InboxTab, now: Date): boolean {
  if (tab === "all") return true;
  if (tab === "needs_you") return needsYou(entry, now);
  return segmentViewOf(entry) === tab;
}

export function tabCounts(entries: InboxEntry[], now: Date = new Date()): Record<InboxTab, number> {
  const counts: Record<InboxTab, number> = {
    clients: 0,
    nurture: 0,
    needs_you: 0,
    all: 0,
  };
  for (const entry of entries) {
    counts.all += 1;
    const segment = segmentViewOf(entry);
    if (segment) counts[segment] += 1;
    if (needsYou(entry, now)) counts.needs_you += 1;
  }
  return counts;
}

export function healthCounts(
  entries: InboxEntry[],
): Record<ConversationHealthStatus, number> {
  const counts: Record<ConversationHealthStatus, number> = {
    healthy: 0,
    needs_attention: 0,
    at_risk: 0,
    quiet: 0,
  };
  for (const entry of entries) {
    if (entry.relationship.stage === "archived") continue;
    counts[entry.health.status] += 1;
  }
  return counts;
}

const STATUS_WEIGHT: Record<ConversationHealthStatus, number> = {
  at_risk: 0,
  needs_attention: 1,
  healthy: 2,
  quiet: 3,
};

/** Attention first, then whoever has waited longest. */
export function sortEntries(entries: InboxEntry[]): InboxEntry[] {
  return [...entries].sort((a, b) => {
    const weight = STATUS_WEIGHT[a.health.status] - STATUS_WEIGHT[b.health.status];
    if (weight !== 0) return weight;
    const at = new Date(
      a.health.lastActivityAt ?? a.relationship.createdAt,
    ).getTime();
    const bt = new Date(
      b.health.lastActivityAt ?? b.relationship.createdAt,
    ).getTime();
    return at - bt;
  });
}

export interface InboxView {
  priority: InboxEntry[];
  others: InboxEntry[];
  tabCounts: Record<InboxTab, number>;
  healthCounts: Record<ConversationHealthStatus, number>;
}

/**
 * What the inbox should render for the current view, search, and health
 * filter. Priority is what is genuinely waiting; everything else is simply
 * "others".
 */
export function inboxView(
  entries: InboxEntry[],
  options: {
    tab: InboxTab;
    query?: string;
    health?: ConversationHealthStatus | null;
    now?: Date;
  },
): InboxView {
  const now = options.now ?? new Date();
  const counts = tabCounts(entries, now);
  const health = healthCounts(entries);

  const visible = entries.filter((entry) => {
    if (!inView(entry, options.tab, now)) return false;
    if (options.health && entry.health.status !== options.health) return false;
    return matchesSearch(entry.relationship, options.query ?? "");
  });

  const sorted = sortEntries(visible);
  return {
    priority: sorted.filter(
      (entry) =>
        entry.health.status === "at_risk" || entry.health.status === "needs_attention",
    ),
    others: sorted.filter(
      (entry) => entry.health.status !== "at_risk" && entry.health.status !== "needs_attention",
    ),
    tabCounts: counts,
    healthCounts: health,
  };
}

/* ----------------------------------------------------------- pagination */

/**
 * Fixed page size for the relationship list. Deliberately not a preference:
 * one calm rhythm that scales to hundreds or thousands of relationships
 * without ever becoming a wall of rows.
 */
export const RELATIONSHIPS_PER_PAGE = 25;

/**
 * The current page of a view. The view is always derived in full first —
 * search, filters, counts, and tab totals describe the whole view — and only
 * then is the rendered list sliced. Priority rows lead, exactly as sorted.
 */
export function inboxPage(view: InboxView, page: number): PageView<InboxEntry> {
  return paginate([...view.priority, ...view.others], page, RELATIONSHIPS_PER_PAGE);
}

/**
 * Which relationship should be selected for a page: the current selection
 * when it is on the page, otherwise the page's first row, otherwise nothing.
 */
export function pageSelection(rows: InboxEntry[], selectedId: string | null): string | null {
  if (selectedId && rows.some((entry) => entry.relationship.id === selectedId)) {
    return selectedId;
  }
  return rows[0]?.relationship.id ?? null;
}

export function sinceLabel(value?: string): string {
  if (!value) return "No activity";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}
