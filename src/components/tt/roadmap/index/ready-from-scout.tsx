/**
 * Qualified Scout companies that do not have a roadmap yet.
 *
 * Just enough to decide whether to start a path, never a second Scout page.
 */

import { CompanyMark } from "@/components/tt/company-identity";
import { TTButton } from "@/components/tt/primitives";
import type { ProspectCandidate } from "@/domain/scout";

export function ScoutCompanyRoadmapCard({
  candidate,
  onCreate,
  busy,
}: {
  candidate: ProspectCandidate;
  onCreate: (candidate: ProspectCandidate) => void;
  busy: boolean;
}) {
  const { prospect, identity, evaluation } = candidate;
  const industry =
    typeof candidate.facts?.["industry"] === "string"
      ? String(candidate.facts["industry"])
      : prospect.domain;

  return (
    <article className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
      <CompanyMark
        name={prospect.name}
        websiteUrl={prospect.websiteUrl || prospect.domain}
        themeColor={identity?.themeColor ?? null}
        logoUrl={identity?.logoUrl ?? null}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-foreground">{prospect.name}</p>
        <p className="mt-0.5 text-[12px] text-success">{evaluation.score}% ICP match</p>
        <p className="truncate text-[11px] text-muted-foreground">{industry || "-"}</p>
      </div>
      <TTButton
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => onCreate(candidate)}
        className="shrink-0"
      >
        Create roadmap
      </TTButton>
    </article>
  );
}

export function ReadyFromScout({
  candidates,
  onCreate,
  busy,
}: {
  candidates: ProspectCandidate[];
  onCreate: (candidate: ProspectCandidate) => void;
  busy: boolean;
}) {
  if (candidates.length === 0) return null;
  return (
    <section aria-labelledby="ready-from-scout">
      <h2 id="ready-from-scout" className="text-[15px] font-medium text-foreground">
        Ready from Scout
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Qualified companies with no path yet.
      </p>
      <ul className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {candidates.slice(0, 6).map((candidate) => (
          <li key={candidate.prospect.id}>
            <ScoutCompanyRoadmapCard candidate={candidate} onCreate={onCreate} busy={busy} />
          </li>
        ))}
      </ul>
    </section>
  );
}
