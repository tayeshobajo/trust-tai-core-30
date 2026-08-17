/**
 * Research view.
 *
 * What we actually know about this business, and where each line came from.
 * A claim with no source is never dressed up as a fact, and the gaps are
 * printed next to the findings rather than hidden below them.
 */

import { EvidenceList, TierChip } from "@/components/tt/roadmap/tier";
import { EmptyState, MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import { CONFIDENCE_LEVEL_LABEL } from "@/domain/confidence";
import type { ResearchClaim, RoadmapResearch } from "@/domain/roadmap-intel";
import { freshness } from "@/domain/roadmap-intel";

function ClaimList({ claims }: { claims: ResearchClaim[] }) {
  if (claims.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing established here yet.</p>;
  }
  return (
    <ul className="space-y-4">
      {claims.map((claim, index) => (
        <li key={`${claim.statement}-${index}`}>
          <div className="flex flex-wrap items-center gap-2">
            <TierChip tier={claim.tier} />
            <MetaPill>{CONFIDENCE_LEVEL_LABEL[claim.confidence]}</MetaPill>
          </div>
          <p className="mt-2 max-w-reading text-sm text-foreground">{claim.statement}</p>
          <EvidenceList
            evidence={claim.sources.map((ref) => ({
              label: ref.label,
              url: ref.url,
              kind: "page" as const,
            }))}
          />
        </li>
      ))}
    </ul>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="tt-surface p-6">
      <SectionHeading title={title} description={description} />
      {children}
    </section>
  );
}

export function ResearchView({
  research,
  history,
  running,
  stage,
  error,
  onRun,
}: {
  research: RoadmapResearch | null;
  history: RoadmapResearch[];
  running: boolean;
  stage: string | null;
  error: string | null;
  onRun: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <MetaPill>{freshness(research?.checkedAt)}</MetaPill>
          {research?.provider ? (
            <MetaPill>
              {research.provider} · {research.model}
            </MetaPill>
          ) : null}
          {research ? <MetaPill>{research.sources.length} sources</MetaPill> : null}
          {research ? <MetaPill>{research.unknowns.length} unknowns</MetaPill> : null}
        </div>
        <TTButton onClick={onRun} disabled={running}>
          {running ? "Researching…" : research ? "Research again" : "Research this business"}
        </TTButton>
      </div>

      {running && stage ? (
        <p
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {stage}
        </p>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!research ? (
        <EmptyState
          title="No research has been run yet."
          belongsHere="Roadmap reads the public web for this company and stores every claim with its source."
          whyItMatters="Understanding the business comes before proposing anything to build."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="How the business works" description="The model, in its own terms.">
            <ClaimList claims={research.companyModel} />
          </Panel>
          <Panel title="Who buys" description="The people the business actually sells to.">
            <ClaimList claims={research.buyers} />
          </Panel>
          <Panel
            title="What leadership has already built"
            description="Recognised, not re-invented. This is where anchor proof comes from."
          >
            <ClaimList claims={research.strengths} />
          </Panel>
          <Panel title="Public digital presence" description="What the market can see today.">
            <ClaimList claims={research.digitalPresence} />
          </Panel>
          <Panel
            title="Competitors"
            description="Read for market direction, never for features to copy."
          >
            {research.competitors.length === 0 ? (
              <p className="text-sm text-muted-foreground">No competitor is established yet.</p>
            ) : (
              <ul className="space-y-4">
                {research.competitors.map((entry) => (
                  <li key={entry.name}>
                    <div className="flex flex-wrap items-center gap-2">
                      <TierChip tier={entry.tier} />
                      <span className="text-sm font-medium text-foreground">{entry.name}</span>
                    </div>
                    <p className="mt-1 max-w-reading text-sm text-muted-foreground">
                      {entry.positioning}
                    </p>
                    <EvidenceList
                      evidence={entry.sources.map((ref) => ({
                        label: ref.label,
                        url: ref.url,
                        kind: "page" as const,
                      }))}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Where the category is heading" description="Market direction on record.">
            <ClaimList claims={research.marketDirection} />
          </Panel>
        </div>
      )}

      {research && research.unknowns.length > 0 ? (
        <section className="tt-surface p-6" aria-label="Not established">
          <p className="tt-eyebrow">Not established</p>
          <ul className="mt-3 space-y-1.5">
            {research.unknowns.map((entry) => (
              <li key={entry} className="text-sm text-muted-foreground">
                — {entry}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {history.length > 1 ? (
        <section className="tt-surface p-6" aria-label="Research history">
          <p className="tt-eyebrow">Research history</p>
          <ul className="mt-3 space-y-1.5">
            {history.map((entry) => (
              <li key={entry.id} className="text-sm text-muted-foreground">
                {freshness(entry.checkedAt)} · {entry.sources.length} sources ·{" "}
                {entry.provider ?? "unknown provider"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
