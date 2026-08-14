import { Link } from "@tanstack/react-router";

import { cn } from "@/lib/utils";

export type StewardSection = "today" | "meetings" | "team" | "memory";

function tabClass(active: boolean) {
  return cn(
    "-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-foreground font-medium text-foreground"
      : "border-transparent text-muted-foreground hover:text-foreground",
  );
}

/** Steward has four surfaces. There is no fifth. */
export function StewardTabs({ active }: { active: StewardSection }) {
  return (
    <nav
      aria-label="Steward sections"
      className="flex flex-wrap items-center gap-1 border-b border-border pb-px"
    >
      <Link to="/modules/steward" aria-current={active === "today" ? "page" : undefined} className={tabClass(active === "today")}>
        Today
      </Link>
      <Link
        to="/modules/steward/meetings"
        aria-current={active === "meetings" ? "page" : undefined}
        className={tabClass(active === "meetings")}
      >
        Meetings
      </Link>
      <Link
        to="/modules/steward/team"
        aria-current={active === "team" ? "page" : undefined}
        className={tabClass(active === "team")}
      >
        Team
      </Link>
      <Link
        to="/modules/steward/memory"
        aria-current={active === "memory" ? "page" : undefined}
        className={tabClass(active === "memory")}
      >
        Memory
      </Link>
    </nav>
  );
}
