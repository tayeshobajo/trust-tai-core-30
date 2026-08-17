/**
 * The Scout company table — the core of the page.
 *
 * Logos come from the company's own site (or a recorded logo URL) via the
 * shared `CompanyMark`, which falls back to monogram initials when no icon
 * loads. Colour marks ICP fit only; workflow status is a separate quiet pill.
 */

import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

import { CompanyMark } from "@/components/tt/company-identity";
import { FitDot, FIT_LIGHT_LABEL, STAGE_LABEL, formatChecked } from "@/components/tt/fit-light";
import type { ProspectCandidate } from "@/domain/scout";
import type { ProspectStatus } from "@/domain/entities";
import type { FitLight } from "@/domain/scout-fit";
import { cn } from "@/lib/utils";

export type ScoutLinkSearch = { section: "scout" | "qualified" | "research"; fit: "all" | FitLight };

const STATUS_TONE: Record<ProspectStatus, string> = {
  discovered: "border-border bg-secondary text-muted-foreground",
  reviewing: "border-warning/30 bg-warning/8 text-warning",
  qualified: "border-success/25 bg-success/8 text-success",
  ready_for_comms: "border-royal/25 bg-royal/8 text-royal",
  passed: "border-border bg-secondary text-muted-foreground",
  converted: "border-success/25 bg-success/8 text-success",
  archived: "border-border bg-secondary text-muted-foreground",
};

export function ScoutStatusPill({ status }: { status: ProspectStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em]",
        STATUS_TONE[status],
      )}
    >
      {STAGE_LABEL[status]}
    </span>
  );
}

export function CompanyCell({ candidate }: { candidate: ProspectCandidate }) {
  const { prospect, identity } = candidate;
  return (
    <span className="flex min-w-0 items-center gap-3">
      <CompanyMark
        name={prospect.name}
        websiteUrl={prospect.websiteUrl || prospect.domain}
        themeColor={identity?.themeColor ?? null}
        logoUrl={identity?.logoUrl ?? null}
        size="sm"
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{prospect.name}</span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">
          {prospect.domain || "No website recorded"}
        </span>
      </span>
    </span>
  );
}

function Cell({ value }: { value?: string | undefined }) {
  return (
    <span className="hidden truncate text-[13px] text-muted-foreground xl:block">
      {value && value.trim() ? value : "—"}
    </span>
  );
}

const HEAD =
  "hidden grid-cols-[minmax(0,1.4fr)_auto_auto_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)_auto_auto_auto] items-center gap-4 border-b border-border bg-cloud px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground xl:grid";

export function ScoutCompanyTable({
  candidates,
  linkSearch,
  footer,
}: {
  candidates: ProspectCandidate[];
  linkSearch: ScoutLinkSearch;
  footer?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className={HEAD}>
        <span>Company</span>
        <span>ICP match</span>
        <span>Score</span>
        <span>Industry</span>
        <span>Size</span>
        <span>Location</span>
        <span>Status</span>
        <span>Added</span>
        <span className="sr-only">Open</span>
      </div>

      <ul>
        {candidates.map((candidate) => {
          const { prospect, evaluation, profile } = candidate;
          return (
            <li key={prospect.id}>
              <Link
                to="/modules/scout/prospects/$prospectId"
                params={{ prospectId: prospect.id }}
                search={linkSearch}
                aria-label={`Open ${prospect.name}`}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-cloud focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring xl:grid-cols-[minmax(0,1.4fr)_auto_auto_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)_auto_auto_auto]"
              >
                <CompanyCell candidate={candidate} />

                <span className="hidden items-center gap-2 xl:inline-flex">
                  <FitDot light={evaluation.light} />
                  <span className="sr-only">{FIT_LIGHT_LABEL[evaluation.light]}</span>
                </span>

                <span className="hidden font-mono text-[12px] text-foreground xl:block">
                  {evaluation.scoreable ? `${evaluation.score}%` : "—"}
                </span>

                <Cell value={profile?.industry} />
                <Cell value={profile?.size} />
                <Cell value={profile?.location} />

                <span className="flex items-center gap-2 justify-self-end xl:justify-self-auto">
                  <span className="inline-flex items-center gap-2 xl:hidden">
                    <FitDot light={evaluation.light} />
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {evaluation.scoreable ? `${evaluation.score}%` : "—"}
                    </span>
                  </span>
                  <ScoutStatusPill status={prospect.status} />
                </span>

                <span className="hidden font-mono text-[11px] text-muted-foreground xl:block">
                  {formatChecked(candidate.lastCheckedAt)}
                </span>

                <ChevronRight
                  aria-hidden
                  className="hidden size-4 shrink-0 text-muted-foreground xl:block"
                />
              </Link>
            </li>
          );
        })}
      </ul>

      {footer}
    </div>
  );
}
