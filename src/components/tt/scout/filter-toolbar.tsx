/**
 * Scout search + compact filters. Every option is drawn from what is actually
 * on the board, so a filter never offers a value no company has.
 */

import { Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { SCORE_BANDS, type ScoutTableFilters } from "@/data/scout-table";
import { cn } from "@/lib/utils";

const FIT_OPTIONS: { value: ScoutTableFilters["fit"]; label: string }[] = [
  { value: "all", label: "Any ICP match" },
  { value: "green", label: "Strong fit" },
  { value: "yellow", label: "Mixed fit" },
  { value: "red", label: "Poor fit" },
  { value: "neutral", label: "Not scored" },
];

const selectClass =
  "h-9 min-w-0 rounded-lg border border-input bg-card px-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Select({
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  allLabel: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="contents">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={selectClass}
        disabled={options.length === 0}
      >
        <option value="all">{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ScoutFilterToolbar({
  filters,
  industries,
  locations,
  sizes,
  onChange,
}: {
  filters: ScoutTableFilters;
  industries: string[];
  locations: string[];
  sizes: string[];
  onChange: (next: ScoutTableFilters) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const set = (patch: Partial<ScoutTableFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            aria-label="Search companies"
            value={filters.search}
            onChange={(event) => set({ search: event.target.value })}
            placeholder="Search companies by name, industry, keyword..."
            className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <Select
          label="Industry"
          allLabel="Industry"
          value={filters.industry}
          options={industries}
          onChange={(industry) => set({ industry })}
        />
        <Select
          label="Location"
          allLabel="Location"
          value={filters.location}
          options={locations}
          onChange={(location) => set({ location })}
        />

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-[13px] transition-colors",
            expanded ? "bg-secondary text-foreground" : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          <SlidersHorizontal aria-hidden className="size-4" />
          More filters
        </button>
      </div>

      {expanded ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Select
            label="Company size"
            allLabel="Company size"
            value={filters.size}
            options={sizes}
            onChange={(size) => set({ size })}
          />
          <label className="contents">
            <span className="sr-only">Score</span>
            <select
              aria-label="Score"
              value={filters.score}
              onChange={(event) =>
                set({ score: event.target.value as ScoutTableFilters["score"] })
              }
              className={selectClass}
            >
              {SCORE_BANDS.map((band) => (
                <option key={band.key} value={band.key}>
                  {band.label}
                </option>
              ))}
            </select>
          </label>
          <label className="contents">
            <span className="sr-only">ICP match</span>
            <select
              aria-label="ICP match"
              value={filters.fit}
              onChange={(event) => set({ fit: event.target.value as ScoutTableFilters["fit"] })}
              className={selectClass}
            >
              {FIT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}
