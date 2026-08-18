/**
 * Roadmap page header: who we are building paths for, and the two ways to
 * start one. Three counts only, orientation, not analytics.
 */

import { Binoculars, Flag, HelpCircle, Plus } from "lucide-react";

import { TTButton } from "@/components/tt/primitives";
import type { RoadmapGlance } from "@/data/roadmap-index";

function Metric({
  icon,
  tone,
  value,
  label,
}: {
  icon: React.ReactNode;
  tone: string;
  value: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span
        aria-hidden
        className={`flex size-8 shrink-0 items-center justify-center rounded-full ${tone}`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-mono text-[17px] leading-none text-foreground">{value}</span>
        <span className="mt-1 block truncate text-[12px] text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

export function RoadmapHeader({
  glance,
  onBuildFromScout,
  onCreate,
}: {
  glance: RoadmapGlance;
  onBuildFromScout: () => void;
  onCreate: () => void;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-7 sm:px-8">
      {/* A quiet A-to-B wash; never louder than the words. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in oklab, var(--royal) 6%, transparent) 0%, transparent 190px)",
        }}
      />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="tt-eyebrow text-royal">Roadmap</p>
          <h1 className="mt-2 max-w-xl font-display text-3xl leading-tight text-foreground sm:text-4xl">
            Point A to Point B, company by company.
          </h1>
          <p className="mt-3 max-w-xl text-[15px] text-muted-foreground">
            Build the path from where the company is to where it should go next.
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
          <TTButton onClick={onBuildFromScout}>
            <Binoculars aria-hidden />
            Build from Scout
          </TTButton>
          <TTButton variant="secondary" onClick={onCreate}>
            <Plus aria-hidden />
            Create roadmap
          </TTButton>
        </div>
      </div>

      <div className="relative mt-6 grid gap-3 sm:grid-cols-3 lg:max-w-2xl">
        <Metric
          icon={<Binoculars className="size-4 text-royal" aria-hidden />}
          tone="bg-royal/10"
          value={glance.activeRoadmaps}
          label="Active roadmaps"
        />
        <Metric
          icon={<HelpCircle className="size-4 text-warning" aria-hidden />}
          tone="bg-warning/10"
          value={glance.needsDecision}
          label="Needs decision"
        />
        <Metric
          icon={<Flag className="size-4 text-success" aria-hidden />}
          tone="bg-success/10"
          value={glance.milestonesInMotion}
          label="Milestones in motion"
        />
      </div>
    </section>
  );
}
