/**
 * Scout's right support rail: the board at a glance, and one calm way out to
 * the Conductor when the next move isn't obvious. Counts come from the same
 * derived glance the page already computes — nothing new is invented here.
 */

import { Link } from "@tanstack/react-router";
import { ArrowRight, Sparkles } from "lucide-react";

import type { ScoutGlance } from "@/components/tt/scout/sidebar";

function share(value: number, total: number): string | null {
  if (!total) return null;
  return `${Math.round((value / total) * 100)}% of total`;
}

function GlanceCard({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: string;
}) {
  const pct = share(value, total);
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${tone}`} />
          <span className="truncate text-[13px] text-foreground">{label}</span>
        </span>
        <span className="shrink-0 font-mono text-[15px] text-foreground">{value}</span>
      </div>
      {pct ? <p className="mt-1 pl-3.5 text-[11px] text-muted-foreground">{pct}</p> : null}
    </div>
  );
}

export function ScoutSupportRail({ glance }: { glance: ScoutGlance }) {
  const total = glance.onBoard;
  return (
    <aside className="hidden w-[300px] shrink-0 space-y-3 xl:block" aria-label="Scout support">
      <p className="tt-eyebrow px-1">Scout at a glance</p>
      <GlanceCard label="Qualified" value={glance.qualified} total={total} tone="bg-success" />
      <GlanceCard label="In ICP" value={glance.inIcp} total={total} tone="bg-royal" />
      <GlanceCard
        label="High potential"
        value={glance.highPotential}
        total={total}
        tone="bg-warning"
      />
      <GlanceCard
        label="Needs review"
        value={glance.needsReview}
        total={total}
        tone="bg-destructive"
      />

      <section className="rounded-xl border border-border bg-cloud px-4 py-4">
        <div className="flex items-start gap-2.5">
          <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-royal" />
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-foreground">Need guidance?</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Review the ICP settings, or ask Conductor what deserves attention next.
            </p>
            <Link
              to="/modules/conductor"
              className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] text-royal transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open Conductor
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </aside>
  );
}
