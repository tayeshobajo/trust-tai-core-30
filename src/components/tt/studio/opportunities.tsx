/**
 * What Studio noticed.
 *
 * The quiet band above the composer. It shows what the Website room already
 * observed, what Studio makes of it, and the move Studio would suggest — and
 * it stops there. Nothing here writes, sends, drafts or publishes.
 *
 * Observed evidence and Studio's read are kept visually separate on purpose:
 * the numbers came from Search Console, the reading is Studio's, and the
 * reading is deterministic rather than reasoned by a model.
 */

import { Link } from "@tanstack/react-router";

import { SectionHeading, TTButton, TonePill, type PillTone } from "@/components/tt/primitives";
import type { OpportunityRowView, StudioOpportunitiesView } from "@/data/content/opportunity-view";

/** Observed is an evidence class, never a success state, so it is never green. */
function confidenceTone(row: OpportunityRowView): PillTone {
  return row.confidence === "observed" ? "active" : "neutral";
}

export function StudioOpportunities({
  view,
  loading,
  onDismiss,
  onBuildBrief,
  onOpenBrief,
  keptBriefIds,
  buildingId,
}: {
  view: StudioOpportunitiesView;
  loading: boolean;
  /** Sets a row aside. Recorded when the store is there, this visit if not. */
  onDismiss: (id: string) => void;
  /** Asks Studio to reason a brief out of this row. Writes nothing yet. */
  onBuildBrief: (row: OpportunityRowView) => void;
  /** Reopens a brief a person already kept. */
  onOpenBrief: (row: OpportunityRowView) => void;
  /** Opportunity ids that already have a kept brief. */
  keptBriefIds: readonly string[];
  /** The row Studio is reasoning about right now, if any. */
  buildingId: string | null;
}) {
  return (
    <section
      className="mb-10 rounded-2xl bg-studio-paper p-6 sm:p-8"
      aria-label="What Studio noticed"
    >
      <SectionHeading
        title="What Studio noticed"
        description="Phrases people used to find us, and what they might be worth. Studio noticed these; you decide whether any of them deserve a story."
      />

      {loading ? (
        <p className="mt-5 text-sm text-muted-foreground">Reading what search reported…</p>
      ) : view.state === "active" ? (
        <div className="mt-5 divide-y divide-border border-y border-border">
          {view.rows.map((row) => (
            <OpportunityRow
              key={row.id}
              row={row}
              kept={keptBriefIds.includes(row.id)}
              building={buildingId === row.id}
              onDismiss={() => onDismiss(row.id)}
              onBuildBrief={() => onBuildBrief(row)}
              onOpenBrief={() => onOpenBrief(row)}
            />
          ))}
        </div>
      ) : (
        <div className="mt-5 border-l-2 border-border pl-5 py-4">
          <p className="text-sm text-foreground">{view.quietLine}</p>
          {view.because.map((line) => (
            <p key={line} className="mt-2 text-[13px] text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function OpportunityRow({
  row,
  kept,
  building,
  onDismiss,
  onBuildBrief,
  onOpenBrief,
}: {
  row: OpportunityRowView;
  kept: boolean;
  building: boolean;
  onDismiss: () => void;
  onBuildBrief: () => void;
  onOpenBrief: () => void;
}) {
  return (
    <article className="p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-medium text-foreground">“{row.phrase}”</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {row.windowLabel} · {row.provenanceLabel}
          </p>
        </div>
        <TonePill tone={confidenceTone(row)} dot>
          {row.confidenceLabel}
        </TonePill>
      </div>

      <div className="mt-5 max-w-reading">
        <p className="text-xs font-medium text-royal">Studio's read</p>
        <p className="mt-1 text-[15px] leading-relaxed text-foreground">{row.interpretation}</p>
      </div>

      {row.overlap ? (
        <p className="mt-3 max-w-reading border-l-2 border-warning/40 pl-3 text-[13px] text-muted-foreground">
          {row.overlap}
        </p>
      ) : null}

      <div className="mt-5 border-t border-border/70 pt-4">
        <p className="text-xs font-medium text-muted-foreground">Observed evidence</p>
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
          <Stat label="Appearances" value={row.impressions} />
          <Stat label="Clicks" value={row.clicks} />
          <Stat label="Click rate" value={row.ctr} />
          <Stat label="Average position" value={row.averagePosition} />
        </dl>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="text-[13px] text-muted-foreground">Studio suggests · {row.moveLabel}</span>
        <span className="ml-auto flex items-center gap-1">
          <TTButton size="sm" variant="quiet" onClick={onDismiss}>
            Not now
          </TTButton>
          <Link
            to="/modules/website"
            className="rounded-full px-3 py-1.5 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Open in Website
          </Link>
        </span>
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm text-foreground">{value}</dd>
    </div>
  );
}
