/**
 * Sidebar context for Pulse: the same four counts, plus the one line that says
 * what this room is for.
 */

import { PULSE_SEVERITY_LABEL, PULSE_SEVERITY_ORDER } from "@/domain/pulse";
import type { PulseCounts } from "@/data/pulse/projection";
import { cn } from "@/lib/utils";

import { SEVERITY_TEXT } from "./severity";

export function PulseSidebar({ counts }: { counts: PulseCounts }) {
  return (
    <>
      <section className="rounded-xl border border-sidebar-border bg-card p-3.5">
        <h2 className="tt-eyebrow mb-2.5">Pulse at a glance</h2>
        <ul className="space-y-1.5">
          {PULSE_SEVERITY_ORDER.map((severity) => (
            <li key={severity} className="flex items-center gap-2 text-[13px]">
              <span className={cn("truncate", SEVERITY_TEXT[severity])}>
                {PULSE_SEVERITY_LABEL[severity]}
              </span>
              <span className="ml-auto tabular-nums text-muted-foreground">{counts[severity]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-border pt-2.5 text-[12px] text-muted-foreground">
          {counts.total} total signal{counts.total === 1 ? "" : "s"}
        </p>
      </section>

      <section className="rounded-xl border border-sidebar-border bg-card p-3.5">
        <h2 className="tt-eyebrow mb-2">Your driver</h2>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Focus on the few signals that change the outcome. Pulse surfaces what matters most right
          now.
        </p>
      </section>
    </>
  );
}
