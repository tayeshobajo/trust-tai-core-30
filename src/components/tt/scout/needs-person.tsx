/**
 * Needs a person.
 *
 * Companies whose evidence is strong enough for deeper research, but where no
 * founder or decision maker is on record yet. No person, no first message: a
 * company here is never presented as ready for outreach.
 */

import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { CompanyMark } from "@/components/tt/company-identity";
import { FIT_LIGHT_LABEL, FitDot } from "@/components/tt/fit-light";
import { EmptyState } from "@/components/tt/primitives";
import type { ScoutLinkSearch } from "@/components/tt/scout/company-table";
import { worthKnowingMembership } from "@/data/relationship-development";
import type { ProspectCandidate } from "@/domain/scout";
import { WATCHLIST_HONESTY_NOTE } from "@/domain/scout-watchlist";

export function NeedsAPerson({
  candidates,
  linkSearch,
}: {
  candidates: ProspectCandidate[];
  linkSearch: ScoutLinkSearch;
}) {
  const rows = useMemo(
    () => candidates.filter((candidate) => worthKnowingMembership(candidate) === "needs_person"),
    [candidates],
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nobody is waiting on a name"
        belongsHere="Companies whose evidence is strong enough for deeper research, but with no founder or decision maker on record, appear here."
        whyItMatters={WATCHLIST_HONESTY_NOTE}
      />
    );
  }

  return (
    <section className="space-y-3 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
      <ul className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.map((candidate) => (
          <li key={candidate.prospect.id} className="border-b border-border last:border-b-0">
            <Link
              to="/modules/scout/prospects/$prospectId"
              params={{ prospectId: candidate.prospect.id }}
              search={linkSearch}
              className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-cloud focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <CompanyMark
                name={candidate.prospect.name}
                websiteUrl={candidate.prospect.websiteUrl || candidate.prospect.domain}
                themeColor={candidate.identity?.themeColor ?? null}
                logoUrl={candidate.identity?.logoUrl ?? null}
                size="sm"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {candidate.prospect.name}
                </span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">
                  No founder or decision maker is on record yet, so no first message can be drafted.
                </span>
              </span>
              <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
                <FitDot light={candidate.evaluation.light} />
                {FIT_LIGHT_LABEL[candidate.evaluation.light]}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-[12px] leading-relaxed text-muted-foreground">{WATCHLIST_HONESTY_NOTE}</p>
    </section>
  );
}
