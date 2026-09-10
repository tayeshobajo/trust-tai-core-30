/**
 * Routes nobody answered.
 *
 * Pulse and Steward read this; neither of them changes it. Each row says what
 * was asked, how long it has been silent, what the ask rests on, and links
 * back to the project that owns it, the only room that can withdraw or chase.
 */

import { Link } from "@tanstack/react-router";

import { MetaPill, SectionHeading, TTCard } from "@/components/tt/primitives";
import { ROUTE_TARGET_LABEL } from "@/domain/project-routing";
import { routeStanding, type RouteLedgerEntry } from "@/domain/route-ledger";

export function UnansweredRoutes({
  entries,
  loading,
}: {
  entries: RouteLedgerEntry[];
  loading?: boolean;
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Reading routed work.</p>;
  }
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="unanswered-routes" className="space-y-4">
      <SectionHeading
        eyebrow="Routed work"
        title={`${entries.length} routing request${entries.length === 1 ? "" : "s"} unanswered`}
        description="Projects asked another room to take this and nobody has answered. Silence is reported, not blamed; the project that asked is the room that decides what happens next."
      />
      <div id="unanswered-routes" className="space-y-4">
        {entries.map((entry) => (
          <TTCard key={entry.key} className="space-y-3 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <MetaPill>{ROUTE_TARGET_LABEL[entry.targetApp]}</MetaPill>
              <MetaPill>
                {entry.ageDays} day{entry.ageDays === 1 ? "" : "s"} silent
              </MetaPill>
              {entry.notification && !entry.notification.delivered ? (
                <MetaPill>Not notified</MetaPill>
              ) : null}
            </div>
            <p className="max-w-reading text-sm text-foreground">{entry.requestedOutcome}</p>
            <p className="max-w-reading text-sm text-muted-foreground">{routeStanding(entry)}</p>
            {entry.because ? (
              <p className="max-w-reading text-sm text-muted-foreground">Why: {entry.because}</p>
            ) : null}
            {entry.notification && !entry.notification.delivered ? (
              <p className="max-w-reading text-xs text-muted-foreground">
                {entry.notification.because}
              </p>
            ) : null}
            {entry.evidence.length > 0 ? (
              <details className="group">
                <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground">
                  What this rests on →
                </summary>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {entry.evidence.map((item, index) => (
                    <li key={`${entry.key}-evidence-${index}`}>{item.label}</li>
                  ))}
                  {entry.dependencies.map((item, index) => (
                    <li key={`${entry.key}-dependency-${index}`}>Depends on: {item}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            <Link
              to="/modules/projects/$projectId"
              params={{ projectId: entry.projectId }}
              className="inline-block font-mono text-[10px] uppercase tracking-[0.16em] text-foreground underline-offset-4 hover:underline"
            >
              Open {entry.projectName} →
            </Link>
          </TTCard>
        ))}
      </div>
    </section>
  );
}
