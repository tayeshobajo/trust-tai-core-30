/**
 * Scout's lower rail: a glance at the board, the driver's current concern, and
 * the settings utility action. Deliberately short — the rail orients, the page
 * does the work.
 */

import { Link } from "@tanstack/react-router";
import { Settings2 } from "lucide-react";

export interface ScoutGlance {
  onBoard: number;
  qualified: number;
  inIcp: number;
  highPotential: number;
  needsReview: number;
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="truncate text-[13px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[12px] text-foreground">{value}</span>
    </div>
  );
}

export function ScoutSidebar({ glance, driverLine }: { glance: ScoutGlance; driverLine: string }) {
  return (
    <>
      <section className="rounded-xl border border-border bg-card px-4 py-3">
        <p className="tt-eyebrow mb-2">Scout at a glance</p>
        <Row label="Companies on board" value={glance.onBoard} />
        <Row label="Qualified" value={glance.qualified} />
        <Row label="In ICP" value={glance.inIcp} />
        <Row label="High potential" value={glance.highPotential} />
        <Row label="Needs review" value={glance.needsReview} />
      </section>

      <section className="rounded-xl border border-border bg-cloud px-4 py-3">
        <p className="tt-eyebrow mb-2">Your driver</p>
        <p className="text-[13px] leading-relaxed text-foreground">{driverLine}</p>
      </section>

      <Link
        to="/modules/scout/settings"
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Settings2 aria-hidden className="size-4" />
        Scout settings
      </Link>
    </>
  );
}
