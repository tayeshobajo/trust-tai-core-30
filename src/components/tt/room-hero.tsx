/**
 * Shared room hero.
 *
 * Structural and visual sibling of the Roadmap index header: one boxed band,
 * a quiet royal wash entering from the top, mono eyebrow, serif statement,
 * one supporting line, the room's actions on the right, and a compact metric
 * row inside the same box.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface RoomHeroMetric {
  icon?: ReactNode;
  tone?: string;
  value: string | number;
  label: string;
  note?: string;
}

function Metric({ icon, tone, value, label, note }: RoomHeroMetric) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      {icon ? (
        <span
          aria-hidden
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            tone ?? "bg-royal/10",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0">
        <span className="block font-mono text-[17px] leading-none text-foreground">{value}</span>
        <span className="mt-1 block truncate text-[12px] text-muted-foreground">{label}</span>
        {note ? (
          <span className="block truncate text-[11px] text-muted-foreground">{note}</span>
        ) : null}
      </span>
    </div>
  );
}

export function RoomHero({
  eyebrow,
  title,
  supporting,
  actions,
  metrics,
  metricsClassName,
  footer,
  className,
}: {
  eyebrow: string;
  title: string;
  supporting?: string;
  actions?: ReactNode;
  metrics?: RoomHeroMetric[];
  metricsClassName?: string;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-7 sm:px-8",
        className,
      )}
    >
      {/* A quiet wash; never louder than the words. */}
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
          <p className="tt-eyebrow text-royal">{eyebrow}</p>
          <h1 className="mt-2 max-w-xl font-display text-3xl leading-tight text-foreground sm:text-4xl">
            {title}
          </h1>
          {supporting ? (
            <p className="mt-3 max-w-xl text-[15px] text-muted-foreground">{supporting}</p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">{actions}</div>
        ) : null}
      </div>

      {metrics && metrics.length > 0 ? (
        <div
          className={cn(
            "relative mt-6 grid gap-3 sm:grid-cols-2",
            metrics.length === 3 ? "sm:grid-cols-3 lg:max-w-2xl" : "xl:grid-cols-4",
            metricsClassName,
          )}
        >
          {metrics.map((metric) => (
            <Metric key={metric.label} {...metric} />
          ))}
        </div>
      ) : null}

      {footer ? <div className="relative mt-4">{footer}</div> : null}
    </section>
  );
}
