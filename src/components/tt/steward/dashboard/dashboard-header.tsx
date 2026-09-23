/**
 * Identity header for the per-person Steward dashboard.
 *
 * Self shows a person's own operating view; team shows the same identity, but
 * says plainly it is a status-only view of a teammate's week.
 */

import { CalendarDays } from "lucide-react";

import type { DashboardIdentity } from "@/data/steward/dashboard-read";

function datePartsOf(nowISO: string): { date: string; week: string } {
  const date = new Date(nowISO);
  if (Number.isNaN(date.getTime())) return { date: "", week: "" };
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const days = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
  const week = Math.ceil((days + start.getUTCDay() + 1) / 7);
  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return { date: dateLabel, week: `Week ${week}` };
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
  const date = datePartsOf(now);
  return (
    <header className="tt-rise grid gap-5 rounded-xl border border-border bg-card px-5 py-4 md:grid-cols-[1.25fr_1fr_auto] md:items-center md:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <span
          aria-hidden
          className="relative flex size-12 shrink-0 items-center justify-center rounded-full border border-royal/20 bg-royal/8 font-display text-base font-semibold text-foreground"
        >
          {identity.initials}
          <span
            aria-hidden
            className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-card bg-success"
          />
        </span>
        <div className="min-w-0">
          <p className="tt-eyebrow">Your dashboard</p>
          <h1 className="mt-1 truncate font-display text-xl font-semibold leading-tight text-foreground">
            {identity.name}
          </h1>
          {identity.role ? (
            <p className="mt-1 text-sm text-muted-foreground">{identity.role}</p>
          ) : null}
        </div>
      </div>

      <div className="border-border md:border-l md:px-6">
        <p className="text-sm font-medium text-foreground">
          {scope === "self"
            ? "Your operating view for this week."
            : `Viewing as teammate. Status only.`}
        </p>
        {scope === "self" ? (
          <p className="text-sm text-muted-foreground">Same mission. More momentum.</p>
        ) : null}
      </div>
      <div className="flex items-center gap-3 border-border md:border-l md:pl-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-royal/8 text-royal">
          <CalendarDays aria-hidden className="size-4" />
        </span>
        <div className="text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{date.date}</p>
          <p className="mt-0.5">{date.week}</p>
        </div>
      </div>
    </header>
  );
}
