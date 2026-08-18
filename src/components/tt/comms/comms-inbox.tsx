/**
 * The inbox.
 *
 * A list of conversations, not a table of records. Each row says who, what was
 * last said, how long ago, and one quiet mark for how the thread is moving.
 */

import { HEALTH_LABEL, type ConversationHealthStatus } from "@/domain/comms-health";
import {
  sinceLabel,
  TAB_LABEL,
  TABS,
  type InboxEntry,
  type InboxTab,
  type InboxView,
} from "@/data/comms-inbox";
import { initialsOf } from "@/domain/steward-accountability";
import { TTInput } from "@/components/tt/primitives";
import { cn } from "@/lib/utils";

import { HealthDot } from "./health-marks";

const HEALTH_FILTERS: ConversationHealthStatus[] = [
  "healthy",
  "needs_attention",
  "at_risk",
  "quiet",
];

export function ConversationListItem({
  entry,
  active,
  onSelect,
}: {
  entry: InboxEntry;
  active: boolean;
  onSelect: () => void;
}) {
  const { relationship, health } = entry;
  const snippet =
    relationship.nextAction?.trim() ||
    health.reasons[0] ||
    "No messages on this conversation yet.";

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex w-full items-start gap-3 border-b border-border/70 border-l-2 px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          active
            ? "border-l-royal bg-cloud"
            : "border-l-transparent hover:bg-cloud/50",
        )}
      >
        <span
          aria-hidden
          className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary font-mono text-[11px] tracking-[0.08em] text-muted-foreground"
        >
          {initialsOf(relationship.fullName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {relationship.fullName}
            </span>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {sinceLabel(health.lastActivityAt)}
            </span>
          </span>
          {relationship.companyName ? (
            <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
              {relationship.companyName}
            </span>
          ) : null}
          <span className="mt-1 block truncate text-[12px] text-muted-foreground/90">{snippet}</span>
          <span className="mt-1.5 flex items-center gap-1.5">
            <HealthDot status={health.status} />
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {HEALTH_LABEL[health.status]}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

function Section({
  title,
  entries,
  selectedId,
  onSelect,
}: {
  title: string;
  entries: InboxEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <section>
      <h3 className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-3 py-1.5 backdrop-blur">
        <span className="tt-eyebrow">{title}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{entries.length}</span>
      </h3>
      <ul>
        {entries.map((entry) => (
          <ConversationListItem
            key={entry.relationship.id}
            entry={entry}
            active={entry.relationship.id === selectedId}
            onSelect={() => onSelect(entry.relationship.id)}
          />
        ))}
      </ul>
    </section>
  );
}

export function CommsInbox({
  view,
  tab,
  onTab,
  query,
  onQuery,
  health,
  onHealth,
  selectedId,
  onSelect,
  empty,
}: {
  view: InboxView;
  tab: InboxTab;
  onTab: (tab: InboxTab) => void;
  query: string;
  onQuery: (value: string) => void;
  health: ConversationHealthStatus | null;
  onHealth: (status: ConversationHealthStatus | null) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  empty: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border p-3">
        <div className="flex items-center justify-between">
          <p className="tt-eyebrow">Inbox</p>
          <button
            type="button"
            onClick={() => {
              onHealth(null);
              onQuery("");
              onTab("all");
            }}
            className="rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Filter
          </button>
        </div>

        <nav aria-label="Inbox tabs" className="flex flex-wrap gap-1">
          {TABS.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => onTab(entry)}
              aria-pressed={tab === entry}
              className={cn(
                "rounded-full px-2.5 py-1 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab === entry
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {TAB_LABEL[entry]}
              <span className="ml-1 font-mono text-[10px] opacity-70">
                {view.tabCounts[entry]}
              </span>
            </button>
          ))}
        </nav>

        <TTInput
          className="h-9"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search people, companies, events…"
          aria-label="Search conversations"
        />

        <div className="flex flex-wrap gap-1">
          {HEALTH_FILTERS.map((status) => {
            const active = health === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => onHealth(active ? null : status)}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-foreground text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <HealthDot status={status} />
                {HEALTH_LABEL[status]}
                <span className="font-mono text-[10px] opacity-70">
                  {view.healthCounts[status]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view.priority.length === 0 && view.others.length === 0 ? (
          <p className="p-4 text-[13px] text-muted-foreground">
            {empty
              ? "No conversations yet. Add the last person you met and Comms carries it from there."
              : "Nothing here right now."}
          </p>
        ) : (
          <>
            <Section
              title="Priority"
              entries={view.priority}
              selectedId={selectedId}
              onSelect={onSelect}
            />
            <Section
              title="Others"
              entries={view.others}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          </>
        )}
      </div>
    </div>
  );
}
