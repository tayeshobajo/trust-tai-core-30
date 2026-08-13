import { Link } from "@tanstack/react-router";

import { cn } from "@/lib/utils";

export type CommsSection = "relationships" | "voice";

function tabClass(active: boolean) {
  return cn(
    "-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-foreground font-medium text-foreground"
      : "border-transparent text-muted-foreground hover:text-foreground",
  );
}

/** Comms' local navigation. Two rooms only: the people, and how Tai sounds. */
export function CommsTabs({ active }: { active: CommsSection }) {
  return (
    <nav
      aria-label="Comms sections"
      className="flex flex-wrap items-center gap-1 border-b border-border pb-px"
    >
      <Link
        to="/modules/comms"
        aria-current={active === "relationships" ? "page" : undefined}
        className={tabClass(active === "relationships")}
      >
        Relationships
      </Link>
      <Link
        to="/modules/comms/voice"
        aria-current={active === "voice" ? "page" : undefined}
        className={tabClass(active === "voice")}
      >
        Voice DNA
      </Link>
    </nav>
  );
}
