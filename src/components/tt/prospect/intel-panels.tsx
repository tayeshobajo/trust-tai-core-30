/**
 * Buying signals, digital opportunities, and what is still missing.
 *
 * Three surfaces, one rule: every claim carries what it was read from, and an
 * empty state says "not established" rather than implying a negative finding.
 */

import { OPPORTUNITY_AREA_LABEL, type GapPlan, type ScoutIntel } from "@/domain/scout-intel";

import { Panel, RailCard, SourceLink, TierTag } from "./panel";

function dateLabel(iso?: string): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? iso : new Date(at).toLocaleDateString();
}

/** Why now, public, dated reasons this company might be buying. */
export function BuyingSignalsPanel({ intel }: { intel: ScoutIntel }) {
  return (
    <Panel
      eyebrow="Why now"
      title={`${intel.buyingSignals.length} timing signal${intel.buyingSignals.length === 1 ? "" : "s"}`}
      description="Public activity that suggests this company may be ready to spend. No signal found is unknown, not a no."
      aside={<TierTag tier="fact" />}
    >
      <ul className="space-y-4">
        {intel.buyingSignals.map((signal, index) => (
          <li key={`${signal.statement}-${index}`} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {signal.type.replace(/_/g, " ")}
              </p>
              {dateLabel(signal.observedAt) ? (
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {dateLabel(signal.observedAt)}
                </p>
              ) : null}
            </div>
            <p className="mt-1 text-[13px] text-foreground">{signal.statement}</p>
            {signal.sourceUrl ? (
              <div className="mt-1.5">
                <SourceLink url={signal.sourceUrl} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** What Trust Tai could actually fix, and what was seen that says so. */
export function OpportunitiesPanel({ intel }: { intel: ScoutIntel }) {
  return (
    <Panel
      eyebrow="The work"
      title={`${intel.opportunities.length} observed problem${intel.opportunities.length === 1 ? "" : "s"}`}
      description="Problems seen on their public site that Trust Tai could realistically solve. Nothing here claims an audit that was not run."
      aside={<TierTag tier="fact" />}
    >
      <ul className="space-y-4">
        {intel.opportunities.map((item, index) => (
          <li key={`${item.statement}-${index}`} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {OPPORTUNITY_AREA_LABEL[item.area]}
            </p>
            <p className="mt-1 text-[13px] text-foreground">{item.statement}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{item.evidence}</p>
            {item.sourceUrl ? (
              <div className="mt-1.5">
                <SourceLink url={item.sourceUrl} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** What Scout still needs, and whether it can close the gap itself. */
export function GapsCard({
  plan,
  onResearch,
  canResearch,
  busy,
}: {
  plan: GapPlan;
  onResearch: () => void;
  canResearch: boolean;
  busy?: boolean | undefined;
}) {
  return (
    <RailCard title="Still missing">
      <div className="space-y-3">
        <p className="text-[13px] text-muted-foreground">{plan.summary}</p>
        <ul className="space-y-3">
          {plan.gaps.slice(0, 5).map((gap) => (
            <li key={gap.key}>
              <p className="text-[13px] font-medium text-foreground">{gap.label}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{gap.plan}</p>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {gap.autonomous ? "Scout can close this" : "Needs a person or provider"}
              </p>
            </li>
          ))}
        </ul>
        {plan.actionable && canResearch ? (
          <button
            type="button"
            onClick={onResearch}
            disabled={busy}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-foreground transition-colors hover:bg-secondary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {busy ? "Researching…" : "Research what is missing"}
          </button>
        ) : null}
      </div>
    </RailCard>
  );
}
