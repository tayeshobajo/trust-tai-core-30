/**
 * One open decision, surfaced above the list. Important, never alarming.
 */

import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { CompanyMark } from "@/components/tt/company-identity";
import { RoadmapStateBadge } from "@/components/tt/roadmap/index/list";
import type { RoadmapRowModel } from "@/data/roadmap-index";
import type { RoadmapDecision } from "@/domain/roadmap";

export function DecisionAttentionCard({
  row,
  decision,
}: {
  row: RoadmapRowModel;
  decision: RoadmapDecision;
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-warning/30 bg-warning/5">
      <div className="grid gap-4 border-l-2 border-warning p-4 sm:p-5 xl:grid-cols-[minmax(180px,1fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <CompanyMark
            name={row.company}
            websiteUrl={row.identity.websiteUrl ?? ""}
            themeColor={row.identity.themeColor ?? null}
            logoUrl={row.identity.logoUrl ?? null}
            size="sm"
          />
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-medium text-foreground">{row.company}</h3>
            <div className="mt-1">
              <RoadmapStateBadge state={row.state} />
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-[14px] font-medium text-foreground">{decision.question}</p>
          {decision.whyItMatters ? (
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {decision.whyItMatters}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3">
          <div className="min-w-0">
            <p className="tt-eyebrow">Point A</p>
            <p className="mt-1 text-[13px] leading-snug text-foreground">{row.pointA}</p>
          </div>
          <ArrowRight aria-hidden className="mt-5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="tt-eyebrow">Point B</p>
            <p className="mt-1 text-[13px] leading-snug text-foreground">{row.pointB}</p>
          </div>
        </div>

        <Link
          to="/modules/roadmap/$roadmapId"
          params={{ roadmapId: row.roadmapId }}
          search={{ view: "overview" as const }}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-primary px-5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open roadmap
        </Link>
      </div>
    </article>
  );
}
