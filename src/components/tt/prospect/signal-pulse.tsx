/**
 * Signal pulse, what changed between research passes.
 *
 * A trajectory of dots, not a chart. Scout is an editorial brief.
 */

import type { ResearchRun, SignalPulse } from "@/domain/prospect-modules";
import { cn } from "@/lib/utils";

import { FitDot, formatChecked } from "../fit-light";
import { RailCard } from "./panel";

function label(key: string): string {
  return key.replace(/_/g, " ");
}

export function SignalPulseCard({
  pulse,
  history,
}: {
  pulse: SignalPulse;
  history: ResearchRun[];
}) {
  const recent = history.slice(-5);
  const delta = pulse.scoreDelta;

  return (
    <RailCard title="Signal pulse">
      <div className="space-y-4">
        <p className="text-sm text-foreground">
          {pulse.current.score}%
          <span
            className={cn(
              "ml-2 font-mono text-[11px]",
              delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "no change"}
          </span>
        </p>

        <ol className="flex items-end gap-2">
          {recent.map((run) => (
            <li key={run.at} className="flex flex-col items-center gap-1.5">
              <span
                aria-hidden
                className="w-1.5 rounded-full bg-border"
                style={{ height: `${Math.max(6, Math.round(run.score * 0.36))}px` }}
              />
              <FitDot light={run.light} />
              <span className="sr-only">
                {formatChecked(run.at)}: {run.score}%
              </span>
            </li>
          ))}
        </ol>

        <p className="text-[13px] text-muted-foreground">{pulse.summary}</p>

        {pulse.gained.length > 0 ? (
          <p className="text-[13px] text-success">Newly met: {pulse.gained.map(label).join(", ")}</p>
        ) : null}
        {pulse.lost.length > 0 ? (
          <p className="text-[13px] text-warning">No longer met: {pulse.lost.map(label).join(", ")}</p>
        ) : null}

        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Previous read {formatChecked(pulse.previous.at)}
        </p>
      </div>
    </RailCard>
  );
}
