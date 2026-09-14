/**
 * MOCKUP ONLY — the work list: one row per thread, one meaningful state,
 * and due follow-ups as list items rather than another stack of cards.
 */

import { AlertTriangle } from "lucide-react";

import {
  V2_FOLLOWUPS,
  V2_THREADS,
  WORK_STATE_LABEL,
  type V2Thread,
  type WorkState,
} from "@/data/mockups/comms-workspace-v2";
import { cn } from "@/lib/utils";

const FILTERS: { id: "all" | WorkState; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_reply", label: "Needs reply" },
  { id: "in_review", label: "In review" },
  { id: "waiting", label: "Waiting" },
];

const STATE_TONE: Record<WorkState, string> = {
  needs_reply: "text-[var(--danger)]",
  in_review: "text-[var(--royal)]",
  waiting: "text-muted-foreground",
  done: "text-muted-foreground",
};

export function WorkList({
  selectedId,
  filter,
  onFilter,
  onSelect,
  search,
}: {
  selectedId: string;
  filter: "all" | WorkState;
  onFilter: (value: "all" | WorkState) => void;
  onSelect: (id: string) => void;
  search: string;
}) {
  const query = search.trim().toLowerCase();
  const threads: V2Thread[] = V2_THREADS.filter(
    (thread) =>
      (filter === "all" || thread.state === filter) &&
      (!query ||
        `${thread.person} ${thread.company} ${thread.subject} ${thread.snippet}`
          .toLowerCase()
          .includes(query)),
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <label className="sr-only" htmlFor="work-filter">
          Filter conversations
        </label>
        <select
          id="work-filter"
          value={filter}
          onChange={(event) => onFilter(event.target.value as "all" | WorkState)}
          className="h-9 rounded-lg border border-border bg-card px-2.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {FILTERS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        <span className="ml-auto text-[12px] text-muted-foreground">{threads.length} shown</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-muted-foreground">
            Nothing matches that. Clear the search or choose All.
          </p>
        ) : null}
        <ul>
          {threads.map((thread) => {
            const active = thread.id === selectedId;
            return (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => onSelect(thread.id)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "w-full border-b border-border px-4 py-3 text-left transition-colors duration-150 motion-reduce:transition-none",
                    active ? "bg-[var(--royal-wash-strong)]" : "hover:bg-secondary",
                  )}
                >
                  <div className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        "truncate text-[14px]",
                        thread.unread ? "font-semibold" : "font-medium",
                      )}
                    >
                      {thread.person}
                    </span>
                    <span className="truncate text-[12px] text-muted-foreground">
                      {thread.company}
                    </span>
                    <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">
                      {thread.activity}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                    {thread.kind === "Proposal" ? "Proposal · " : ""}
                    {thread.subject}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-muted-foreground/80">
                    {thread.snippet}
                  </p>
                  <p className={cn("mt-1 text-[12px]", STATE_TONE[thread.state])}>
                    {WORK_STATE_LABEL[thread.state]}
                    {thread.owner ? (
                      <span className="text-muted-foreground"> · {thread.owner}</span>
                    ) : null}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>

        <h2 className="px-4 pb-1 pt-5 text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Needs attention
        </h2>
        <ul>
          {V2_FOLLOWUPS.map((followUp) => (
            <li key={followUp.id}>
              <button
                type="button"
                onClick={() => onSelect(followUp.threadId)}
                className="flex w-full gap-2 border-b border-border px-4 py-3 text-left transition-colors hover:bg-secondary"
              >
                {followUp.tone === "overdue" ? (
                  <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" />
                ) : null}
                <span className="min-w-0">
                  <span className="block text-[13px] leading-snug">{followUp.what}</span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    {followUp.who} · {followUp.when}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
