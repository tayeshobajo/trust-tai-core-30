import { Link } from "@tanstack/react-router";

import { cn } from "@/lib/utils";

export type CommsSection = "relationships" | "voice" | "integrations";

/**
 * Underline tabs, mockup geometry: 40px rows, a 2px royal rule under the
 * current section, and a single hairline running the full width beneath.
 */
function tabClass(active: boolean) {
  return cn(
    "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-[var(--royal)] font-medium text-foreground"
      : "border-transparent text-muted-foreground hover:border-[var(--cloud-line)] hover:text-foreground",
  );
}

const TABS: { to: string; section: CommsSection; label: string }[] = [
  { to: "/modules/comms", section: "relationships", label: "Relationships" },
  { to: "/modules/comms/voice", section: "voice", label: "Voice DNA" },
  { to: "/modules/comms/integrations", section: "integrations", label: "Connections" },
];

/** Comms' local navigation: the people, how Tai sounds, and what we read from. */
export function CommsTabs({ active }: { active: CommsSection }) {
  return (
    <nav
      aria-label="Comms sections"
      className="flex flex-wrap items-center gap-5 border-b border-border pb-px"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.section}
          to={tab.to}
          aria-current={active === tab.section ? "page" : undefined}
          className={tabClass(active === tab.section)}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
