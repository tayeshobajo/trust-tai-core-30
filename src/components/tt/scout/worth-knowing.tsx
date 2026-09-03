/**
 * Worth knowing, Scout's relationship opportunity queue.
 *
 * One calm list of the PEOPLE where evidence says a real relationship
 * opportunity may exist. Every row answers, in order: who this is, why now,
 * what genuinely caught our attention, the best way in, and a useful bridge.
 *
 * This is not a leaderboard, and the actionable queue is never anonymous
 * companies: 60%+ ICP fit makes a company a candidate for deeper research,
 * and a traceable founder or decision maker makes a person eligible to be
 * considered here. Strong-fit companies with no person on record yet sit
 * quietly below as "needs a person", visible, never presented as ready.
 * Rows a person set aside stay set aside until they say otherwise.
 */

import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { EmptyState, MetaPill, TTButton } from "@/components/tt/primitives";
import { ScoutPagination } from "@/components/tt/scout/pagination";
import {
  computeRelationshipOpportunity,
  relationshipResearchEligible,
  suggestProofOfCare,
  recommendChannel,
  opportunityPeople,
  bestEntryPerson,
  worthKnowingMembership,
  worthKnowingSort,
  type WorthKnowingMembership,
} from "@/data/relationship-development";
import type { ScoutLinkSearch } from "@/components/tt/scout/company-table";
import { paginate } from "@/data/scout-table";
import { scoutService } from "@/data/supabase/scout-service";
import {
  RELATIONSHIP_CHANNEL_LABEL,
  RELATIONSHIP_OPPORTUNITY_LABEL,
  type RelationshipOpportunity,
  type RelationshipResearchMarker,
} from "@/domain/relationship-development";
import type { ProspectCandidate } from "@/domain/scout";
import { EMPTY_INTEL } from "@/domain/scout-intel";
import { cn } from "@/lib/utils";
import type { WorkspaceIdentity } from "@/lib/workspace";

interface WorthKnowingEntry {
  candidate: ProspectCandidate;
  opportunity: RelationshipOpportunity;
  membership: WorthKnowingMembership;
  eligibleBecause: string;
  watch: "watching" | "not_now" | null;
  research?: RelationshipResearchMarker;
}

const STATE_TONE: Record<RelationshipOpportunity["state"], string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-900",
  watching: "border-border bg-secondary text-secondary-foreground",
  not_enough_signal: "border-border bg-card text-muted-foreground",
  not_appropriate: "border-border bg-card text-muted-foreground",
};

function buildEntry(candidate: ProspectCandidate): WorthKnowingEntry {
  const intel = candidate.intel ?? EMPTY_INTEL;
  const opportunity = computeRelationshipOpportunity({ candidate, intel });
  const eligibility = relationshipResearchEligible(candidate, opportunityPeople(intel));
  return {
    candidate,
    opportunity,
    membership: worthKnowingMembership(candidate),
    eligibleBecause: eligibility.because,
    watch: candidate.development?.watch ?? null,
...(candidate.development?.research ? { research: candidate.development.research }: {}),
  };
}

function formatDay(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "recently"
: date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function WorthKnowingQueue({
  candidates,
  identity,
  linkSearch,
}: {
  candidates: ProspectCandidate[];
  identity: WorkspaceIdentity;
  linkSearch: ScoutLinkSearch;
}) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const setWatch = useMutation({
    mutationFn: ({
      prospectId,
      companyName,
      watch,
    }: {
      prospectId: string;
      companyName: string;
      watch: "watching" | "not_now" | null;
    }) =>
      scoutService.setWatch(
        { prospectId, companyName, watch },
        { organizationId: identity.organizationId, userId: identity.userId },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["scout", "prospects", identity.organizationId] }),
  });

  const { entries, needsPerson, setAside } = useMemo(() => {
    // The actionable queue is people: 60%+ fit AND a traceable founder or
    // decision maker. Fit alone never puts an anonymous company here.
    const actionable: WorthKnowingEntry[] = [];
    const waitingOnPerson: WorthKnowingEntry[] = [];
    let aside = 0;
    for (const candidate of candidates) {
      if (worthKnowingMembership(candidate) === "outside") continue;
      const entry = buildEntry(candidate);
      if (entry.watch === "not_now") {
        aside += 1;
      } else if (entry.membership === "actionable") {
        actionable.push(entry);
      } else {
        waitingOnPerson.push(entry);
      }
    }
    actionable.sort((a, b) =>
      worthKnowingSort(
        { opportunity: a.opportunity, fitScore: a.candidate.evaluation.score },
        { opportunity: b.opportunity, fitScore: b.candidate.evaluation.score },
      ),
    );
    waitingOnPerson.sort((a, b) => b.candidate.evaluation.score - a.candidate.evaluation.score);
    return { entries: actionable, needsPerson: waitingOnPerson, setAside: aside };
  }, [candidates]);

  useEffect(() => setPage(1), [entries.length, pageSize]);
  const view = paginate(entries, page, pageSize);

  if (entries.length === 0 && needsPerson.length === 0) {
    return (
      <EmptyState
        title="No relationship opportunities yet"
        belongsHere="People at strong-fit companies appear here, 60%+ ICP fit, plus a founder or decision maker with a real way in on record."
        whyItMatters="Fit alone never creates an opportunity, and a company with no person is never treated as ready. A real person, a socially appropriate route, and something real to notice all have to line up first."
      />
    );
  }

  return (
    <section aria-label="Worth knowing" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] text-muted-foreground">
          People worth knowing, ordered by whether there is a legitimate, timely reason to act.
          Fit decides who is considered; a traceable person decides who appears.
        </p>
      </div>

      <ol className="space-y-3">
        {view.rows.map((entry) => (
          <WorthKnowingRow
            key={entry.candidate.prospect.id}
            entry={entry}
            linkSearch={linkSearch}
            onWatch={(watch) =>
              setWatch.mutate({
                prospectId: entry.candidate.prospect.id,
                companyName: entry.candidate.prospect.name,
                watch,
              })
            }
            busy={setWatch.isPending}
          />
        ))}
      </ol>

      <ScoutPagination view={view} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />

      {needsPerson.length > 0 ? (
        <div className="rounded-xl border border-border bg-card/60 p-4">
          <p className="text-[13px] font-medium text-foreground">Needs a person</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Strong-fit companies we cannot honestly develop a relationship with yet, no founder or
            decision maker with a way in is on record. Find the person first; the opportunity read
            follows.
          </p>
          <ul className="mt-3 space-y-2">
            {needsPerson.map((entry) => (
              <li
                key={entry.candidate.prospect.id}
                className="flex flex-wrap items-center justify-between gap-2 text-[13px]"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <Link
                    to="/modules/scout/prospects/$prospectId"
                    params={{ prospectId: entry.candidate.prospect.id }}
                    search={linkSearch}
                    className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {entry.candidate.prospect.name}
                  </Link>
                  <MetaPill>{entry.candidate.evaluation.score}% fit</MetaPill>
                  <span className="text-[12px] text-muted-foreground">
                    {entry.eligibleBecause}
                  </span>
                </span>
                <TTButton asChild variant="quiet" size="sm">
                  <Link
                    to="/modules/scout/prospects/$prospectId"
                    params={{ prospectId: entry.candidate.prospect.id }}
                    search={linkSearch}
                  >
                    Find the person
                  </Link>
                </TTButton>
              </li>
            ))}
          </ul>
        </div>
      ): null}

      {setAside > 0 ? (
        <p className="text-xs text-muted-foreground">
          {setAside} strong-fit {setAside === 1 ? "company is": "companies are"} set aside for now.
          They stay on the board, untouched, until you say otherwise.
        </p>
      ): null}
    </section>
  );
}

