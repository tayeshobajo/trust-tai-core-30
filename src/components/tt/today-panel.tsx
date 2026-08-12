import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { MetaPill } from "@/components/tt/primitives";
import type { ActivityEvent } from "@/domain/activity";

/**
 * The daily return loop.
 *
 * One panel, one dominant idea: what changed, what needs you, and the single
 * next move. Anything the system worked out rather than observed is labelled.
 */
export function TodayPanel({
  changedCount,
  attention,
  nextMove,
  nextMoveInferred,
  action,
  newSignals,
}: {
  changedCount: number;
  attention: string;
  nextMove: string;
  nextMoveInferred?: boolean;
  action?: ReactNode;
  newSignals: ActivityEvent[];
}) {
  return (
    <section
      aria-labelledby="today-heading"
      className="tt-rise overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="grid gap-0 md:grid-cols-[1.4fr_1fr]">
        <div className="p-6 sm:p-8">
          <p className="tt-eyebrow">Today</p>
          <h2 id="today-heading" className="mt-3 font-display text-2xl text-foreground sm:text-3xl">
            {attention}
          </h2>
          <p className="mt-4 max-w-reading text-sm text-muted-foreground">
            <span className="text-foreground">Next move.</span> {nextMove}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <MetaPill>
              {changedCount === 0
                ? "Nothing changed since your last visit"
                : `${changedCount} change${changedCount === 1 ? "" : "s"} since your last visit`}
            </MetaPill>
            {nextMoveInferred ? <MetaPill>Inferred by intelligence</MetaPill> : null}
          </div>
          {action ? <div className="mt-6">{action}</div> : null}
        </div>

        <div className="border-t border-border bg-secondary/40 p-6 sm:p-8 md:border-l md:border-t-0">
          <p className="tt-eyebrow">New since your last visit</p>
          {newSignals.length > 0 ? (
            <ul className="mt-4 space-y-4">
              {newSignals.slice(0, 3).map((event) => (
                <li key={event.id} className="tt-rise">
                  <p className="text-sm text-foreground">{event.summary}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {event.provenance.confidence === "inferred" ? "Inferred" : "Observed"} · via{" "}
                    {event.provenance.appId}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              The world has been quiet. Signals from any Trust Tai room appear here first.
            </p>
          )}
          <p className="mt-6 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Signal <ArrowRight className="size-3" /> Decision <ArrowRight className="size-3" /> Action
          </p>
        </div>
      </div>
    </section>
  );
}
