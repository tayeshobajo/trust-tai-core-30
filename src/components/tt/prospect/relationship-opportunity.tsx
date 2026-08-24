/**
 * Relationship opportunity, the second read beside ICP fit.
 *
 * ICP fit asks "is this our kind of company?" This card asks "do we have a
 * legitimate, timely reason to enter this person's world now?" Every factor
 * says what was read or what was not found; absence never counts against the
 * company. Nothing here sends anything.
 */

import { useMemo } from "react";

import {
  bestEntryPerson,
  buildRelationshipBrief,
  computeRelationshipOpportunity,
  opportunityPeople,
  recommendChannel,
  relationshipResearchEligible,
} from "@/data/relationship-development";
import type { Person } from "@/domain/people";
import {
  RELATIONSHIP_CHANNEL_LABEL,
  RELATIONSHIP_OPPORTUNITY_LABEL,
} from "@/domain/relationship-development";
import type { ProspectCandidate } from "@/domain/scout";
import { EMPTY_INTEL } from "@/domain/scout-intel";
import { cn } from "@/lib/utils";

import { Panel } from "./panel";

const STATE_TONE: Record<string, string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-900",
  watching: "border-border bg-secondary text-secondary-foreground",
  not_enough_signal: "border-border bg-card text-muted-foreground",
  not_appropriate: "border-border bg-card text-muted-foreground",
};

export function RelationshipOpportunityCard({
  candidate,
  people,
}: {
  candidate: ProspectCandidate;
  people: Person[];
}) {
  const read = useMemo(() => {
    const intel = candidate.intel ?? EMPTY_INTEL;
    const opportunity = computeRelationshipOpportunity({ candidate, intel, people });
    const normalized = opportunityPeople(intel, people);
    const eligibility = relationshipResearchEligible(candidate, normalized);
    const entry = bestEntryPerson(normalized);
    const channel = recommendChannel({ person: entry });
    const brief =
      opportunity.state === "ready" || opportunity.state === "watching"
        ? buildRelationshipBrief({ candidate, intel, people })
        : null;
    return { opportunity, eligibility, entry, channel, brief };
  }, [candidate, people]);

  const { opportunity, eligibility, channel, brief } = read;

  return (
    <Panel
      eyebrow="Relationship opportunity"
      title={RELATIONSHIP_OPPORTUNITY_LABEL[opportunity.state]}
      description={opportunity.headline}
      aside={
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
            STATE_TONE[opportunity.state],
          )}
        >
          {RELATIONSHIP_OPPORTUNITY_LABEL[opportunity.state]}
        </span>
      }
    >
      <div className="space-y-5">
        <p className="text-[13px] text-muted-foreground">{eligibility.because}</p>

        {opportunity.factors.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {opportunity.factors.map((factor) => (
              <li
                key={factor.key}
                className="rounded-lg border border-border bg-background p-3"
              >
                <p className="text-[13px] text-foreground">
                  <span
                    aria-hidden
                    className={cn(
                      "mr-2 inline-block size-1.5 rounded-full align-middle",
                      factor.state === "present" ? "bg-success" : "bg-muted-foreground/40",
                    )}
                  />
                  {factor.label}
                </p>
                <p className="mt-1 pl-3.5 text-[12px] text-muted-foreground">{factor.because}</p>
              </li>
            ))}
          </ul>
        ) : null}

        {channel ? (
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="tt-eyebrow">Best way in</p>
            <p className="mt-1.5 text-[13px] text-foreground">
              {RELATIONSHIP_CHANNEL_LABEL[channel.channel]}
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{channel.reason}</p>
          </div>
        ) : null}

        {brief && brief.bridgeIdeas.length > 0 ? (
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="tt-eyebrow">Useful bridges</p>
            <ul className="mt-2 space-y-2.5">
              {brief.bridgeIdeas.map((idea) => (
                <li key={`${idea.kind}-${idea.idea.slice(0, 24)}`}>
                  <p className="text-[13px] text-foreground">
                    {idea.label}: {idea.idea}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">{idea.why}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {brief ? (
          brief.grounded ? (
            <div className="rounded-lg border border-border bg-secondary/40 p-4">
              <p className="tt-eyebrow">First-move posture</p>
              <p className="mt-1.5 text-[13px] text-muted-foreground">{brief.firstMovePosture}</p>
              {brief.risksOrAssumptions.length > 0 ? (
                <ul className="mt-3 space-y-1 border-t border-border pt-3 text-[12px] text-muted-foreground">
                  {brief.risksOrAssumptions.map((risk) => (
                    <li key={risk}>{risk}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">{brief.firstMovePosture}</p>
          )
        ) : null}
      </div>
    </Panel>
  );
}
