import { Link } from "@tanstack/react-router";

import { cn } from "@/lib/utils";

/** Single source of truth for Roadmap's local sections. */
export type RoadmapView =
  "overview" | "milestones" | "evidence" | "decisions" | "exports" | "activity";

export const ROADMAP_VIEWS: { key: RoadmapView; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "milestones", label: "Milestones" },
  { key: "evidence", label: "Evidence" },
  { key: "decisions", label: "Decisions" },
  { key: "exports", label: "Exports" },
  { key: "activity", label: "Activity" },
];

export function isRoadmapView(value: unknown): value is RoadmapView {
  return ROADMAP_VIEWS.some((view) => view.key === value);
}

/**
 * Roadmap's local navigation. One roadmap, read from different distances:
 * what is true, what it means, what we would build, and what was decided.
 */
export function RoadmapTabs({ roadmapId, view }: { roadmapId: string; view: RoadmapView }) {
  return (
    <nav aria-label="Roadmap sections" className="border-b border-border">
      <ul className="flex flex-wrap items-center gap-1">
        {ROADMAP_VIEWS.map((entry) => (
          <li key={entry.key}>
            <Link
              to="/modules/roadmap/$roadmapId"
              params={{ roadmapId }}
              search={{ view: entry.key }}
              className={cn(
                "-mb-px block border-b-2 px-4 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                view === entry.key
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
