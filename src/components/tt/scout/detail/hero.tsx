/**
 * Scout company detail, utility row and company hero.
 *
 * The hero is the heaviest surface on the page: identity, Scout's confidence,
 * and the six facts that frame every later judgment. The right side carries an
 * Ambient Identity Wash built from the company's own recorded colour. No
 * imagery is invented.
 */

import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, ExternalLink, Link2, MoreHorizontal } from "lucide-react";

import { CompanyMark } from "@/components/tt/company-identity";
import { ScoutStatusPill, type ScoutLinkSearch } from "@/components/tt/scout/company-table";
import { TTButton } from "@/components/tt/primitives";
import { POTENTIAL_LABEL, type ScoutCompanySummary } from "@/data/scout/company-summary";
import type { ProspectCandidate } from "@/domain/scout";
import { hostnameOf, normalizeThemeColor } from "@/lib/company-identity";
import { cn } from "@/lib/utils";

function formatDate(value?: string): string {
  if (!value) return "-";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "-";
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function relative(value?: string): string {
  if (!value) return "-";
  const at = Date.parse(value);
  if (Number.isNaN(at)) return "-";
  const days = Math.floor((Date.now() - at) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

export function DetailUtilityRow({
  companyName,
  backSearch,
  previous,
  next,
}: {
  companyName: string;
  backSearch: ScoutLinkSearch;
  previous: { id: string; name: string } | null;
  next: { id: string; name: string } | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex min-w-0 items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <li>
            <Link
              to="/modules/scout"
              search={backSearch}
              className="hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Scout
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link to="/modules/scout" search={backSearch} className="hover:text-foreground">
              Companies
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li className="truncate text-foreground">{companyName}</li>
        </ol>
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <TTButton
          variant="secondary"
          className="h-9 px-3 text-[13px]"
          onClick={() => {
            if (typeof navigator !== "undefined" && navigator.clipboard) {
              void navigator.clipboard.writeText(window.location.href);
            }
          }}
        >
          <Link2 aria-hidden className="mr-2 size-3.5" />
          Share
        </TTButton>
        <TTButton asChild variant="secondary" className="h-9 px-3 text-[13px]">
          <Link to="/modules/scout" search={backSearch}>
            <MoreHorizontal aria-hidden className="mr-2 size-3.5" />
            Back to board
          </Link>
        </TTButton>
        <span className="inline-flex items-center gap-2">
          <TTButton
            asChild={Boolean(previous)}
            variant="secondary"
            className={cn("h-9 px-3 text-[13px]", !previous && "pointer-events-none opacity-40")}
            aria-disabled={!previous}
          >
            {previous ? (
              <Link
                to="/modules/scout/prospects/$prospectId"
                params={{ prospectId: previous.id }}
                search={backSearch}
                aria-label={`Previous company: ${previous.name}`}
              >
                <ChevronLeft aria-hidden className="mr-1 size-3.5" />
                Previous
              </Link>
            ) : (
              <span>
                <ChevronLeft aria-hidden className="mr-1 size-3.5" />
                Previous
              </span>
            )}
          </TTButton>
          <TTButton
            asChild={Boolean(next)}
            variant="secondary"
            className={cn("h-9 px-3 text-[13px]", !next && "pointer-events-none opacity-40")}
            aria-disabled={!next}
          >
            {next ? (
              <Link
                to="/modules/scout/prospects/$prospectId"
                params={{ prospectId: next.id }}
                search={backSearch}
                aria-label={`Next company: ${next.name}`}
              >
                Next
                <ChevronRight aria-hidden className="ml-1 size-3.5" />
              </Link>
            ) : (
              <span>
                Next
                <ChevronRight aria-hidden className="ml-1 size-3.5" />
              </span>
            )}
          </TTButton>
        </span>
      </div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate text-[15px] font-medium text-foreground">{value}</p>
    </div>
  );
}

export function CompanyHero({
  candidate,
  summary,
}: {
  candidate: ProspectCandidate;
  summary: ScoutCompanySummary;
}) {
  const { prospect, identity, profile, evaluation } = candidate;
  const accent = normalizeThemeColor(identity?.themeColor ?? null) ?? "oklch(0.55 0.16 262)";
  const host = hostnameOf(prospect.websiteUrl || prospect.domain);
  const tags = [profile?.industry, profile?.size, profile?.location].filter(Boolean) as string[];

  return (
    <section className="tt-rise overflow-hidden rounded-2xl border border-border bg-card">
      <div
        aria-hidden
        className="h-[3px] w-full"
        style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }}
      />
      <div
        style={{
          background: `linear-gradient(180deg, color-mix(in oklab, ${accent} 6%, transparent) 0%, transparent 200px)`,
        }}
      >
        <div className="min-w-0 p-6 sm:p-8">
          <div className="flex min-w-0 items-start gap-4">
            <CompanyMark
              name={prospect.name}
              websiteUrl={prospect.websiteUrl || prospect.domain}
              themeColor={identity?.themeColor ?? null}
              logoUrl={identity?.logoUrl ?? null}
              size="lg"
              className="size-16 rounded-xl"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="tt-display truncate text-3xl text-foreground sm:text-4xl">
                  {prospect.name}
                </h1>
                <ScoutStatusPill status={prospect.status} />
                {summary.icpMatch !== null ? (
                  <span className="inline-flex items-center rounded-full border border-royal/25 bg-royal/8 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-royal">
                    {summary.icpMatch}% ICP match
                  </span>
                ) : null}
              </div>

              <p className="mt-2 font-mono text-[12px] text-muted-foreground">
                {host ? (
                  <a
                    href={prospect.websiteUrl || `https://${host}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 underline decoration-border underline-offset-4 hover:text-foreground"
                  >
                    {host}
                    <ExternalLink aria-hidden className="size-3" />
                  </a>
                ) : (
                  "No website recorded"
                )}
              </p>

              {tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-full border border-border bg-cloud px-2.5 py-1 text-[12px] text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}

              <p className="mt-4 max-w-reading text-[15px] leading-relaxed text-muted-foreground">
                {summary.headline}.
              </p>
            </div>
          </div>
        </div>

      </div>

      <div className="grid grid-cols-2 divide-x divide-border border-t border-border sm:grid-cols-3 xl:grid-cols-6">
        <HeroStat
          label="Score"
          value={evaluation.scoreable ? `${evaluation.score} / 100` : "Not scored"}
        />
        <HeroStat
          label="ICP match"
          value={summary.icpMatch === null ? "-" : `${summary.icpMatch}%`}
        />
        <HeroStat label="Potential" value={POTENTIAL_LABEL[summary.potential]} />
        <HeroStat label="Last seen" value={relative(candidate.lastCheckedAt)} />
        <HeroStat label="Added" value={formatDate(prospect.createdAt)} />
        <HeroStat label="Source" value={candidate.source.label} />
      </div>
    </section>
  );
}
