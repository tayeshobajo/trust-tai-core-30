/**
 * Movement.
 *
 * A company appears here only when a fact observed on its own public pages
 * actually changed between two reads. Fit, scores and criteria are deliberately
 * absent: a change is neither good nor bad, and nothing here asks anyone to
 * act. Quiet stays quiet.
 */

import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { CompanyMark } from "@/components/tt/company-identity";
import { EmptyState } from "@/components/tt/primitives";
import type { ScoutLinkSearch } from "@/components/tt/scout/company-table";
import { movementRows, type MovementRow } from "@/data/scout/movement";
import type { ProspectCandidate } from "@/domain/scout";
import { WATCHLIST_HONESTY_NOTE } from "@/domain/scout-watchlist";

/** Absolute, so nobody has to guess what "2 days ago" means. */
function observedAt(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ScoutMovement({
  candidates,
  linkSearch,
}: {
  candidates: ProspectCandidate[];
  linkSearch: ScoutLinkSearch;
}) {
  const rows = useMemo<MovementRow<ProspectCandidate>[]>(() => {
    const eligible = candidates.filter(
      (candidate) =>
        candidate.prospect.status !== "passed" && candidate.prospect.status !== "archived",
    );
    return movementRows(
      eligible.map((candidate) => ({ subject: candidate, log: candidate.movement ?? [] })),
    );
  }, [candidates]);

  if (rows.length === 0) {
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
      <p className="text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
        Changes observed since the previous read
      </p>
      <ul className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.map(({ subject: candidate, lines, changeCount, observedAt: at }) => (
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
                <span className="mt-1 block space-y-0.5">
                  {lines.map((line, index) => (
                    <span
                      key={`${line.kind}-${index}`}
                      className={
                        line.kind === "source_moved"
                          ? "block text-[13px] text-amber-700"
                          : "block text-[13px] text-muted-foreground"
                      }
                    >
                      {line.text}
                    </span>
                  ))}
                </span>
                <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {changeCount} {changeCount === 1 ? "change" : "changes"} observed
                  {changeCount > lines.length ? ` · ${changeCount - lines.length} more inside` : ""}
                </span>
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">{observedAt(at)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-[12px] leading-relaxed text-muted-foreground">{WATCHLIST_HONESTY_NOTE}</p>
    </section>
  );
}
