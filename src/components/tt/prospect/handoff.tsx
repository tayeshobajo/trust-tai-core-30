/**
 * Handoff readiness — the checklist that gates Comms.
 *
 * Every line is derived from stored evidence, never asserted. Nothing here
 * sends anything.
 */

import type { ProspectCandidate } from "@/domain/scout";
import type { ResearchCoverage } from "@/domain/prospect-modules";
import { cn } from "@/lib/utils";

import { Panel, TierTag } from "./panel";

interface Check {
  label: string;
  ready: boolean;
  note: string;
}

export function HandoffPanel({
  candidate,
  coverage,
  contactCount,
}: {
  candidate: ProspectCandidate;
  coverage: ResearchCoverage;
  contactCount: number;
}) {
  const { evaluation, prospect } = candidate;
  const decisionMaker =
    contactCount > 0 ||
    evaluation.criteria.some((c) => c.key === "decision_maker" && c.state === "met");

  const checks: Check[] = [
    {
      label: "ICP fit is understood",
      ready: evaluation.scoreable && evaluation.light !== "neutral",
      note: evaluation.scoreable
        ? `Scored ${evaluation.score}% against ICP v${evaluation.icpVersion ?? "—"}.`
        : "This record has never been scored against live evidence.",
    },
    {
      label: "Research is deep enough",
      ready: !coverage.thin,
      note: coverage.note,
    },
    {
      label: "A decision maker is named",
      ready: decisionMaker,
      note: decisionMaker
        ? "A named person with a role is on record."
        : "No named person with a role has been read yet.",
    },
    {
      label: "A verified business email exists",
      ready: false,
      note: "Contact verification is not wired yet, so no email can be called reachable.",
    },
  ];

  const ready = checks.filter((check) => check.ready).length;

  return (
    <Panel
      eyebrow="Handoff"
      title="Readiness for Comms"
      description={`${ready} of ${checks.length} conditions met. ${prospect.name} moves only when a person can be carried across.`}
      aside={<TierTag tier="decision" />}
    >
      <ul className="space-y-3">
        {checks.map((check) => (
          <li key={check.label} className="flex gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0">
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                check.ready ? "bg-success" : "bg-border",
              )}
            />
            <div className="min-w-0">
              <p className="text-[13px] text-foreground">
                {check.label}
                <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {check.ready ? "Ready" : "Not yet"}
                </span>
              </p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{check.note}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Nothing is sent automatically.
      </p>
    </Panel>
  );
}
