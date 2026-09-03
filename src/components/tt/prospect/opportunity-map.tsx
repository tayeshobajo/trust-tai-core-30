/**
 * Opportunity map, the observed constraint, the first milestone, and how far
 * the roadmap runs, read as Point A → Point B → Point C.
 */

import type { ScoutFit } from "@/domain/scout";
import type { FitCriterion } from "@/domain/scout-fit";

import { CriterionRow, Panel, TierTag } from "./panel";

const ORDER = ["limiting_system", "first_milestone", "roadmap_depth"];
const POINT: Record<string, string> = {
  limiting_system: "Point A",
  first_milestone: "Point B",
  roadmap_depth: "Point C",
};

export function OpportunityMap({ criteria, fit }: { criteria: FitCriterion[]; fit: ScoutFit }) {
  const ordered = ORDER.map((key) => criteria.find((c) => c.key === key)).filter(
    (c): c is FitCriterion => Boolean(c),
  );

  return (
    <Panel
      eyebrow="Where this could go"
      title="Opportunity"
      description="Observed constraints stay separate from what Scout infers and what it suggests."
      aside={<TierTag tier="fact" />}
    >
      <div className="space-y-6">
        <ol className="grid gap-4 lg:grid-cols-3">
          {ordered.map((criterion) => (
            <li key={criterion.key} className="rounded-lg border border-border bg-background p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {POINT[criterion.key] ?? "Point"}
              </p>
              <p className="mt-1.5 text-[13px] font-medium text-foreground">{criterion.label}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{criterion.reason}</p>
            </li>
          ))}
        </ol>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-warning/25 bg-warning/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="tt-eyebrow text-warning">Hypothesis</p>
              <TierTag tier="inference" />
            </div>
            <p className="mt-1.5 text-[13px] text-muted-foreground">{fit.whyItFits}</p>
          </div>
          <div className="rounded-lg border border-warning/25 bg-warning/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="tt-eyebrow text-warning">Suggested</p>
              <TierTag tier="inference" />
            </div>
            <p className="mt-1.5 text-[13px] text-muted-foreground">{fit.recommendation}</p>
          </div>
        </div>

        {ordered.length < criteria.length ? (
          <ul className="space-y-4 border-t border-border pt-4">
            {criteria
              .filter((c) => !ORDER.includes(c.key))
              .map((criterion) => (
                <CriterionRow key={criterion.key} criterion={criterion} />
              ))}
          </ul>
        ) : null}
      </div>
    </Panel>
  );
}
