/**
 * The Ops portfolio surface.
 *
 * Presentation only. Every value shown arrives from the projection built out
 * of rows Ops wrote; nothing is derived optimistically here, and a missing
 * field renders as a quiet dash rather than a guess.
 */

import { Search } from "lucide-react";

import { MetaPill, TTButton } from "@/components/tt/primitives";
import {
  OPS_PAGE_SIZES,
  OPS_SORT_OPTIONS,
  type OpsFilters,
  type OpsPage,
  type OpsSortKey,
  type OpsSystem,
} from "@/data/ops/projection";
import { cn } from "@/lib/utils";

const SELECT =
  "h-9 rounded-full border border-border bg-card px-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const HEALTH_LABEL: Record<OpsSystem["health"], string> = {
  incident: "Open incident",
  attention: "Needs attention",
  healthy: "Healthy",
  unknown: "State not reported",
};

const HEALTH_TONE: Record<OpsSystem["health"], string> = {
  incident: "border-destructive/30 bg-destructive/10 text-destructive",
  attention: "border-warning/30 bg-warning/10 text-warning",
  healthy: "border-success/25 bg-success/10 text-success",
  unknown: "border-border bg-muted/40 text-muted-foreground",
};

export function OpsHealthPill({ health }: { health: OpsSystem["health"] }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full border px-2.5 font-mono text-[10px] uppercase tracking-[0.14em]",
        HEALTH_TONE[health],
      )}
    >
      {HEALTH_LABEL[health]}
    </span>
  );
}

export function OpsToolbar({
  filters,
  onFiltersChange,
  companies,
  environments,
}: {
  filters: OpsFilters;
  onFiltersChange: (filters: OpsFilters) => void;
  companies: string[];
  environments: string[];
}) {
  const set = (patch: Partial<OpsFilters>) => onFiltersChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative min-w-[220px] flex-1">
        <span className="sr-only">Search Ops systems</span>
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          value={filters.query}
          onChange={(event) => set({ query: event.target.value })}
          placeholder="Search systems, companies, owners"
          className="h-9 w-full rounded-full border border-border bg-card pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      {companies.length > 0 ? (
        <select
          aria-label="Company"
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
      ) : null}

      <select
        aria-label="Status"
        className={SELECT}
        value={filters.health}
        onChange={(event) => set({ health: event.target.value })}
      >
        <option value="all">All statuses</option>
        <option value="incident">Open incident</option>
        <option value="attention">Needs attention</option>
        <option value="healthy">Healthy</option>
      </select>

      {environments.length > 0 ? (
        <select
          aria-label="Environment"
          className={SELECT}
          value={filters.environment}
          onChange={(event) => set({ environment: event.target.value })}
        >
          <option value="all">All environments</option>
          {environments.map((environment) => (
            <option key={environment} value={environment}>
              {environment}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

function when(at: string | null): string {
  if (!at) return "not reported";
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "not reported" : date.toLocaleDateString();
}

/**
 * A count Ops never reported is a dash, never a zero. Zero is a claim, and
 * this room only makes claims Ops actually made.
 */
function count(value: number | null, one: string, many: string): string {
  if (value === null) return `\u2014 ${many}`;
  return `${value} ${value === 1 ? one : many}`;
}

export function OpsSystemRow({
  system,
  onOpen,
  busy,
}: {
  system: OpsSystem;
  onOpen: (system: OpsSystem) => void;
  busy: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(system)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(system);
        }
      }}
      className="group flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-royal/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex-row lg:items-center lg:justify-between"
    >
      <div className="min-w-0">
        {system.company ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {system.company}
          </p>
        ) : null}
        <p className="truncate text-[15px] text-foreground">{system.name}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <OpsHealthPill health={system.health} />
          {system.environment ? <MetaPill>{system.environment}</MetaPill> : null}
          <MetaPill>{count(system.openIssues, "open issue", "open issues")}</MetaPill>
          <MetaPill>{count(system.openApprovals, "approval", "approvals")}</MetaPill>
          {system.status ? <MetaPill>{system.status}</MetaPill> : null}
          {system.latestRun ? <MetaPill>latest: {system.latestRun.label}</MetaPill> : null}
          {system.owner ? <MetaPill>{system.owner}</MetaPill> : null}
          {system.canonicalProjectId ? <MetaPill>linked to a project</MetaPill> : null}
          <MetaPill>{system.source === "projection" ? "synced from Ops" : "from activity"}</MetaPill>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className="text-[12px] text-muted-foreground">
          Last activity {when(system.lastActivityAt)}
        </span>
        <TTButton
          variant="secondary"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(system);
          }}
        >
          Open in Ops ↗
        </TTButton>
      </div>
    </div>
  );
}

export function OpsSortControl({
  value,
  onChange,
}: {
  value: OpsSortKey;
  onChange: (value: OpsSortKey) => void;
}) {
  return (
    <select
      aria-label="Sort systems"
      className={SELECT}
      value={value}
      onChange={(event) => onChange(event.target.value as OpsSortKey)}
    >
      {OPS_SORT_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function OpsPager({
  page,
  onPageChange,
  onPageSizeChange,
}: {
  page: OpsPage;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <p className="text-[13px] text-muted-foreground">
        Showing {page.from}-{page.to} of {page.total}{" "}
        {page.total === 1 ? "system" : "systems"}
      </p>
      <div className="flex items-center gap-2">
        <select
          aria-label="Systems per page"
          className={SELECT}
          value={page.pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {OPS_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} per page
            </option>
          ))}
        </select>
        <TTButton
          variant="secondary"
          disabled={page.page <= 1}
          onClick={() => onPageChange(page.page - 1)}
        >
          Previous
        </TTButton>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Page {page.page} of {page.pageCount}
        </span>
        <TTButton
          variant="secondary"
          disabled={page.page >= page.pageCount}
          onClick={() => onPageChange(page.page + 1)}
        >
          Next
        </TTButton>
      </div>
    </div>
  );
}
