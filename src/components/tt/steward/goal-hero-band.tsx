/**
 * The weekly goal momentum band.
 *
 * The first beat a person sees on Tasks: one outcome the Captain proposed for
 * the week, a progress ring drawn from real linked-task state, and an honest
 * count of what an agent cleared for them. Nothing here invents a number. When
 * there is no goal, it says so quietly rather than pretending.
 *
 * The goal is inert until confirmed. A 'proposed' goal shows a confirm gate;
 * only confirming makes it the person's own. "Captain proposes, person
 * confirms."
 */

import { Sparkles } from "lucide-react";

import { TTButton } from "@/components/tt/primitives";
import type { WeeklyGoalProgress, WeeklyGoalRecord } from "@/domain/steward-weekly-goal";

/** The progress ring. Track is the border token, sweep is the royal token. */
function ProgressRing({ pct }: { pct: number }) {
  const size = 108;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${clamped} percent complete`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="stroke-royal transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl font-semibold text-foreground">{clamped}%</span>
        <span className="mt-0.5 max-w-14 text-center text-[10px] leading-tight text-muted-foreground">
          Weekly progress
        </span>
      </div>
    </div>
  );
}

/** The honest "cleared for you" line. Real count, correct singular or plural. */
function clearedLine(agentCleared: number): string {
  if (agentCleared <= 0) return "Nothing cleared for you yet this week.";
  if (agentCleared === 1) return "1 thing cleared for you this week.";
  return `${agentCleared} cleared for you this week.`;
}

export function GoalHeroBand({
  goal,
  progress,
  onConfirm,
  pending = false,
  canConfirm = true,
}: {
  goal: WeeklyGoalRecord | null;
  progress: WeeklyGoalProgress | null;
  onConfirm: () => void;
  pending?: boolean;
  canConfirm?: boolean;
}) {
  if (!goal) {
    return (
      <div className="rounded-xl border border-border bg-card px-5 py-4">
        <p className="tt-eyebrow">Goal for the week</p>
        <p className="mt-2 text-sm text-muted-foreground">No goal set for this week yet.</p>
      </div>
    );
  }

  const proposed = goal.status === "proposed" && canConfirm;

  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4 sm:px-6">
      <div className="grid gap-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
        <ProgressRing pct={progress?.pct ?? 0} />
        <div className="min-w-0 flex-1">
          <p className="tt-eyebrow">Goal for the week</p>
          <h2 className="mt-1.5 max-w-3xl font-display text-xl font-semibold leading-tight text-foreground">{goal.title}</h2>
          <p className="mt-2 text-sm font-semibold text-foreground">
            {progress ? clearedLine(progress.agentCleared) : clearedLine(0)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your Captain proposed this goal based on your priorities. Review and confirm to get started.
          </p>
        </div>

        <div className="flex items-start justify-between gap-3 md:flex-col md:items-stretch">
          <span className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-royal/8 px-3 text-xs font-medium text-royal">
            <Sparkles aria-hidden className="size-3.5" />
            {proposed ? "Proposed by Captain" : "Weekly goal"}
          </span>
          {proposed ? (
            <TTButton
              type="button"
              size="sm"
              onClick={onConfirm}
              pending={pending}
              pendingLabel="Confirming"
              className="min-w-32"
            >
              Confirm this goal
            </TTButton>
          ) : progress ? (
            <p className="text-right text-xs text-muted-foreground">
              <span className="block font-semibold text-foreground">
                {progress.linkedComplete} of {progress.linkedTotal} done
              </span>
              {progress.humanRemaining} still on you
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
