/**
 * Sidebar context for the Conductor: the shape of the room in five numbers,
 * and one line saying what it is for. No controls, the sidebar orients, it
 * does not operate.
 */

import type { ConductorGlance } from "./capabilities";

export function ConductorSidebar({ glance }: { glance: ConductorGlance }) {
  const rows: { label: string; value: number }[] = [
    { label: "Recommendations", value: glance.recommendations },
    { label: "Authorisations today", value: glance.authorizations },
    { label: "Executing", value: glance.executing },
    { label: "Waiting", value: glance.waiting },
    { label: "Completed", value: glance.completed },
  ];

  return (
    <>
      <section className="rounded-xl border border-sidebar-border bg-card p-3.5">
        <h2 className="tt-eyebrow mb-2.5">Conductor at a glance</h2>
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center gap-2 text-[13px]">
              <span className="truncate text-muted-foreground">{row.label}</span>
              <span className="ml-auto tabular-nums text-foreground">{row.value}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-sidebar-border bg-card p-3.5">
        <h2 className="tt-eyebrow mb-2">What Conductor does</h2>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          It reads every room, says what it makes of them, and asks you before anything
          consequential moves. The room that owns the change still carries it out.
        </p>
        <a
          href="#conductor-boundaries"
          className="mt-2.5 inline-block text-[12px] text-royal underline underline-offset-4"
        >
          View capabilities
        </a>
      </section>
    </>
  );
}