function WorthKnowingRow({
  entry,
  linkSearch,
  onWatch,
  busy,
}: {
  entry: WorthKnowingEntry;
  linkSearch: ScoutLinkSearch;
  onWatch: (watch: "watching" | "not_now" | null) => void;
  busy: boolean;
}) {
  const { candidate, opportunity, research } = entry;
  const intel = candidate.intel ?? EMPTY_INTEL;
  const people = opportunityPeople(intel);
  const entryPerson = bestEntryPerson(people);
  const channel = recommendChannel({ person: entryPerson });
  const bridge = suggestProofOfCare(candidate, intel)[0];
  const noticed =
    intel.opportunities[0]?.statement ?? candidate.signals[0]?.statement ?? null;

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/modules/scout/prospects/$prospectId"
              params={{ prospectId: candidate.prospect.id }}
              search={linkSearch}
              className="text-[15px] font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {entryPerson ? entryPerson.fullName: candidate.prospect.name}
            </Link>
            {entryPerson ? (
              <span className="text-[13px] text-muted-foreground">
                {entryPerson.roleTitle ? `${entryPerson.roleTitle}, `: ""}
                {candidate.prospect.name}
              </span>
            ): null}
            <MetaPill>{candidate.evaluation.score}% fit</MetaPill>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                STATE_TONE[opportunity.state],
              )}
            >
              {RELATIONSHIP_OPPORTUNITY_LABEL[opportunity.state]}
            </span>
            {entry.watch === "watching" ? <MetaPill>Worth watching</MetaPill>: null}
          </div>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{opportunity.headline}</p>
          <p className="mt-1 text-[12px] text-muted-foreground/80">
            {research?.state === "prepared" && research.preparedAt
              ? `Brief prepared ${formatDay(research.preparedAt)} from the stored public evidence. Nothing has been sent.`
: "Research needed, the deeper brief has not been prepared for this person yet."}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <TTButton asChild variant="secondary" size="sm">
            <Link
              to="/modules/scout/prospects/$prospectId"
              params={{ prospectId: candidate.prospect.id }}
              search={linkSearch}
            >
              See research
            </Link>
          </TTButton>
          {opportunity.state === "ready" ? (
            <TTButton asChild size="sm">
              <Link
                to="/modules/scout/prospects/$prospectId"
                params={{ prospectId: candidate.prospect.id }}
                search={linkSearch}
              >
                Prepare first message
              </Link>
            </TTButton>
          ): null}
          <TTButton
            variant="quiet"
            size="sm"
            disabled={busy}
            onClick={() => onWatch(entry.watch === "watching" ? null: "watching")}
          >
            {entry.watch === "watching" ? "Watching": "Watch"}
          </TTButton>
          <TTButton variant="quiet" size="sm" disabled={busy} onClick={() => onWatch("not_now")}>
            Not now
          </TTButton>
        </div>
      </div>

      <dl className="mt-3 grid gap-3 border-t border-border pt-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Why now
          </dt>
          <dd className="mt-0.5 text-foreground">
            {opportunity.whyNow ?? "No dated reason to act yet."}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            What caught our attention
          </dt>
          <dd className="mt-0.5 text-foreground">
            {noticed ?? "Nothing specific enough to notice yet."}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Best way in
          </dt>
          <dd className="mt-0.5 text-foreground">
            {channel
              ? `${RELATIONSHIP_CHANNEL_LABEL[channel.channel]} · ${channel.reason}`
: "No socially appropriate route is on record yet."}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            A useful bridge
          </dt>
          <dd className="mt-0.5 text-foreground">
            {bridge ? `${bridge.label}: ${bridge.idea}`: "No honest bridge is visible yet."}
          </dd>
        </div>
      </dl>
    </li>
  );
}
