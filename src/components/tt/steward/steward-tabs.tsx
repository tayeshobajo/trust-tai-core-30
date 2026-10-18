import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type StewardSection =
  "team" | "meetings" | "tasks" | "agents" | "scouts" | "ai" | "timeline" | "memory";

function tabClass(active: boolean) {
  return cn(
    "-mb-px border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-foreground font-medium text-foreground"
      : "border-transparent text-muted-foreground hover:text-foreground",
  );
}

const MORE: { section: StewardSection; label: string; to: string }[] = [
  { section: "meetings", label: "Meetings", to: "/modules/steward/meetings" },
  { section: "tasks", label: "Tasks", to: "/modules/steward/tasks" },
  { section: "agents", label: "Agents", to: "/modules/steward/agents" },
  { section: "scouts", label: "Scouts", to: "/modules/steward/scouts" },
  { section: "ai", label: "Trust Tai AI", to: "/modules/steward/ai" },
  { section: "timeline", label: "Timeline", to: "/modules/steward/timeline" },
  { section: "memory", label: "Memory", to: "/modules/steward/memory" },
];

/**
 * Steward's compact navigation. The meeting workroom is the first page; Team
 * sits beside it; the rest live under More so the workspace stays spacious.
 */
export function StewardTabs({ active }: { active: StewardSection }) {
  const moreActive = MORE.some((item) => item.section === active);
  const activeLabel = MORE.find((item) => item.section === active)?.label;
  return (
    <nav
      aria-label="Steward sections"
      className="flex flex-wrap items-center gap-1 border-b border-border pb-px"
    >
      <Link
        to="/modules/steward"
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
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(tabClass(moreActive), "inline-flex items-center gap-1")}
          aria-current={moreActive ? "page" : undefined}
        >
          {activeLabel ?? "More"}
          <ChevronDown aria-hidden className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {MORE.map((item) => (
            <DropdownMenuItem key={item.section} asChild>
              <Link to={item.to}>{item.label}</Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
