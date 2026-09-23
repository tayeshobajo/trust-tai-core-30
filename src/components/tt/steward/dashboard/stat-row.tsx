/**
 * The four stat cards: streak, level and XP, tasks completed, time saved.
 *
 * Every number is passed in already computed by the pure functions in
 * src/domain/steward-dashboard-stats.ts. This component only renders what it
 * is given, so an empty history renders honest zeros without any special
 * casing here. Team scope sees the same cards; the numbers are non-sensitive
 * status, only titles and actions are hidden elsewhere.
 */

import { ChevronRight, Flame, BarChart3, CheckCircle2, Clock } from "lucide-react";
import type { ReactNode } from "react";

import type { LevelInfo, TasksCompleted } from "@/domain/steward-dashboard-stats";
import { cn } from "@/lib/utils";

function StatCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="flex min-h-20 items-center gap-3 rounded-xl border border-border bg-card p-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-royal/8 text-royal">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-base font-semibold text-foreground">{value}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
        {detail ? <div className="mt-1.5">{detail}</div> : null}
      </div>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-royal" />
    </div>
  );
}

function XpBar({ level }: { level: LevelInfo }) {
  const pct =
    level.xpForLevel > 0 ? Math.min(100, Math.round((level.xpIntoLevel / level.xpForLevel) * 100)) : 100;
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-royal transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {level.xpIntoLevel} / {level.xpForLevel} XP
      </p>
    </div>
  );
}

export function StatRow({
  streakDays,
  level,
  tasksCompleted,
  minutesSaved,
}: {
  streakDays: number;
  level: LevelInfo;
  tasksCompleted: TasksCompleted;
  minutesSaved: number;
}) {
  const hoursSaved = minutesSaved / 60;
  const timeSavedLabel =
    minutesSaved <= 0
      ? "0h"
      : hoursSaved >= 1
        ? `${Math.round(hoursSaved * 10) / 10}h`
        : `${minutesSaved}m`;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={<Flame aria-hidden className="size-5" />}
        label="Current streak"
        value={`${streakDays} day${streakDays === 1 ? "" : "s"}`}
      />
      <StatCard
        icon={<BarChart3 aria-hidden className="size-5" />}
        label={level.label}
        value={`Level ${level.level}`}
        detail={<XpBar level={level} />}
      />
      <StatCard
        icon={<CheckCircle2 aria-hidden className="size-5" />}
        label="Tasks completed"
        value={`${tasksCompleted.done}/${tasksCompleted.total}`}
      />
      <StatCard
        icon={<Clock aria-hidden className="size-5" />}
        label="Time saved by AI"
        value={timeSavedLabel}
        detail={
          <p className={cn("text-xs text-muted-foreground", minutesSaved <= 0 && "text-muted-foreground/70")}>
            {minutesSaved <= 0 ? "Nothing recorded yet." : "From real agent estimates only."}
          </p>
        }
      />
    </div>
  );
}
