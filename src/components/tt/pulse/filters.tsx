/**
 * Filter pills. Each pill wears the colour of the level it selects, so the
 * filter row repeats the same language as the groups below it.
 */

import { Filter } from "lucide-react";

import { PULSE_SEVERITY_LABEL, PULSE_SEVERITY_ORDER, type PulseSeverity } from "@/domain/pulse";
import type { PulseCounts } from "@/data/pulse/projection";
import { cn } from "@/lib/utils";

import { SEVERITY_BORDER, SEVERITY_SURFACE, SEVERITY_TEXT } from "./severity";

export type PulseFilter = PulseSeverity | "all";

export function PulseFilters({
  counts,
  active,
  onChange,
  rooms,
  room,
  onRoomChange,
}: {
  counts: PulseCounts;
  active: PulseFilter;
  onChange: (next: PulseFilter) => void;
  rooms: { id: string; label: string }[];
  room: string | "all";
  onRoomChange: (next: string | "all") => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={active === "all"}
        onClick={() => onChange("all")}
        className={cn(
          "rounded-full border px-3.5 py-1.5 text-[13px] transition-colors",
          active === "all"
            ? "border-transparent bg-primary text-primary-foreground"
            : "border-border bg-card text-foreground hover:bg-secondary",
        )}
      >
        All {counts.total}
      </button>

      {PULSE_SEVERITY_ORDER.map((severity) => {
        const selected = active === severity;
        return (
          <button
            key={severity}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? "all" : severity)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[13px] transition-colors",
              SEVERITY_TEXT[severity],
              SEVERITY_BORDER[severity],
              selected ? SEVERITY_SURFACE[severity] : "bg-card hover:bg-secondary",
            )}
          >
            {PULSE_SEVERITY_LABEL[severity]} {counts[severity]}
          </button>
        );
      })}

      {rooms.length > 1 ? (
        <label className="ml-1 flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[13px] text-muted-foreground">
          <Filter className="size-3.5" aria-hidden />
          <span className="sr-only">Filter by room</span>
          <select
            value={room}
            onChange={(event) => onRoomChange(event.target.value)}
            className="bg-transparent text-[13px] text-foreground focus:outline-none"
          >
            <option value="all">Add filter</option>
            {rooms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
