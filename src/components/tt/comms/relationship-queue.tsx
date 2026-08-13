/**
 * The queue: the Comms Lead's left pane.
 *
 * Grouped by what is true rather than by folder. Every row says who, where the
 * relationship stands, and how late it is. Nothing here is a count for its own
 * sake.
 */

import { CHANNEL_LABEL, DUE_LABEL, dueState, STAGE_LABEL, type Relationship } from "@/domain/comms";
import { BUCKET_LABEL, coverage, groupQueue, matchesSearch } from "@/data/comms-queue";
import { MetaPill, TTInput } from "@/components/tt/primitives";
import { cn } from "@/lib/utils";

const DUE_TONE: Record<string, string> = {
  overdue: "text-destructive",
  today: "text-warning",
  this_week: "text-muted-foreground",
  dormant: "text-muted-foreground",
  clear: "text-muted-foreground",
};

function relativeDay(value?: string): string {
  if (!value) return "No contact yet";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

export function RelationshipQueue({
  relationships,
  selectedId,
  onSelect,
  query,
  onQuery,
}: {
  relationships: Relationship[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQuery: (value: string) => void;
}) {
  const filtered = relationships.filter((entry) => matchesSearch(entry, query));
  const groups = groupQueue(filtered);
  const read = coverage(relationships);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-4">
        <p className="tt-eyebrow">Relationships</p>
        <p className="mt-2 text-[13px] text-muted-foreground">
          {read.total} live · {read.overdue} overdue · {read.quiet} gone quiet
        </p>
        <TTInput
          className="mt-3 h-10"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search people, companies, events"
          aria-label="Search relationships"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="p-6 text-[13px] text-muted-foreground">
            {relationships.length === 0
              ? "No relationships yet. Add the last person you met and Comms will carry it from there."
              : "Nothing matches that search."}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.bucket}>
              <h3 className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-4 py-2 backdrop-blur">
                <span className="tt-eyebrow">{BUCKET_LABEL[group.bucket]}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {group.relationships.length}
                </span>
              </h3>
              <ul>
                {group.relationships.map((relationship) => {
                  const due = dueState(relationship);
                  const active = relationship.id === selectedId;
                  return (
                    <li key={relationship.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(relationship.id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "w-full border-b border-border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          active ? "bg-secondary" : "hover:bg-secondary/60",
                        )}
                      >
                        <p className="truncate text-sm text-foreground">{relationship.fullName}</p>
                        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                          {relationship.companyName ?? relationship.metWhere ?? "No company on record"}
                        </p>
                        <p className="mt-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
                          <span className="text-muted-foreground">
                            {STAGE_LABEL[relationship.stage]}
                          </span>
                          <span className={DUE_TONE[due]}>{DUE_LABEL[due]}</span>
                          <span className="text-muted-foreground">
                            {relativeDay(relationship.lastTouchAt)}
                          </span>
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/** Small legend used by the empty workspace so channels read consistently. */
export const CHANNELS = Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label }));

export function CoverageStrip({ relationships }: { relationships: Relationship[] }) {
  const read = coverage(relationships);
  const items = [
    { label: "Overdue", value: read.overdue },
    { label: "Due today", value: read.dueToday },
    { label: "No owner", value: read.unowned },
    { label: "No next move", value: read.withoutNextMove },
    { label: "Gone quiet", value: read.quiet },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <MetaPill key={item.label}>
          {item.label} {item.value}
        </MetaPill>
      ))}
    </div>
  );
}
