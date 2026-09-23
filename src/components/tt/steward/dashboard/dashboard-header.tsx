/**
 * Identity header for the per-person Steward dashboard.
 *
 * Self shows a person's own operating view; team shows the same identity, but
 * says plainly it is a status-only view of a teammate's week.
 */

import type { DashboardIdentity } from "@/data/steward/dashboard-read";

function weekLabelOf(nowISO: string): string {
  const date = new Date(nowISO);
  if (Number.isNaN(date.getTime())) return "";
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const days = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
  const week = Math.ceil((days + start.getUTCDay() + 1) / 7);
  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${dateLabel} · Week ${week}`;
}

export function DashboardHeader({
  identity,
  now,
  scope,
}: {
  identity: DashboardIdentity;
  now: string;
  scope: "self" | "team";
}) {
  return (
    <header className="tt-rise flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-border bg-card px-5 py-5 sm:px-6">
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-royal/25 bg-royal/8 font-display text-lg text-royal"
        >
          {identity.initials}
          <span
            aria-hidden
            className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-card bg-success"
          />
        </span>
        <div>
          <p className="tt-eyebrow">Your dashboard</p>
          <h1 className="mt-1 font-display text-2xl leading-tight text-foreground">
            {identity.name}
          </h1>
          {identity.role ? (
            <p className="mt-1 text-sm text-muted-foreground">{identity.role}</p>
          ) : null}
        </div>
      </div>

      <div className="border-l border-border pl-6 text-left sm:text-right">
        <p className="text-sm text-muted-foreground">
          {scope === "self"
            ? "Your operating view for this week."
            : `Viewing as teammate. Status only.`}
        </p>
        {scope === "self" ? (
          <p className="text-sm text-muted-foreground">Same mission. More momentum.</p>
        ) : null}
        <p className="mt-2 inline-flex items-center rounded-full border border-border bg-secondary px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {weekLabelOf(now)}
        </p>
      </div>
    </header>
  );
}
