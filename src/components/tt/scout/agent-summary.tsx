/**
 * Scout Growth Agent — the compact horizontal state of Scout's own driver.
 * Every number comes from live Scout state; nothing here is illustrative.
 */

import type { ReactNode } from "react";

import { MetaPill } from "@/components/tt/primitives";
import { cn } from "@/lib/utils";

export interface ScoutAgentSummaryProps {
  name?: string;
  status?: string;
  onBoard: number;
  qualified: number;
  inIcp: number;
  lastRun: string;
  loading?: boolean;
  blocked?: boolean;
  /** Rendered only when sourcing is a real, connected capability. */
  action?: ReactNode;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate text-[15px] font-medium text-foreground">{value}</dd>
    </div>
  );
}

export function ScoutAgentSummary({
  name = "Scout Growth Agent",
  status,
  onBoard,
  qualified,
  inIcp,
  lastRun,
  loading = false,
  blocked = false,
  action,
}: ScoutAgentSummaryProps) {
  return (
    <section
      aria-label="Scout Growth Agent"
      className={cn(
        "rounded-xl border border-border bg-cloud px-5 py-4",
        blocked && "border-destructive/30 bg-destructive/5",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-foreground">{name}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Real signals. Real fit. Real companies.
          </p>
        </div>

        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 lg:max-w-[560px]">
          <Metric label="On board" value={onBoard} />
          <Metric label="Qualified" value={qualified} />
          <Metric label="In ICP" value={inIcp} />
          <Metric label="Last run" value={loading ? "…" : lastRun} />
        </dl>

        <div className="flex shrink-0 items-center gap-2">
          {status ? <MetaPill>{status.replaceAll("_", " ")}</MetaPill> : null}
          {action}
        </div>
      </div>
      {blocked ? (
        <p className="mt-3 text-[13px] text-destructive">
          Needs human review before Scout can continue cleanly.
        </p>
      ) : null}
    </section>
  );
}
