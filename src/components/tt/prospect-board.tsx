import type { ProspectCandidate } from "@/domain/scout";
import type { FitLight } from "@/domain/scout-fit";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

import { FitIndicator, StageTag, formatChecked } from "./fit-light";

export type FitFilter = "all" | FitLight;

const FILTERS: { key: FitFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "green", label: "Green" },
  { key: "yellow", label: "Yellow" },
  { key: "red", label: "Red" },
];

export function FitFilters({
  value,
  counts,
  onChange,
}: {
  value: FitFilter;
  counts: Record<FitFilter, number>;
  onChange: (next: FitFilter) => void;
}) {
  return (
    <div role="group" aria-label="Filter by ICP fit" className="flex flex-wrap gap-2">
      {FILTERS.map((filter) => (
        <button
          key={filter.key}
          type="button"
          aria-pressed={value === filter.key}
          onClick={() => onChange(filter.key)}
          className={cn(
            "rounded-full border px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === filter.key
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {filter.label}
          <span className="ml-2 opacity-60">{counts[filter.key] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

/** Compact, scannable board. Colour marks ICP fit only, never stage. */
export function ProspectBoard({
  candidates,
  selectedId,
  onSelect,
  emphasizeNextMove = false,
}: {
  candidates: ProspectCandidate[];
  selectedId?: string | null;
  onSelect: (candidate: ProspectCandidate) => void;
  emphasizeNextMove?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="hidden grid-cols-[auto_1.1fr_auto_1.4fr_auto_auto_auto] items-center gap-4 border-b border-border bg-secondary/40 px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground lg:grid">
        <span>Fit</span>
        <span>Company</span>
        <span>ICP match</span>
        <span>{emphasizeNextMove ? "Next move" : "Strongest signal"}</span>
        <span>Stage</span>
        <span>Last checked</span>
        <span className="sr-only">Open</span>
      </div>

      <ul>
        {candidates.map((candidate) => {
          const { prospect, evaluation } = candidate;
          const line = emphasizeNextMove ? candidate.fit.recommendation : evaluation.strongestSignal;
          return (
            <li key={prospect.id}>
              <button
                type="button"
                onClick={() => onSelect(candidate)}
                aria-label={`Open ${prospect.name}`}
                className={cn(
                  "grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-4 gap-y-2 border-b border-border px-5 py-4 text-left transition-colors last:border-b-0 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:grid-cols-[auto_1.1fr_auto_1.4fr_auto_auto_auto] lg:items-center",
                  selectedId === prospect.id && "bg-secondary/60",
                )}
              >
                <FitIndicator
                  light={evaluation.light}
                  score={evaluation.score}
                  scoreable={evaluation.scoreable}
                  className="lg:hidden"
                />
                <span className="hidden lg:inline">
                  <FitIndicator
                    light={evaluation.light}
                    score={evaluation.score}
                    scoreable={evaluation.scoreable}
                    className="[&_span:nth-child(2)]:hidden"
                  />
                </span>

                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {prospect.name}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {prospect.domain || "No website recorded"}
                  </span>
                </span>

                <span className="hidden font-mono text-[12px] text-foreground lg:block">
                  {evaluation.scoreable ? `${evaluation.score}%` : "—"}
                </span>

                <span className="col-span-3 line-clamp-2 text-[13px] text-muted-foreground lg:col-span-1 lg:line-clamp-1">
                  {line}
                </span>

                <span className="col-span-2 flex flex-wrap items-center gap-2 lg:col-span-1">
                  <StageTag status={prospect.status} />
                  {candidate.source.kind === "preview_demo" ? (
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Preview demo
                    </span>
                  ) : null}
                </span>

                <span className="justify-self-end font-mono text-[11px] text-muted-foreground">
                  {formatChecked(candidate.lastCheckedAt)}
                </span>

                <ChevronRight
                  aria-hidden
                  className="hidden size-4 shrink-0 text-muted-foreground lg:block"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
