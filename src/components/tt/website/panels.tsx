/**
 * Website room panels shared between Overview, Search and the page detail.
 *
 * Both panels exist to keep one promise: say what we can see, say plainly what
 * we cannot, and never let an absent provider read as a zero.
 */

import { SectionHeading } from "@/components/tt/primitives";
import { lastSynced } from "@/data/website/format";
import { stateLabel } from "@/data/website/freshness";
import type { AiReferralSummary, ProviderReadiness } from "@/domain/website-analytics";
import { cn } from "@/lib/utils";

export function ProviderReadinessPanel({
  readiness,
  compact = false,
}: {
  readiness: ProviderReadiness[];
  compact?: boolean;
}) {
  return (
    <div className="tt-surface p-5">
      <SectionHeading
        eyebrow="Sources"
        title="What is connected"
        {...(compact
          ? {}
          : {
              description:
                "Each source below either reported in this window or it did not. Anything it covers stays unknown while it is quiet.",
            })}
      />
      <ul className="space-y-3">
        {readiness.map((entry) => (
          <li key={entry.id} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-sm text-foreground">{entry.label}</span>
              <span
                className={cn(
                  "font-mono text-[11px] uppercase tracking-[0.12em]",
                  entry.state === "live" || (!entry.state && entry.connected)
                    ? "text-royal"
                    : "text-muted-foreground",
                )}
              >
                {entry.state ? stateLabel(entry.state) : entry.connected ? "Reporting" : "No data"}
              </span>
            </div>
            <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] text-muted-foreground">
              <span>Last sync {lastSynced(entry.lastSyncedAt)}</span>
              <span>{entry.rows} rows</span>
            </p>
            {compact ? null : (
              <>
                <p className="mt-1 text-[12px] text-muted-foreground">{entry.covers}</p>
                {entry.connected ? null : (
                  <p className="text-[12px] text-muted-foreground">{entry.note}</p>
                )}
                {entry.lastError ? (
                  <p className="text-[12px] text-muted-foreground">
                    Last run reported: {entry.lastError}
                  </p>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AiReferralsPanel({
  summary,
  description,
}: {
  summary: AiReferralSummary;
  description?: string;
}) {
  return (
    <div className="tt-surface p-5">
      <SectionHeading
        eyebrow="Sources"
        title="AI referrals"
        description={
          description ??
          "Arrivals where the referrer names an assistant we recognise. It counts visits we can attribute, not how often a model read or recommended the site."
        }
      />
      {summary.unmeasured ? (
        <p className="text-sm text-muted-foreground">
          No first party events have been received in this window, so assistant referrals stay
          unknown rather than zero.
        </p>
      ) : summary.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No arrival in this window carried a referrer from an assistant we recognise.{" "}
          {summary.attributableVisits} visits carried a readable referrer at all.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {summary.rows.map((row) => (
              <li key={row.host} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="truncate text-foreground">{row.label}</span>
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                    {row.host}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
                  {row.visits} visits · {row.submissions} conversations
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-muted-foreground">
            {summary.visits} of {summary.attributableVisits} visits with a readable referrer came
            from a named assistant. Arrivals with no referrer are counted as direct, so the real
            figure may be higher than this.
          </p>
        </>
      )}
    </div>
  );
}
