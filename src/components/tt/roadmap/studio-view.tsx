/**
 * Studio view.
 *
 * Two layers, deliberately different in character.
 *
 * The internal layer is restrained: a readiness strip that says what the room
 * has approved, and quiet controls for composing and editing.
 *
 * The client layer is the document itself. It is rendered as pages rather than
 * as a stack of cards, because this is the artifact a client actually reads: a
 * title page that states the conviction, a current position, the gap, one page
 * per approved milestone with What It Unlocks, a visual direction, and a note
 * from Tai. The client's own validated accent and logo are used where they are
 * on record. Neither is ever invented.
 *
 * Every line here was written from approved strategy, approved milestones and
 * sourced observed research, then validated back against that same evidence.
 * Anything the validator refused is shown openly underneath.
 */

import { useEffect, useState } from "react";

import { AmbientSurface } from "@/components/tt/ambient";
import { EvidenceList, TierChip } from "@/components/tt/roadmap/tier";
import { EmptyState, MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import { buildEvidencePacket, packetSummary } from "@/data/roadmap-studio-packet";
import type {
  ArtifactSection,
  RoadmapArtifact,
  RoadmapMilestone,
  RoadmapResearch,
  RoadmapStrategy,
} from "@/domain/roadmap-intel";

function when(value: string | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Never"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Orientation before action.
 *
 * A compact strip, not a dashboard: what the document can be built from, and
 * if it cannot be built yet, exactly which approval is missing. Detail stays
 * folded away until it is needed.
 */
function ReadinessStrip({
  summary,
  artifact,
}: {
  summary: ReturnType<typeof packetSummary>;
  artifact: RoadmapArtifact | null;
}) {
  return (
    <div className="tt-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="tt-eyebrow">Approved evidence</p>
        <MetaPill>{summary.ready ? "Ready to compose" : "Not ready"}</MetaPill>
        <MetaPill>{summary.approvedStrategyCount} approved strategy</MetaPill>
        <MetaPill>{summary.approvedMilestoneCount} approved milestones</MetaPill>
        <MetaPill>{summary.observedFactCount} observed facts</MetaPill>
        <MetaPill>
          {summary.sourceCount} {summary.sourceCount === 1 ? "source" : "sources"}
        </MetaPill>
      </div>

      {summary.missing.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {summary.missing.map((line) => (
            <li key={line} className="text-sm text-muted-foreground">
              {line}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        {artifact
          ? `Written by ${artifact.provider ?? "unknown"} ${artifact.model ?? ""} on ${when(artifact.generatedAt)}.`
          : "Nothing composed yet."}
        {summary.checkedAt ? ` Research checked ${when(summary.checkedAt)}.` : ""}
      </p>
    </div>
  );
}

/** The client-facing title page. Conviction first, identity second. */
function TitlePage({
  artifact,
  section,
}: {
  artifact: RoadmapArtifact;
  section: ArtifactSection;
}) {
  return (
    <AmbientSurface
      appId="roadmap"
      contextAccent={artifact.accent ?? null}
      strength="present"
      depth="deep"
      rule
      as="header"
      className="tt-surface overflow-hidden px-6 py-12 md:px-12 md:py-20"
    >
      {artifact.logoUrl ? (
        <img
          src={artifact.logoUrl}
          alt={`${artifact.title} logo`}
          className="mb-8 h-10 w-auto object-contain"
          loading="lazy"
        />
      ) : null}
      <p className="tt-eyebrow">Roadmap</p>
      <h2 className="mt-4 max-w-reading font-display text-4xl leading-[1.1] text-foreground md:text-6xl">
        {section.title}
      </h2>
      {section.body.map((paragraph, index) => (
        <p
          key={index}
          className="mt-6 max-w-reading text-base leading-relaxed text-muted-foreground md:text-lg"
        >
          {paragraph}
        </p>
      ))}
    </AmbientSurface>
  );
}

/** One page of the client document. */
function DocumentPage({
  section,
  index,
  editing,
  onChange,
}: {
  section: ArtifactSection;
  index: number;
  editing: boolean;
  onChange: (body: string[]) => void;
}) {
  const milestone = section.key.startsWith("milestone-");

  return (
    <li className="tt-surface px-6 py-10 md:px-12 md:py-14">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {String(index).padStart(2, "0")}
        </span>
        <TierChip tier={section.tier} />
        {section.caption ? <MetaPill>{section.caption}</MetaPill> : null}
      </div>

      <h3 className="mt-4 max-w-reading font-display text-3xl leading-tight text-foreground md:text-4xl">
        {section.title}
      </h3>

      {editing ? (
        <label className="mt-6 block">
          <span className="tt-eyebrow">Edit this page</span>
          <textarea
            className="tt-input mt-2 min-h-40 w-full text-sm leading-relaxed"
            defaultValue={section.body.join("\n\n")}
            onChange={(event) =>
              onChange(
                event.target.value
                  .split(/\n{2,}/)
                  .map((line) => line.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
      ) : (
        section.body.map((paragraph, position) => (
          <p
            key={position}
            className="mt-5 max-w-reading text-base leading-relaxed text-foreground"
          >
            {paragraph}
          </p>
        ))
      )}

      {section.unlocks && section.unlocks.length > 0 ? (
        <div className="mt-8 border-l-2 border-primary/40 pl-5">
          <p className="tt-eyebrow">What it unlocks</p>
          <ul className="mt-2 space-y-2">
            {section.unlocks.map((line) => (
              <li key={line} className="max-w-reading text-sm leading-relaxed text-foreground">
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {section.visualDirection ? (
        <figure className="mt-8 rounded-lg border border-dashed border-border bg-secondary/40 px-5 py-6">
          <p className="tt-eyebrow">{milestone ? "Visual direction" : "How this page should look"}</p>
          <figcaption className="mt-2 max-w-reading text-sm leading-relaxed text-muted-foreground">
            {section.visualDirection}
          </figcaption>
        </figure>
      ) : null}

      <EvidenceList
        evidence={section.sources.map((ref) => ({
          label: ref.label,
          url: ref.url,
          kind: "page" as const,
        }))}
      />

      {section.supportKeys && section.supportKeys.length > 0 ? (
        <p className="mt-3 font-mono text-[11px] text-muted-foreground">
          Backed by {section.supportKeys.join(", ")}
        </p>
      ) : null}
    </li>
  );
}

function Document({
  artifact,
  label,
  busy,
  onEdit,
}: {
  artifact: RoadmapArtifact;
  label: string;
  busy: boolean;
  onEdit: (artifact: RoadmapArtifact, sections: ArtifactSection[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ArtifactSection[]>(artifact.sections);

  useEffect(() => {
    setDraft(artifact.sections);
    setEditing(false);
  }, [artifact.id, artifact.updatedAt, artifact.sections]);

  const sections = editing ? draft : artifact.sections;
  const [title, ...pages] = sections;

  return (
    <section aria-label={label}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="tt-eyebrow">{label}</p>
          {artifact.version > 1 ? <MetaPill>Version {artifact.version}</MetaPill> : null}
          {artifact.humanEdited ? <MetaPill>Edited by hand</MetaPill> : null}
          {artifact.model ? <MetaPill>{artifact.model}</MetaPill> : null}
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <TTButton
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setDraft(artifact.sections);
                  setEditing(false);
                }}
              >
                Cancel
              </TTButton>
              <TTButton disabled={busy} onClick={() => onEdit(artifact, draft)}>
                Save edits
              </TTButton>
            </>
          ) : (
            <TTButton variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </TTButton>
          )}
        </div>
      </div>

      {title && !editing ? <TitlePage artifact={artifact} section={title} /> : null}

      <ul className="mt-4 space-y-4">
        {(title && !editing ? pages : sections).map((section, index) => (
          <DocumentPage
            key={section.key}
            section={section}
            index={title && !editing ? index + 1 : index}
            editing={editing}
            onChange={(body) =>
              setDraft((current) =>
                current.map((entry, position) =>
                  entry.key === section.key ? { ...entry, body } : current[position]!,
                ),
              )
            }
          />
        ))}
      </ul>

      {artifact.rejected.length > 0 ? (
        <details className="tt-surface mt-4 p-5">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {artifact.rejected.length} lines were refused for lacking approved backing
          </summary>
          <ul className="mt-3 space-y-2">
            {artifact.rejected.map((entry, index) => (
              <li key={index} className="text-xs text-muted-foreground">
                <span className="text-foreground">{entry.line}</span> — {entry.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export function StudioView({
  subjectLabel,
  strategy,
  milestones,
  research,
  preview,
  full,
  busy,
  stage,
  onCompose,
  onEdit,
}: {
  subjectLabel: string;
  strategy: RoadmapStrategy | null;
  milestones: RoadmapMilestone[];
  research: RoadmapResearch | null;
  preview: RoadmapArtifact | null;
  full: RoadmapArtifact | null;
  busy: boolean;
  stage: string | null;
  onCompose: (kind: "preview" | "full", replace?: boolean) => void;
  onEdit: (artifact: RoadmapArtifact, sections: ArtifactSection[]) => void;
}) {
  const [tab, setTab] = useState<"preview" | "full">("preview");
  const artifact = tab === "preview" ? preview : full;
  const name = tab === "preview" ? "preview" : "full roadmap";
  const summary = packetSummary(
    buildEvidencePacket({ subjectLabel, kind: tab, strategy, milestones, research }),
  );

  function composeLabel() {
    if (!artifact) return `Compose ${name}`;
    return artifact.humanEdited ? `Replace ${name}` : `Recompose ${name}`;
  }

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Studio"
        title="The client roadmap"
        description="Title page, Point A, the market gap, and a note from Tai. The full roadmap adds one page per approved milestone. Approved strategy, approved milestones and sourced research only."
        action={
          <TTButton
            disabled={busy || !summary.ready}
            onClick={() => onCompose(tab, artifact?.humanEdited === true)}
          >
            {composeLabel()}
          </TTButton>
        }
      />

      <div role="tablist" aria-label="Roadmap documents" className="flex gap-2">
        {(["preview", "full"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            onClick={() => setTab(entry)}
            className={
              tab === entry
                ? "tt-ambient rounded-full border border-border px-4 py-1.5 text-sm text-foreground"
                : "rounded-full border border-border/60 px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            {entry === "preview" ? "Preview" : "Full roadmap"}
          </button>
        ))}
      </div>

      <ReadinessStrip summary={summary} artifact={artifact} />

      {busy && stage ? (
        <p className="text-sm text-muted-foreground" role="status">
          {stage}
        </p>
      ) : null}

      {artifact ? (
        <Document
          artifact={artifact}
          label={tab === "preview" ? "Roadmap preview" : "Full roadmap"}
          busy={busy}
          onEdit={onEdit}
        />
      ) : (
        <EmptyState
          title={`No ${name} has been composed yet.`}
          belongsHere="Studio turns approved strategy and approved milestones into language a client can read."
          whyItMatters="Anything not approved stays out of the document rather than becoming a confident sentence."
        />
      )}
    </div>
  );
}
