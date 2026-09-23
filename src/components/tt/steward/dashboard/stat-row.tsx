/**
 * The four stat cards: streak, level and XP, tasks completed, time saved.
 *
 * Every number is passed in already computed by the pure functions in
 * src/domain/steward-dashboard-stats.ts. This component only renders what it
 * is given, so an empty history renders honest zeros without any special
 * casing here. Team scope sees the same cards; the numbers are non-sensitive
 * status, only titles and actions are hidden elsewhere.
 */

import { Flame, Sparkles, CheckCircle2, Clock } from "lucide-react";
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
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="tt-eyebrow">{label}</p>
      </div>
       <p className="mt-2 font-display text-xl text-foreground">{value}</p>
      {detail ? <div className="mt-2">{detail}</div> : null}
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
      <p className="mt-1.5 text-xs text-muted-foreground">
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
        icon={<Flame aria-hidden className="size-4" />}
        label="Current streak"
        value={`${streakDays} day${streakDays === 1 ? "" : "s"}`}
      />
      <StatCard
        icon={<Sparkles aria-hidden className="size-4" />}
        label={`Level ${level.level} · ${level.label}`}
        value={level.label}
        detail={<XpBar level={level} />}
      />
      <StatCard
        icon={<CheckCircle2 aria-hidden className="size-4" />}
        label="Tasks completed"
        value={`${tasksCompleted.done}/${tasksCompleted.total}`}
      />
      <StatCard
        icon={<Clock aria-hidden className="size-4" />}
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
