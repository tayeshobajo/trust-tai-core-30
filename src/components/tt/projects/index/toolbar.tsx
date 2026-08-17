/** Tabs, search and filters for the project list. Presentation only. */

import { Search } from "lucide-react";

import {
  PROJECTS_TABS,
  SURFACE_STATUS_LABEL,
  type ProjectFilters,
  type ProjectsTab,
  type SurfaceStatus,
} from "@/data/projects/index-projection";
import { cn } from "@/lib/utils";

const SELECT =
  "h-9 rounded-full border border-border bg-card px-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ProjectsToolbar({
  tab,
  onTabChange,
  counts,
  filters,
  onFiltersChange,
  companies,
  owners,
  statuses,
  milestones,
}: {
  tab: ProjectsTab;
  onTabChange: (tab: ProjectsTab) => void;
  counts: Record<ProjectsTab, number>;
  filters: ProjectFilters;
  onFiltersChange: (filters: ProjectFilters) => void;
  companies: string[];
  owners: string[];
  statuses: SurfaceStatus[];
  milestones: string[];
}) {
  const set = (patch: Partial<ProjectFilters>) => onFiltersChange({ ...filters, ...patch });

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Project views" className="flex flex-wrap gap-1.5">
        {PROJECTS_TABS.map((entry) => {
          const active = entry.value === tab;
          return (
            <button
              key={entry.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(entry.value)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full border px-4 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.label}
              <span className={cn("font-mono text-[10px]", active ? "" : "text-muted-foreground")}>
                {counts[entry.value]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search projects</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={filters.query}
            onChange={(event) => set({ query: event.target.value })}
            placeholder="Search projects, companies, or owners"
            className="h-9 w-full rounded-full border border-border bg-card pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        <select
          aria-label="Filter by company"
          className={SELECT}
          value={filters.company}
          onChange={(event) => set({ company: event.target.value })}
        >
          <option value="all">All companies</option>
          {companies.map((company) => (
            <option key={company} value={company}>
              {company}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by owner"
          className={SELECT}
          value={filters.owner}
          onChange={(event) => set({ owner: event.target.value })}
        >
          <option value="all">All owners</option>
          {owners.map((owner) => (
            <option key={owner} value={owner}>
              {owner}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by status"
          className={SELECT}
          value={filters.status}
          onChange={(event) => set({ status: event.target.value })}
        >
          <option value="all">Any status</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {SURFACE_STATUS_LABEL[status]}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by milestone"
          className={SELECT}
          value={filters.milestone}
          onChange={(event) => set({ milestone: event.target.value })}
        >
          <option value="all">Any milestone</option>
          {milestones.map((milestone) => (
            <option key={milestone} value={milestone}>
              {milestone}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by due date"
          className={SELECT}
          value={filters.due}
          onChange={(event) => set({ due: event.target.value as ProjectFilters["due"] })}
        >
          <option value="all">Any date</option>
          <option value="overdue">Overdue</option>
          <option value="week">Due this week</option>
          <option value="month">Due this month</option>
          <option value="none">No date agreed</option>
        </select>
      </div>
    </div>
  );
}
