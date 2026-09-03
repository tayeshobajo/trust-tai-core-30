/**
 * The right rail: useful, secondary, and never a second dashboard.
 * One ring, one trend, where attention is clustering, what changed recently,
 * and a short note on what Pulse is.
 */

import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Minus } from "lucide-react";

import {
  PULSE_AREA_LABEL,
  PULSE_SEVERITY_LABEL,
  PULSE_SEVERITY_ORDER,
  type PulseSeverity,
} from "@/domain/pulse";
import type {
  PulseAreaCount,
  PulseCounts,
  PulseRecentItem,
  PulseTrend,
} from "@/data/pulse/projection";
import { cn } from "@/lib/utils";

import { SEVERITY_TEXT } from "./severity";

const RING_STROKE: Record<PulseSeverity, string> = {
  act_now: "stroke-destructive",
  evaluate: "stroke-ember",
  watch_closely: "stroke-warning",
  good_to_know: "stroke-royal",
};

const DOT: Record<PulseSeverity, string> = {
  act_now: "bg-destructive",
  evaluate: "bg-ember",
  watch_closely: "bg-warning",
  good_to_know: "bg-royal",
};

function RailCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="tt-eyebrow mb-3">{title}</h2>
      {children}
      {footer ? <div className="mt-4">{footer}</div> : null}
    </section>
  );
}

export function PulseAtAGlance({ counts }: { counts: PulseCounts }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <RailCard title="Decisions at a glance">
      <div className="flex items-center gap-5">
        <svg viewBox="0 0 88 88" className="size-[88px] shrink-0 -rotate-90" aria-hidden>
          <circle cx="44" cy="44" r={radius} className="fill-none stroke-border" strokeWidth="9" />
          {counts.total > 0
            ? PULSE_SEVERITY_ORDER.map((severity) => {
                const share = counts[severity] / counts.total;
                const length = share * circumference;
                const dash = `${length} ${circumference - length}`;
                const element = (
                  <circle
                    key={severity}
                    cx="44"
                    cy="44"
                    r={radius}
                    className={cn("fill-none", RING_STROKE[severity])}
                    strokeWidth="9"
                    strokeDasharray={dash}
                    strokeDashoffset={-offset}
                  />
                );
                offset += length;
                return element;
              })
            : null}
        </svg>
        <div>
          <p className="text-2xl font-semibold text-foreground">{counts.total}</p>
          <p className="text-[13px] text-muted-foreground">Total signals</p>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {PULSE_SEVERITY_ORDER.map((severity) => (
          <li key={severity} className="flex items-center gap-2 text-[13px]">
            <span aria-hidden className={cn("size-2.5 rounded-[3px]", DOT[severity])} />
            <span className="text-foreground">{PULSE_SEVERITY_LABEL[severity]}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">{counts[severity]}</span>
          </li>
        ))}
      </ul>
    </RailCard>
  );
}

export function PulseTrendCard({ trend }: { trend: PulseTrend }) {
  const Icon = trend.direction === "up" ? ArrowUpRight : Minus;
  return (
    <RailCard title="Trend">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid size-8 place-items-center rounded-lg",
            trend.direction === "up" ? "bg-warning/10 text-warning" : "bg-success/10 text-success",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <p className="text-[15px] font-medium text-foreground">{trend.delta} vs last 7 days</p>
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">{trend.meaning}</p>
    </RailCard>
  );
}

export function PulseTopAreas({ areas }: { areas: PulseAreaCount[] }) {
  if (areas.length === 0) return null;
  return (
    <RailCard title="Top areas">
      <ul className="space-y-2.5">
        {areas.map((item) => (
          <li key={item.area} className="flex items-center gap-3 text-[13px]">
            <span className="text-foreground">{PULSE_AREA_LABEL[item.area]}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">{item.count}</span>
          </li>
        ))}
      </ul>
    </RailCard>
  );
}

export function PulseRecentActivity({ items }: { items: PulseRecentItem[] }) {
  if (items.length === 0) return null;
  return (
    <RailCard
      title="Recently updated"
      footer={
        <Link
          to="/modules/steward"
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-royal underline-offset-4 hover:underline"
        >
          View all activity →
        </Link>
      }
    >
      <ul className="space-y-3">
        {items.map(({ signal, ago }) => (
          <li key={signal.id} className="flex gap-2.5">
            <span
              aria-hidden
              className={cn("mt-1.5 size-2 shrink-0 rounded-[3px]", DOT[signal.severity])}
            />
            <div className="min-w-0">
              <p className="text-[13px] leading-snug text-foreground">{signal.title}</p>
              <p className={cn("text-[11px]", SEVERITY_TEXT[signal.severity])}>{ago}</p>
            </div>
          </li>
        ))}
      </ul>
    </RailCard>
  );
}

export function PulseWhatItIs() {
  return (
    <RailCard
      title="What Pulse is"
      footer={
        <Link
          to="/"
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-royal underline-offset-4 hover:underline"
        >
          Learn more about Pulse →
        </Link>
      }
    >
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Pulse surfaces the few signals with the highest impact on outcomes. It reads Projects,
        Comms, Roadmap, Scout, Ops and Steward. Always traceable. Never random.
      </p>
    </RailCard>
  );
}

export function PulseRightRail({
  counts,
  trend,
  areas,
  recent,
}: {
  counts: PulseCounts;
  trend: PulseTrend;
  areas: PulseAreaCount[];
  recent: PulseRecentItem[];
}) {
  return (
    <aside aria-label="Pulse summary" className="space-y-4">
      <PulseAtAGlance counts={counts} />
      <PulseTrendCard trend={trend} />
      <PulseTopAreas areas={areas} />
      <PulseRecentActivity items={recent} />
      <PulseWhatItIs />
    </aside>
  );
}
