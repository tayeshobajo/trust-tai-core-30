/**
 * Studio view.
 *
 * The client-facing structure, composed from approved strategy and approved
 * milestones only. It is a document skeleton with visual direction, never a
 * promise of a delivered asset, and never a company fact we did not source.
 */

import { EvidenceList, TierChip } from "@/components/tt/roadmap/tier";
import { EmptyState, MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import type { ArtifactSection, RoadmapArtifact } from "@/domain/roadmap-intel";

function SectionCard({ section }: { section: ArtifactSection }) {
  return (
    <li className="tt-surface p-6">
      <div className="flex flex-wrap items-center gap-2">
        <TierChip tier={section.tier} />
        {section.caption ? <MetaPill>{section.caption}</MetaPill> : null}
      </div>
      <h3 className="mt-3 font-display text-2xl text-foreground">{section.title}</h3>
      {section.body.map((paragraph, index) => (
        <p key={index} className="mt-2 max-w-reading text-sm text-foreground">
          {paragraph}
        </p>
      ))}
      {section.unlocks && section.unlocks.length > 0 ? (
        <div className="mt-4">
          <p className="tt-eyebrow">What it unlocks</p>
          <ul className="mt-1 space-y-1">
            {section.unlocks.map((line) => (
              <li key={line} className="text-sm text-muted-foreground">
                — {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {section.visualDirection ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Visual direction: {section.visualDirection}
        </p>
      ) : null}
      <EvidenceList
        evidence={section.sources.map((ref) => ({
          label: ref.label,
          url: ref.url,
          kind: "page" as const,
        }))}
      />
    </li>
  );
}

export function StudioView({
  preview,
  full,
  busy,
  onCompose,
}: {
  preview: RoadmapArtifact | null;
  full: RoadmapArtifact | null;
  busy: boolean;
  onCompose: (kind: "preview" | "full") => void;
}) {
  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Studio"
        title="Roadmap preview"
        description="Title page, Point A, the market gap, and a note from Tai. Approved strategy only."
        action={
          <div className="flex flex-wrap gap-2">
            <TTButton variant="secondary" disabled={busy} onClick={() => onCompose("preview")}>
              {preview ? "Recompose preview" : "Compose preview"}
            </TTButton>
            <TTButton variant="secondary" disabled={busy} onClick={() => onCompose("full")}>
              {full ? "Recompose full roadmap" : "Compose full roadmap"}
            </TTButton>
          </div>
        }
      />

      {!preview && !full ? (
        <EmptyState
          title="Nothing has been composed yet."
          belongsHere="Studio turns approved strategy and approved milestones into a structure a client can read."
          whyItMatters="Anything not approved appears as Unknown rather than as a confident sentence."
        />
      ) : null}

      {preview ? (
        <section aria-label="Roadmap preview">
          <p className="tt-eyebrow mb-3">Preview structure</p>
          <ul className="space-y-4">
            {preview.sections.map((section) => (
              <SectionCard key={section.key} section={section} />
            ))}
          </ul>
        </section>
      ) : null}

      {full ? (
        <section aria-label="Full roadmap">
          <p className="tt-eyebrow mb-3">Full roadmap structure</p>
          <ul className="space-y-4">
            {full.sections.map((section) => (
              <SectionCard key={section.key} section={section} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
