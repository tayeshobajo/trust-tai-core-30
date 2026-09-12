/**
 * MOCKUP ONLY — presentation pieces for the isolated Pulse Next prototype.
 *
 * These components are local to `/mockups/pulse-next`. They import no
 * production Pulse component, no service, and no business logic.
 */

import { useState } from "react";

import {
  DEMO_BUSINESS,
  DEMO_MOVEMENT,
  DEMO_QUEUE,
  DEMO_SIGNALS,
  SEVERITY_LABEL,
  SEVERITY_MEANING,
  SEVERITY_ORDER,
  type DemoQueueItem,
  type DemoSeverity,
  type DemoSignal,
} from "@/data/mockups/pulse-next";
import { cn } from "@/lib/utils";

/* ------------------------------- severity ------------------------------- */

const SEVERITY_DOT: Record<DemoSeverity, string> = {
  act_now: "bg-destructive",
  evaluate: "bg-warning",
  watch_closely: "bg-royal",
  good_to_know: "bg-muted-foreground/50",
};

const SEVERITY_TEXT: Record<DemoSeverity, string> = {
  act_now: "text-destructive",
  evaluate: "text-warning",
  watch_closely: "text-royal",
  good_to_know: "text-muted-foreground",
};

/* -------------------------------- header -------------------------------- */

export function PulseNextHeader() {
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b border-border pb-6">
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-royal">Pulse</p>
        <h1 className="tt-display mt-2 max-w-[24ch] text-[26px] text-foreground sm:text-[30px]">
          What deserves your attention right now.
        </h1>
        <p className="mt-2 max-w-reading text-sm text-muted-foreground">
          Pulse reads across every room, keeps the few things that matter, and sends each one back
          to whoever owns the work.
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs text-muted-foreground">Read 4 minutes ago</p>
        <div className="mt-2 flex items-center justify-end gap-2">
          <MockControl>Refresh</MockControl>
          <MockControl>Share</MockControl>
        </div>
      </div>
    </header>
  );
}

function MockControl({ children }: { children: string }) {
  return (
    <button
      type="button"
      title="Prototype control — not wired"
      className="rounded-full border border-border bg-card px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </button>
  );
}

/* ------------------------------- needs tai ------------------------------ */

export function NeedsTai() {
  const [cleared, setCleared] = useState<string[]>([]);
  const live = DEMO_QUEUE.filter((item) => !cleared.includes(item.id));

  return (
    <section aria-labelledby="needs-tai" className="rounded-2xl border border-border bg-card">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 id="needs-tai" className="tt-display text-[19px] text-foreground">
            Needs you
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Four things cannot move without a decision from you.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-foreground px-2.5 py-1 text-[12px] font-medium text-background">
          {live.length}
        </span>
      </div>

      <ol className="divide-y divide-border">
        {live.map((item) => (
          <QueueRow key={item.id} item={item} onClear={() => setCleared((c) => [...c, item.id])} />
        ))}
      </ol>

      {live.length === 0 ? (
        <p className="px-6 py-8 text-sm text-muted-foreground">
          Nothing is waiting on you. The work is moving without a decision.
        </p>
      ) : null}
    </section>
  );
}

