import { Link } from "@tanstack/react-router";

import { cn } from "@/lib/utils";

/**
 * Single source of truth for Scout's local sections.
 *
 * The order is canonical and never reorders around the active view:
 * Ready · Movement · Needs a person · All · Watchlist · Settings.
 */
export type ScoutSection = "ready" | "movement" | "needs_person" | "all" | "watchlist" | "settings";

const BOARD_SECTIONS: { key: Exclude<ScoutSection, "settings">; label: string }[] = [
  { key: "ready", label: "Ready" },
  { key: "movement", label: "Movement" },
  { key: "needs_person", label: "Needs a person" },
  { key: "all", label: "All" },
  { key: "watchlist", label: "Watchlist" },
];

function tabClass(active: boolean) {
  return cn(
    "-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-foreground font-medium text-foreground"
      : "border-transparent text-muted-foreground hover:text-foreground",
  );
}

/**
 * Scout's local navigation. Every section is a real route/search state, so
 * back/forward works and both entry points land in the same place.
 */
export function ScoutTabs({ active }: { active: ScoutSection }) {
  return (
    <nav
      aria-label="Scout sections"
      className="flex flex-wrap items-center gap-1 border-b border-border pb-px"
    >
      {BOARD_SECTIONS.map((entry) => (
        <Link
          key={entry.key}
          to="/modules/scout"
          search={{ section: entry.key, fit: "all" as const }}
          aria-current={active === entry.key ? "page" : undefined}
          className={tabClass(active === entry.key)}
        >
          {entry.label}
        </Link>
      ))}
      <Link
        to="/modules/scout/settings"
        aria-current={active === "settings" ? "page" : undefined}
        className={tabClass(active === "settings")}
      >
        Settings
      </Link>
    </nav>
  );
}
