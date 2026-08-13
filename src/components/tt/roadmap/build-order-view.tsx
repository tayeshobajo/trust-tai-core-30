/**
 * Build Order.
 *
 * Decided work only. A milestone appears here after a person approved it, in
 * the sequence it should be built, with its owner, its dependencies, and an
 * honest readiness read. Nothing proposed can slip in.
 */

import { EvidenceList, TierChip } from "@/components/tt/roadmap/tier";
import { EmptyState, MetaPill, SectionHeading } from "@/components/tt/primitives";
import { buildOrder, readiness } from "@/data/roadmap-milestones";
import type { RoadmapMilestone } from "@/domain/roadmap-intel";
import { UNKNOWN } from "@/domain/roadmap-intel";

export function BuildOrderView({ milestones }: { milestones: RoadmapMilestone[] }) {
  const ordered = buildOrder(milestones);

  if (ordered.length === 0) {
    return (
      <EmptyState
        title="Nothing has been approved yet."
        belongsHere="Build Order shows Decided milestones only, in the order they should be built."
        whyItMatters="Only a Decided milestone can be prepared for Projects. A proposal cannot enter here."
      />
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow={`${ordered.length} approved`}
        title="Build order"
        description="Decided work, sequenced. Readiness is read from the record, not assumed."
      />
      <ol className="space-y-4">
        {ordered.map((milestone, index) => {
          const ready = readiness(milestone);
          return (
            <li key={milestone.id} className="tt-surface p-6">
              <div className="flex flex-wrap items-center gap-2">
                <MetaPill>Step {index + 1}</MetaPill>
                <TierChip tier={milestone.tier} />
                <MetaPill>
                  {ready.ready ? "Ready for Projects" : "Not ready for Projects"}
                </MetaPill>
                <MetaPill>Carried by {milestone.ownerLabel ?? "no one yet"}</MetaPill>
              </div>
              <h3 className="mt-3 font-display text-2xl text-foreground">{milestone.name}</h3>
              <p className="mt-1 max-w-reading text-sm text-muted-foreground">
                {milestone.whatWeBuild || UNKNOWN}
              </p>
              <p className="mt-3 text-sm text-foreground">Next move: {ready.because}</p>
              {milestone.dependencies.length > 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Depends on: {milestone.dependencies.join(", ")}
                </p>
              ) : null}
              {milestone.decisionNote ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Decided because: {milestone.decisionNote}
                </p>
              ) : null}
              <EvidenceList
                evidence={milestone.evidence.map((ref) => ({
                  label: ref.label,
                  url: ref.url,
                  kind: "page" as const,
                }))}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
