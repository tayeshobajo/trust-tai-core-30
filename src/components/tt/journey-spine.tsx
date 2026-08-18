import { cn } from "@/lib/utils";

export type SpineState = "done" | "current" | "ahead";

export interface SpineStage {
  label: string;
  detail: string;
  state: SpineState;
}

/**
 * A quiet progression spine. It tells you where the work sits between a signal
 * and an outcome, history, current work, or something still ahead. No scores,
 * no streaks, no reward mechanics.
 */
export function JourneySpine({ stages }: { stages: SpineStage[] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {stages.map((stage) => (
        <li
          key={stage.label}
          className={cn(
            "relative rounded-xl border p-5 transition-colors duration-300",
            stage.state === "current"
              ? "border-royal/30 bg-royal/5"
              : stage.state === "done"
                ? "border-border bg-card"
                : "border-dashed border-border bg-card/50",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "absolute left-5 top-0 h-px w-[calc(100%-2.5rem)] -translate-y-px",
              stage.state === "ahead" ? "bg-border" : "bg-foreground/25",
            )}
          />
          <p
            className={cn(
              "font-mono text-[10px] uppercase tracking-[0.16em]",
              stage.state === "current" ? "text-royal" : "text-muted-foreground",
            )}
          >
            {stage.label}
          </p>
          <p
            className={cn(
              "mt-2 text-sm",
              stage.state === "ahead" ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {stage.detail}
          </p>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {stage.state === "done" ? "Behind you" : stage.state === "current" ? "Now" : "Later"}
          </p>
        </li>
      ))}
    </ol>
  );
}
