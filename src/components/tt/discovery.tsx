/**
 * Scout, sourcing progress and run history.
 *
 * A discovery pass takes minutes, so Scout narrates what it is doing rather
 * than spinning. Every finished pass stays on record: the query, the ICP it was
 * judged against, and how many companies survived verification.
 */

import { Check, Loader2 } from "lucide-react";

import type { DiscoveryRun, DiscoveryStage } from "@/data/supabase/scout-discovery";
import { cn } from "@/lib/utils";

import { formatChecked } from "./fit-light";
import { EmptyState, MetaPill, SectionHeading } from "./primitives";

const ORDER = [
  { key: "reading_icp", label: "Reading ICP" },
  { key: "searching", label: "Searching market" },
  { key: "verifying", label: "Verifying companies" },
  { key: "evaluating", label: "Evaluating fit" },
  { key: "shortlist", label: "Building shortlist" },
] as const;

export function DiscoveryProgress({
  stages,
  running,
  query,
}: {
  stages: DiscoveryStage[];
  running: boolean;
  query: string;
}) {
  const reached = new Set(stages.map((stage) => stage.stage));
  const done = reached.has("done");
  const failed = stages.find((stage) => stage.stage === "error");
  const activeIndex = ORDER.findIndex((step, index) => {
    const next = ORDER[index + 1];
    return reached.has(step.key) && (!next || !reached.has(next.key));
  });

  return (
    <div role="status" aria-live="polite" className="tt-surface mt-3 space-y-3 p-5">
      <p className="text-sm text-foreground">
        {failed
          ? "Scout stopped."
          : done
            ? `Sourcing complete for “${query}”.`
            : `Sourcing companies for “${query}”.`}
      </p>

      <ol className="space-y-2">
        {ORDER.map((step, index) => {
          const complete = done || (activeIndex >= 0 && index < activeIndex);
          const current = !done && !failed && index === activeIndex;
          return (
            <li
              key={step.key}
              className={cn(
                "flex items-center gap-2.5 text-[13px]",
                complete
                  ? "text-foreground"
                  : current
                    ? "text-foreground"
                    : "text-muted-foreground/60",
              )}
            >
              {complete ? (
                <Check aria-hidden className="size-3.5 text-success" />
              ) : current && running ? (
                <Loader2 aria-hidden className="size-3.5 animate-spin text-royal" />
              ) : (
                <span aria-hidden className="size-1.5 rounded-full bg-border" />
              )}
              {step.label}
            </li>
          );
        })}
      </ol>

      {failed ? (
        <p className="text-[13px] text-destructive">{failed.message}</p>
      ) : done ? (
        <p className="text-[13px] text-muted-foreground">
          {stages.find((s) => s.stage === "done")?.message}
        </p>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Scout reads public sources and keeps only companies it can evidence. This takes a few
          minutes.
        </p>
      )}
    </div>
  );
}

export function DiscoveryRuns({ runs }: { runs: DiscoveryRun[] }) {
  return (
    <section>
      <SectionHeading
        eyebrow="Provenance"
        title="Sourcing runs"
        description="Every market search Scout has run, the ICP it judged against, and what survived verification."
      />
      {runs.length === 0 ? (
        <EmptyState
          title="No sourcing runs yet"
          belongsHere="Each market search is recorded here with its query, model and result count."
          whyItMatters="Knowing what was asked, and when, keeps the board's origins honest."
        />
      ) : (
        <ul className="mb-8 overflow-hidden rounded-xl border border-border bg-card">
          {runs.map((run) => {
            const rejected = Number(run.meta["rejected"] ?? 0);
            return (
              <li
                key={run.id}
                className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{run.query}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {run.status === "succeeded"
                      ? `${run.resultCount ?? 0} saved${rejected ? ` · ${rejected} dropped for missing evidence` : ""}`
                      : run.status === "running"
                        ? "Running"
                        : (run.error ?? "Failed")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {run.icpVersion ? <MetaPill>ICP v{run.icpVersion}</MetaPill> : null}
                  {run.model ? <MetaPill>{run.model}</MetaPill> : null}
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {formatChecked(run.createdAt)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
