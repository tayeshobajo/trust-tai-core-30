/**
 * Inbox state, as a pure function.
 *
 * Which tab a conversation belongs to, which ones deserve to sit at the top,
 * and what each filter would actually show. Kept out of the component so the
 * behaviour can be proved rather than eyeballed.
 */

import type { Relationship, Touch } from "@/domain/comms";
import type { ConversationHealth, ConversationHealthStatus } from "@/domain/comms-health";
import { deriveConversationHealth } from "./comms-health";
import { matchesSearch } from "./comms-queue";

export type InboxTab = "all" | "needs_you" | "following_up" | "archived";

export const TAB_LABEL: Record<InboxTab, string> = {
  all: "All",
  needs_you: "Needs you",
  following_up: "Following up",
  archived: "Archived",
};

export const TABS: InboxTab[] = ["all", "needs_you", "following_up", "archived"];

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

export function tabOf(entry: InboxEntry): InboxTab {
  if (entry.relationship.stage === "archived") return "archived";
  if (entry.health.waitingOn === "needs_us") return "needs_you";
  return "following_up";
}

export function tabCounts(entries: InboxEntry[]): Record<InboxTab, number> {
  const counts: Record<InboxTab, number> = {
    all: 0,
    needs_you: 0,
    following_up: 0,
    archived: 0,
  };
  for (const entry of entries) {
    const tab = tabOf(entry);
    counts[tab] += 1;
    if (tab !== "archived") counts.all += 1;
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
 * What the inbox should render for the current tab, search, and health filter.
 * Priority is what is genuinely waiting; everything else is simply "others".
 */
export function inboxView(
  entries: InboxEntry[],
  options: {
    tab: InboxTab;
    query?: string;
    health?: ConversationHealthStatus | null;
  },
): InboxView {
  const counts = tabCounts(entries);
  const health = healthCounts(entries);

  const visible = entries.filter((entry) => {
    if (options.tab === "all" ? entry.relationship.stage === "archived" : tabOf(entry) !== options.tab) {
      return false;
    }
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

export function sinceLabel(value?: string): string {
  if (!value) return "No activity";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}
