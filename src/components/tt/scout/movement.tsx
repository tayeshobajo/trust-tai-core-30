/**
 * Movement.
 *
 * A company appears here only when observed evidence actually changed between
 * two research passes. Quiet stays quiet: no change means nothing to show, and
 * silence is never dressed up as a signal.
 */

import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { CompanyMark } from "@/components/tt/company-identity";
import { formatChecked } from "@/components/tt/fit-light";
import { EmptyState } from "@/components/tt/primitives";
import type { ScoutLinkSearch } from "@/components/tt/scout/company-table";
import { computePulse } from "@/data/prospect-modules";
import type { ProspectCandidate } from "@/domain/scout";
import { WATCHLIST_HONESTY_NOTE } from "@/domain/scout-watchlist";
import type { SignalPulse } from "@/domain/prospect-modules";

interface MovementEntry {
  candidate: ProspectCandidate;
  pulse: SignalPulse;
}

export function ScoutMovement({
  candidates,
  linkSearch,
}: {
  candidates: ProspectCandidate[];
  linkSearch: ScoutLinkSearch;
}) {
  const entries = useMemo<MovementEntry[]>(() => {
    const rows: MovementEntry[] = [];
    for (const candidate of candidates) {
      if (candidate.prospect.status === "passed" || candidate.prospect.status === "archived") {
        continue;
      }
      const pulse = computePulse(candidate.history ?? []);
      if (pulse) rows.push({ candidate, pulse });
    }
    return rows.sort((a, b) => b.pulse.current.at.localeCompare(a.pulse.current.at));
  }, [candidates]);

  if (entries.length === 0) {
    return (
      <section className="space-y-4">
        <EmptyState
          title="No change since the last look"
          belongsHere="A company appears here only when something Scout can see on its public pages actually changed."
          whyItMatters={WATCHLIST_HONESTY_NOTE}
        />
      </section>
    );
  }

  return (
    <section className="space-y-3 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
      <ul className="overflow-hidden rounded-xl border border-border bg-card">
        {entries.map(({ candidate, pulse }) => (
          <li key={candidate.prospect.id} className="border-b border-border last:border-b-0">
            <Link
              to="/modules/scout/prospects/$prospectId"
              params={{ prospectId: candidate.prospect.id }}
              search={linkSearch}
              className="flex flex-wrap items-start gap-3 px-4 py-3 transition-colors hover:bg-cloud focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                  {pulse.summary}
                </span>
                {pulse.gained.length > 0 ? (
                  <span className="mt-1 block text-[12px] text-muted-foreground">
                    Now observed: {pulse.gained.join(", ")}
                  </span>
                ) : null}
                {pulse.lost.length > 0 ? (
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    No longer observed: {pulse.lost.join(", ")}
                  </span>
                ) : null}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {formatChecked(pulse.current.at)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-[12px] leading-relaxed text-muted-foreground">{WATCHLIST_HONESTY_NOTE}</p>
    </section>
  );
}
