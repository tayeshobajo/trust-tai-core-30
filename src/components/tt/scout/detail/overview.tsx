/**
 * Scout company detail, Overview.
 *
 * Curated, not exhaustive: Scout's judgment leads, then the strongest signals,
 * then how the ICP actually lines up, then quieter history and comparisons.
 * Deeper reads live in the tabs.
 */

import { Link } from "@tanstack/react-router";

import { CompanyMark } from "@/components/tt/company-identity";
import { FitDot } from "@/components/tt/fit-light";
import type { ScoutLinkSearch } from "@/components/tt/scout/company-table";
import type { ScoutCompanySummary } from "@/data/scout/company-summary";
import type { ICPFactorView } from "@/data/scout/icp-factors";
import type { SimilarCompany } from "@/data/scout/similar-companies";
import type { RankedSignal } from "@/data/scout/top-signals";
import type { ActivityEvent } from "@/domain/activity";

import {
  DetailSection,
  Empty,
  FactorIcon,
  SectionLink,
  StrengthPill,
  relativeTime,
} from "./parts";

function MatchDial({ value }: { value: number | null }) {
  const pct = value ?? 0;
  return (
    <div
      className="relative grid size-[104px] shrink-0 place-items-center rounded-full"
      style={{
        background: `conic-gradient(var(--color-royal) ${pct * 3.6}deg, var(--color-cloud-strong) 0deg)`,
      }}
      role="img"
      aria-label={value === null ? "ICP match not scored" : `ICP match ${value} percent`}
    >
      <div className="grid size-[80px] place-items-center rounded-full bg-card text-center">
        <span className="text-[18px] font-semibold text-foreground">
          {value === null ? "-" : `${value}%`}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
          ICP match
        </span>
      </div>
    </div>
  );
}

export function ScoutSummaryCard({
  summary,
  onViewRationale,
}: {
  summary: ScoutCompanySummary;
  onViewRationale: () => void;
}) {
  return (
    <DetailSection
      title="Scout summary"
      emphasis="lead"
      meta={`Confidence: ${summary.confidence}`}
    >
      <div className="grid gap-5 sm:grid-cols-[104px_minmax(0,1fr)] sm:items-start">
        <MatchDial value={summary.icpMatch} />
        <div className="min-w-0">
          <p className="text-[15px] leading-relaxed text-foreground">{summary.summary}</p>

          <ul className="mt-4 space-y-2">
            {summary.topReasons.length === 0 ? (
              <li className="text-[13px] text-muted-foreground">
                No reasons yet, this company has not been researched.
              </li>
            ) : (
              summary.topReasons.slice(0, 3).map((reason) => (
                <li key={reason} className="flex gap-2 text-[13px] text-muted-foreground">
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-royal" />
                  <span className="min-w-0">{reason}</span>
                </li>
              ))
            )}
          </ul>

          <div className="mt-4">
            <SectionLink onClick={onViewRationale}>View full rationale</SectionLink>
          </div>
        </div>
      </div>

    </DetailSection>
  );
}

export function KeySignalsCard({
  signals,
  total,
  onViewAll,
}: {
  signals: RankedSignal[];
  total: number;
  onViewAll: () => void;
}) {
  return (
    <DetailSection
      title="Key signals"
      meta={total > 0 ? `${total} on record` : undefined}
      action={total > signals.length ? <SectionLink onClick={onViewAll}>View all signals</SectionLink> : undefined}
    >
      {signals.length === 0 ? (
        <Empty>Scout has not found strong signals for this company yet.</Empty>
      ) : (
        <ul className="space-y-2">
          {signals.map((signal) => (
            <li
              key={signal.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-lg border border-border bg-cloud/60 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-foreground">{signal.title}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{signal.explanation}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {relativeTime(signal.observedAt)}
                </span>
                <StrengthPill strength={signal.strength} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}

export function IcpAlignmentCard({
  view,
  onViewAnalysis,
}: {
  view: ICPFactorView;
  onViewAnalysis: () => void;
}) {
  return (
    <DetailSection
      title="ICP factor alignment"
      meta={view.headline}
      action={<SectionLink onClick={onViewAnalysis}>View ICP analysis</SectionLink>}
    >
      {view.factors.length === 0 ? (
        <Empty>No ICP factors have been evaluated for this company yet.</Empty>
      ) : (
        <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {view.factors.map((factor) => (
            <li key={factor.factorKey} className="flex gap-2.5">
              <FactorIcon status={factor.status} />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground">{factor.label}</p>
                <p className="text-[12px] text-muted-foreground">
                  {factor.value ?? "Not known yet"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}

export function RecentActivityCard({
  events,
  onViewAll,
}: {
  events: ActivityEvent[];
  onViewAll: () => void;
}) {
  return (
    <DetailSection
      title="Recent Scout activity"
      emphasis="quiet"
      action={events.length > 0 ? <SectionLink onClick={onViewAll}>View all activity</SectionLink> : undefined}
    >
      {events.length === 0 ? (
        <Empty>No recent Scout activity.</Empty>
      ) : (
        <ol className="space-y-3">
          {events.slice(0, 4).map((event) => (
            <li key={event.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground">
                  {event.name.split(".")[1]?.replace(/_/g, " ") ?? event.name}
                </p>
                <p className="truncate text-[12px] text-muted-foreground">{event.summary}</p>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {relativeTime(event.occurredAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </DetailSection>
  );
}

export function SimilarCompaniesCard({
  companies,
  linkSearch,
}: {
  companies: SimilarCompany[];
  linkSearch: ScoutLinkSearch;
}) {
  return (
    <DetailSection title="Similar companies you're tracking" emphasis="quiet">
      {companies.length === 0 ? (
        <Empty>No close matches found yet.</Empty>
      ) : (
        <ul className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
          {companies.map((company) => (
            <li key={company.id} className="w-[190px] shrink-0">
              <Link
                to="/modules/scout/prospects/$prospectId"
                params={{ prospectId: company.id }}
                search={linkSearch}
                className="block h-full rounded-lg border border-border bg-card p-3 transition-colors hover:bg-cloud focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CompanyMark
                  name={company.name}
                  websiteUrl={company.websiteUrl}
                  themeColor={company.themeColor ?? null}
                  logoUrl={company.logoUrl ?? null}
                  size="sm"
                />
                <p className="mt-2 truncate text-[13px] font-medium text-foreground">
                  {company.name}
                </p>
                <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                  <FitDot light={company.light} />
                  {company.icpMatch === null ? "Not scored" : `${company.icpMatch}% match`}
                </p>
                <p className="mt-1 truncate text-[12px] text-muted-foreground">
                  {company.industry ?? "Industry not recorded"}
                </p>
                <p className="truncate text-[12px] text-muted-foreground">
                  {company.size ?? "Size not recorded"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}
