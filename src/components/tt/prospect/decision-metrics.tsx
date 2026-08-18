/**
 * The six decision metrics.
 *
 * Deliberately six numbers rather than one. Each states what it was computed
 * from, and the priority score shows its own arithmetic so ranking is never a
 * black box. Nothing here decides, it renders what the metric layer produced.
 */

import type { DecisionMetrics } from "@/domain/scout-intel";
import { cn } from "@/lib/utils";

import { Disclosure, Panel } from "./panel";

function toneFor(value: number | null): string {
  if (value === null) return "text-muted-foreground";
  if (value >= 70) return "text-success";
  if (value >= 40) return "text-warning";
  return "text-muted-foreground";
}

export function DecisionMetricsPanel({ metrics }: { metrics: DecisionMetrics }) {
  return (
    <Panel
      eyebrow="Deep intelligence"
      title="Six reads, kept separate"
      description="One blended number would hide why this company is where it is. Each read states what it was computed from, and unknown never counts as a negative."
      aside={
        <div className="text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Priority
          </p>
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {metrics.priority === null ? "-" : metrics.priority}
          </p>
        </div>
      }
    >
      <div className="space-y-4">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {metrics.metrics.map((metric) => (
            <div key={metric.key} className="border-b border-border pb-3 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[13px] font-medium text-foreground">{metric.label}</dt>
                <dd
                  className={cn(
                    "shrink-0 font-mono text-[13px] tabular-nums",
                    toneFor(metric.value),
                  )}
                >
                  {metric.value === null ? "unknown" : metric.value}
                </dd>
              </div>
              <p className="mt-1 text-[13px] text-muted-foreground">{metric.because}</p>
            </div>
          ))}
        </dl>
        <Disclosure summary="How the priority score was reached">
          <p className="text-[13px] text-muted-foreground">{metrics.priorityExplanation}</p>
        </Disclosure>
      </div>
    </Panel>
  );
}
