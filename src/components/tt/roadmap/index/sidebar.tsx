/**
 * Roadmap's lower rail: three counts and the driver. Nothing else.
 */

import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import type { RoadmapGlance } from "@/data/roadmap-index";

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="truncate text-[13px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[12px] text-foreground">{value}</span>
    </div>
  );
}

export function RoadmapSidebar({ glance }: { glance: RoadmapGlance }) {
  return (
    <>
      <section className="rounded-xl border border-border bg-card px-4 py-3">
        <p className="tt-eyebrow mb-2">Roadmap at a glance</p>
        <Row label="Active roadmaps" value={glance.activeRoadmaps} />
        <Row label="Needs decision" value={glance.needsDecision} />
        <Row label="Milestones in motion" value={glance.milestonesInMotion} />
      </section>

      <section className="rounded-xl border border-border bg-cloud px-4 py-3">
        <p className="tt-eyebrow mb-2">Your driver</p>
        <p className="text-[13px] leading-relaxed text-foreground">
          Turn current truth into a clear path forward. Roadmap keeps direction agreed and
          sequence honest.
        </p>
        <Link
          to="/modules/conductor"
          className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] text-royal transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Ask what needs attention
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </section>
    </>
  );
}