function QueueRow({ item, onClear }: { item: DemoQueueItem; onClear: () => void }) {
  return (
    <li className="px-5 py-5 sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="text-[12px] font-medium text-royal">{item.room}</span>
            <span aria-hidden className="text-muted-foreground/50">
              ·
            </span>
            <span className="truncate text-[12px] text-muted-foreground">{item.entity}</span>
            <span aria-hidden className="text-muted-foreground/50">
              ·
            </span>
            <span className="text-[12px] text-muted-foreground">{item.age}</span>
          </div>

          <h3 className="mt-1.5 text-[16px] font-semibold leading-snug text-foreground">
            {item.headline}
          </h3>
          <p className="mt-1.5 max-w-reading text-[13px] leading-relaxed text-muted-foreground">
            {item.implication}
          </p>
          <p className="mt-1.5 max-w-reading text-[13px] leading-relaxed text-foreground/75">
            If ignored: {item.consequence}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3 lg:flex-col lg:items-end">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {item.leverage}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Prototype control — not wired"
              className="rounded-full bg-royal px-4 py-2 text-[13px] font-medium text-primary-foreground"
            >
              {item.action}
            </button>
            <button
              type="button"
              onClick={onClear}
              className="rounded-full px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

/* ----------------------------- business read ---------------------------- */

export function BusinessRead() {
  return (
    <section aria-labelledby="business-read" className="rounded-2xl bg-studio-paper px-5 py-5 sm:px-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
        <h2 id="business-read" className="text-[15px] font-semibold text-foreground">
          Where the business actually stands
        </h2>
        <p className="shrink-0 text-[12px] text-muted-foreground">Week to date</p>
      </div>

      <dl className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
        {DEMO_BUSINESS.map((metric) => (
          <div key={metric.label} className="min-w-0">
            <dt className="text-[12px] text-muted-foreground">{metric.label}</dt>
            <dd
              className={cn(
                "mt-1 text-[20px] font-semibold leading-tight",
                metric.unknown ? "text-warning" : "text-foreground",
              )}
            >
              {metric.value}
            </dd>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{metric.read}</p>
          </div>
        ))}
      </dl>

      <p className="mt-5 border-t border-border pt-4 text-[13px] leading-relaxed text-foreground/80">
        The month is healthy on revenue and weak on outreach. Clearing the reply backlog and
        approving the waiting intros is worth more this week than any new activity.
      </p>
    </section>
  );
}

/* ------------------------------ signal field ---------------------------- */

export function SignalField() {
  const [filter, setFilter] = useState<DemoSeverity | "all">("all");
  const visible = DEMO_SIGNALS.filter((s) => filter === "all" || s.severity === filter);

  return (
    <section aria-labelledby="noticed" className="min-w-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
        <h2 id="noticed" className="text-[15px] font-semibold text-foreground">
          What the system noticed
        </h2>
        <p className="shrink-0 text-[12px] text-muted-foreground">
          {DEMO_SIGNALS.length} signals · mostly awareness
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
          All
        </FilterPill>
        {SEVERITY_ORDER.map((severity) => (
          <FilterPill
            key={severity}
            active={filter === severity}
            onClick={() => setFilter(severity)}
          >
            {SEVERITY_LABEL[severity]}
          </FilterPill>
        ))}
      </div>

      <div className="mt-5 space-y-6">
        {SEVERITY_ORDER.map((severity) => {
          const rows = visible.filter((s) => s.severity === severity);
          if (rows.length === 0) return null;
          return (
            <div key={severity}>
              <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
                <span aria-hidden className={cn("size-1.5 rounded-full", SEVERITY_DOT[severity])} />
                <h3 className={cn("text-[13px] font-medium", SEVERITY_TEXT[severity])}>
                  {SEVERITY_LABEL[severity]}
                </h3>
                <span className="text-[12px] text-muted-foreground">{rows.length}</span>
                <p className="hidden truncate text-[12px] text-muted-foreground sm:block">
                  {SEVERITY_MEANING[severity]}
                </p>
              </div>
              <ul className="divide-y divide-border">
                {rows.map((signal) => (
                  <SignalRow key={signal.id} signal={signal} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[12px] transition-colors",
        active
          ? "border-foreground/20 bg-foreground text-background"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function SignalRow({ signal }: { signal: DemoSignal }) {
  return (
    <li className="grid gap-2 py-3.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-6">
      <div className="min-w-0">
        <p className="text-[14px] leading-snug text-foreground">{signal.observed}</p>
        <p className="mt-1 max-w-reading text-[13px] leading-relaxed text-muted-foreground">
          <span className="text-foreground/70">Pulse reads this as:</span> {signal.read}
        </p>
        <p className="mt-1.5 truncate text-[12px] text-muted-foreground">
          {signal.room} · {signal.entity}
        </p>
      </div>
      <button
        type="button"
        title="Prototype control — not wired"
        className="justify-self-start whitespace-nowrap rounded-full border border-border bg-card px-3.5 py-1.5 text-[12px] text-foreground transition-colors hover:bg-secondary lg:justify-self-end"
      >
        {signal.action}
      </button>
    </li>
  );
}

/* ------------------------------- movement ------------------------------- */

export function RecentMovement() {
  return (
    <section aria-labelledby="movement" className="min-w-0">
      <h2 id="movement" className="text-[15px] font-semibold text-foreground">
        Recent movement
      </h2>
      <p className="mt-1 text-[12px] text-muted-foreground">
        What changed on its own, without needing you.
      </p>
      <ul className="mt-4 space-y-3.5 border-l border-border pl-4">
        {DEMO_MOVEMENT.map((entry) => (
          <li key={entry.id} className="relative">
            <span
              aria-hidden
              className="absolute -left-[21px] top-2 size-1.5 rounded-full bg-border"
            />
            <p className="text-[13px] leading-snug text-foreground">{entry.what}</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {entry.when} · {entry.room}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-5 border-t border-border pt-4 text-[12px] leading-relaxed text-muted-foreground">
        Pulse only shows what deserves attention. Every action here opens the room that owns the
        work.
      </p>
    </section>
  );
}
