/**
 * The inbox.
 *
 * A list of conversations, not a table of records. Each row answers three
 * questions in two seconds: who this is, what kind of relationship it is,
 * and whether anything is needed. Health marks stay distinct from
 * classification marks — kind is never condition.
 */

import { HEALTH_LABEL, type ConversationHealthStatus } from "@/domain/comms-health";
import { relationshipSegment } from "@/domain/comms";
import {
  sinceLabel,
  TAB_LABEL,
  TABS,
  VIEW_SUMMARY,
  type InboxEntry,
  type InboxTab,
  type InboxView,
} from "@/data/comms-inbox";
import type { PageView } from "@/data/pagination";
import { developmentStage } from "@/data/relationship-stage";
import { DEVELOPMENT_STAGE_LABEL } from "@/domain/relationship-development";
import { initialsOf } from "@/domain/steward-accountability";
import { TTInput } from "@/components/tt/primitives";
import { cn } from "@/lib/utils";

import {
  HealthDot,
  SegmentPill,
  SEGMENT_AVATAR,
  SEGMENT_EDGE,
  SEGMENT_SURFACE,
  SEGMENT_SURFACE_SELECTED,
} from "./health-marks";
import { CommsPagination } from "./pagination";

const HEALTH_FILTERS: ConversationHealthStatus[] = [
  "healthy",
  "needs_attention",
  "at_risk",
  "quiet",
];

/** View-aware words for an empty room. */
const EMPTY_COPY: Record<InboxTab, string> = {
  clients: "No established relationships here yet. When someone graduates from Nurture, they arrive here.",
  nurture: "No one is being developed right now. A Scout handoff or an approved outreach lands here.",
  needs_you: "Nothing needs your judgment right now.",
  all: "No conversations yet. Add the last person you met and Comms carries it from there.",
};

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
  const segment = relationshipSegment(relationship);
  // Developing relationships carry their human-facing state. One record, one
  // memory — this is a read of the same lifecycle, not a second pipeline.
  const development =
    segment === "nurture" ? developmentStage(relationship, []) : null;
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
          SEGMENT_EDGE[segment],
          active ? SEGMENT_SURFACE_SELECTED[segment] : SEGMENT_SURFACE[segment],
        )}
      >
        <span
          aria-hidden
          className={cn(
            "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full font-mono text-[11px] tracking-[0.08em]",
            SEGMENT_AVATAR[segment],
          )}
        >
          {initialsOf(relationship.fullName)}
        </span>
        <span className="min-w-0 flex-1">
          {/* Who, and how long it has been. */}
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
          {/* What kind of relationship, and how the conversation is doing. */}
          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            <SegmentPill segment={segment} />
            {development ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-violet-700">
                {DEVELOPMENT_STAGE_LABEL[development.stage]}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <HealthDot status={health.status} />
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {HEALTH_LABEL[health.status]}
              </span>
            </span>
          </span>
          {/* Why this row matters right now. */}
          <span className="mt-1 block truncate text-[12px] text-muted-foreground/90">{snippet}</span>
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

function isPriority(entry: InboxEntry): boolean {
  return entry.health.status === "at_risk" || entry.health.status === "needs_attention";
}

export function CommsInbox({
  view,
  page,
  onPage,
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
  /** The current page of the view — the only rows rendered below. */
  page: PageView<InboxEntry>;
  onPage: (page: number) => void;
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
  const filtered = Boolean(query.trim() || health);
  const priorityRows = page.rows.filter(isPriority);
  const otherRows = page.rows.filter((entry) => !isPriority(entry));

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

        {/* What this view is for, in one calm line. */}
        <p className="text-[12px] text-muted-foreground">{VIEW_SUMMARY[tab]}</p>

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
        {page.rows.length === 0 ? (
          <p className="p-4 text-[13px] text-muted-foreground">
            {empty ? EMPTY_COPY.all : filtered ? "Nothing matches this search or filter." : EMPTY_COPY[tab]}
          </p>
        ) : (
          <>
            <Section
              title="Priority"
              entries={priorityRows}
              selectedId={selectedId}
              onSelect={onSelect}
            />
            <Section
              title="Others"
              entries={otherRows}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          </>
        )}
      </div>

      <CommsPagination view={page} onPage={onPage} />
    </div>
  );
}
