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
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-display text-2xl text-foreground">{clamped}%</span>
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
      <div className="rounded-2xl border border-border bg-card px-6 py-5">
        <p className="tt-eyebrow">Goal for the week</p>
        <p className="mt-2 text-sm text-muted-foreground">No goal set for this week yet.</p>
      </div>
    );
  }

  const proposed = goal.status === "proposed" && canConfirm;

  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-6">
        <ProgressRing pct={progress?.pct ?? 0} />
        <div className="min-w-0 flex-1">
          <p className="tt-eyebrow">Goal for the week</p>
          <h2 className="mt-2 font-display text-2xl leading-tight text-foreground">{goal.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {progress ? clearedLine(progress.agentCleared) : clearedLine(0)}
          </p>
        </div>

        {progress ? (
          <div className="text-sm text-muted-foreground">
            <p className="font-display text-foreground">
              {progress.linkedComplete} of {progress.linkedTotal} done
            </p>
            <p className="mt-1 text-[13px]">{progress.humanRemaining} still on you</p>
          </div>
        ) : null}
      </div>

      {proposed ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-royal/25 bg-royal/8 px-4 py-3">
          <p className="text-sm text-foreground">
            Captain suggests this week's goal. Confirm to make it yours.
          </p>
          <TTButton
            type="button"
            size="sm"
            onClick={onConfirm}
            pending={pending}
            pendingLabel="Confirming"
          >
            Confirm goal
          </TTButton>
        </div>
      ) : null}
    </div>
  );
}
