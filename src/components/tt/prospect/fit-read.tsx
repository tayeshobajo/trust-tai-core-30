/**
 * ICP fit read — what the evaluator found, condensed so it is scannable and
 * expandable rather than a wall of criteria.
 */

import { criterionConfidence } from "@/data/prospect-modules";
import type { ConfidenceRead } from "@/domain/confidence";
import type { ResearchCoverage } from "@/domain/prospect-modules";
import type { ScoutFitEvaluation } from "@/domain/scout-fit";
import { cn } from "@/lib/utils";

import {
  ConfidenceChip,
  CriterionRow,
  Disclosure,
  Panel,
  STATE_LABEL,
  STATE_TONE,
  TierTag,
  WhyWeThink,
} from "./panel";

const OPPORTUNITY_KEYS = new Set(["limiting_system", "first_milestone", "roadmap_depth"]);
const DECISION_KEYS = new Set(["decision_maker"]);

export function FitReadPanel({
  evaluation,
  coverage,
  confidence,
  emphasis,
}: {
  evaluation: ScoutFitEvaluation;
  coverage: ResearchCoverage;
  confidence: ConfidenceRead;
  emphasis?: "primary" | "supporting" | "quiet" | undefined;
}) {
  const criteria = evaluation.criteria.filter(
    (c) => !OPPORTUNITY_KEYS.has(c.key) && !DECISION_KEYS.has(c.key),
  );
  const unknown = criteria.filter((c) => c.state === "missing" || c.state === "mismatch");

  return (
    <Panel
      eyebrow="Current truth"
      title="Why Scout reads it this way"
      description={evaluation.explanation}
      aside={
        <div className="flex items-center gap-2">
          <ConfidenceChip level={confidence.level} />
          <TierTag tier="fact" />
        </div>
      }
      {...(emphasis ? { emphasis } : {})}
    >
      <div className="space-y-5">
        <WhyWeThink confidence={confidence} />
        <div className="rounded-lg border border-royal/20 bg-royal/5 p-4">
          <p className="tt-eyebrow text-royal">Strongest signal</p>
          <p className="mt-1.5 text-sm text-foreground">{evaluation.strongestSignal}</p>
        </div>

        {criteria.length > 0 ? (
          <>
            {/* Scannable strip first: every criterion, one line each. */}
            <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {criteria.map((criterion) => (
                <li
                  key={criterion.key}
                  className="flex items-baseline justify-between gap-3 border-b border-border/70 pb-2"
                >
                  <span className="truncate text-[13px] text-foreground">{criterion.label}</span>
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[10px] uppercase tracking-[0.14em]",
                      STATE_TONE[criterion.state],
                    )}
                  >
                    {STATE_LABEL[criterion.state]}
                  </span>
                </li>
              ))}
            </ul>

            <Disclosure summary={`Full reasoning · ${criteria.length} criteria`}>
              <ul className="space-y-4">
                {criteria.map((criterion) => (
                  <CriterionRow
                    key={criterion.key}
                    criterion={criterion}
                    confidence={criterionConfidence(criterion, coverage)}
                  />
                ))}
              </ul>
            </Disclosure>
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No ICP criteria were scored for this record.
          </p>
        )}

        {unknown.length > 0 ? (
          <div className="rounded-lg border border-border bg-secondary/40 p-4">
            <p className="tt-eyebrow">Still unknown</p>
            <ul className="mt-2 space-y-1.5 text-[13px] text-muted-foreground">
              {unknown.map((criterion) => (
                <li key={criterion.key}>
                  {criterion.label} — {STATE_LABEL[criterion.state].toLowerCase()}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
