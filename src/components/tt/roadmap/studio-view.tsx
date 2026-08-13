/**
 * Studio view.
 *
 * Two layers, deliberately different in character.
 *
 * The internal layer is restrained: a readiness strip that says what the room
 * has approved, and quiet controls for composing, editing and reading
 * provenance. It sits around the artifact, never inside it.
 *
 * The client layer is the document. It renders as presentation pages rather
 * than as a stack of cards, because this is what a client actually reads: a
 * title page carrying the conviction, a current position with its proof, one
 * page per approved milestone with What It Unlocks and a visual concept, and a
 * closing note from Tai. The client's own logo and accent appear only when
 * they were validated from the company's own site; otherwise Roadmap's own
 * accent carries the page. Nothing about a client is invented here.
 */

import { useEffect, useMemo, useState } from "react";

import { AmbientSurface } from "@/components/tt/ambient";
import { EvidenceList } from "@/components/tt/roadmap/tier";
import { EmptyState, MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import {
  buildEvidencePacket,
  packetFactIndex,
  packetSummary,
  type PacketFact,
} from "@/data/roadmap-studio-packet";
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

/* ------------------------------------------------------------- orientation */

/**
 * What the room has approved, before it presses compose. Compact by design:
 * counts, freshness, provenance, and the exact missing approval when the
 * packet cannot carry a document yet.
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
        <MetaPill>{summary.ready ? "Ready" : "Not ready"}</MetaPill>
        <MetaPill>{summary.observedFactCount} observed facts</MetaPill>
        <MetaPill>
          {summary.sourceCount} {summary.sourceCount === 1 ? "source" : "sources"}
        </MetaPill>
        <MetaPill>{summary.approvedStrategyCount} approved strategy</MetaPill>
        <MetaPill>{summary.approvedMilestoneCount} approved milestones</MetaPill>
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
        Last generated {when(artifact?.generatedAt)}.{" "}
        {artifact?.provider || artifact?.model
          ? `Written by ${artifact.provider ?? "unknown provider"} ${artifact.model ?? ""}.`
          : "No provider on record yet."}
        {summary.checkedAt ? ` Research checked ${when(summary.checkedAt)}.` : ""}
      </p>
    </div>
  );
}

/* ----------------------------------------------------------- client canvas */

/** Presentation proportion on desktop, honest reading height on mobile. */
const PAGE =
  "relative overflow-hidden rounded-xl border border-border bg-card px-6 py-10 md:aspect-[16/9] md:px-16 md:py-14";

function Backing({
  section,
  facts,
}: {
  section: ArtifactSection;
  facts: Map<string, PacketFact>;
}) {
  const keys = section.supportKeys ?? [];
  const known = keys.map((key) => facts.get(key)).filter(Boolean) as PacketFact[];
  if (keys.length === 0) return null;

  return (
    <details className="mt-3">
      <summary className="cursor-pointer font-mono text-[11px] text-muted-foreground">
        Backed by {keys.length} approved {keys.length === 1 ? "fact" : "facts"}
      </summary>
      <ul className="mt-2 space-y-2">
        {known.map((fact) => (
          <li key={fact.key} className="text-xs text-muted-foreground">
            <span className="text-foreground">{fact.statement}</span> {fact.because}
          </li>
        ))}
      </ul>
      <EvidenceList
        evidence={section.sources.map((ref) => ({
          label: ref.label,
          url: ref.url,
          kind: "page" as const,
        }))}
      />
    </details>
  );
}

/** The title page. Conviction first, identity second, Trust Tai as the frame. */
function TitlePage({ artifact, section }: { artifact: RoadmapArtifact; section: ArtifactSection }) {
  return (
    <AmbientSurface
      appId="roadmap"
      contextAccent={artifact.accent ?? null}
      strength="present"
      depth="deep"
      rule
      as="header"
      className={`${PAGE} flex flex-col justify-between`}
    >
      <div className="flex items-start justify-between gap-6">
        {artifact.logoUrl ? (
          <img
            src={artifact.logoUrl}
            alt=""
            className="h-10 w-auto max-w-40 object-contain"
            loading="lazy"
          />
        ) : (
          <span aria-hidden />
        )}
        <p className="tt-eyebrow">Prepared by Trust Tai</p>
      </div>

      <div>
        <p className="tt-eyebrow">Roadmap</p>
        <h2 className="mt-4 max-w-reading font-display text-4xl leading-[1.05] text-foreground md:text-6xl">
          {section.title}
        </h2>
        {section.body.slice(0, 2).map((paragraph, index) => (
          <p
            key={index}
            className="mt-5 max-w-reading text-base leading-relaxed text-muted-foreground md:text-lg"
          >
            {paragraph}
          </p>
        ))}
      </div>

      {section.body.length > 2 ? (
        <div className="mt-8 grid gap-4 border-t border-border/60 pt-6 md:grid-cols-3">
          {section.body.slice(2, 5).map((proof, index) => (
            <p key={index} className="text-sm leading-relaxed text-foreground">
              {proof}
            </p>
          ))}
        </div>
      ) : (
        <p className="font-mono text-xs text-muted-foreground">{artifact.title}</p>
      )}
    </AmbientSurface>
  );
}

/** A milestone page: what gets built on the left, what it unlocks on the right. */
function MilestonePage({
  section,
  number,
  accent,
}: {
  section: ArtifactSection;
  number: number;
  accent: string | null;
}) {
  return (
    <AmbientSurface
      appId="roadmap"
      contextAccent={accent}
      strength="faint"
      depth="shallow"
      as="article"
      className={PAGE}
    >
      <div className="grid h-full gap-8 md:grid-cols-[1.15fr_0.85fr]">
        <div className="flex flex-col">
          <p className="font-mono text-xs text-muted-foreground">
            Milestone {String(number).padStart(2, "0")}
          </p>
          <h3 className="mt-3 max-w-reading font-display text-3xl leading-tight text-foreground md:text-4xl">
            {section.title}
          </h3>
          <div className="mt-5 space-y-4">
            {section.body.map((paragraph, index) => (
              <p key={index} className="max-w-reading text-sm leading-relaxed text-foreground">
                {paragraph}
              </p>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-6 md:border-l md:border-border/60 md:pl-8">
          {section.unlocks && section.unlocks.length > 0 ? (
            <div>
              <p className="tt-eyebrow">What it unlocks</p>
              <ul className="mt-3 space-y-3">
                {section.unlocks.map((line) => (
                  <li key={line} className="text-sm leading-relaxed text-foreground">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {section.visualDirection ? (
            <figure className="mt-auto rounded-lg border border-dashed border-border bg-secondary/50 px-5 py-5">
              <p className="tt-eyebrow">Visual concept</p>
              <figcaption className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {section.visualDirection}
              </figcaption>
            </figure>
          ) : null}
        </div>
      </div>
    </AmbientSurface>
  );
}

/** Point A, the market gap, the closing note. One idea, room to breathe. */
function EditorialPage({
  section,
  accent,
  note,
}: {
  section: ArtifactSection;
  accent: string | null;
  note: boolean;
}) {
  return (
    <AmbientSurface
      appId="roadmap"
      contextAccent={accent}
      strength={note ? "default" : "faint"}
      depth="shallow"
      as="article"
      className={PAGE}
    >
      <div className="flex h-full flex-col">
        {section.caption ? <p className="tt-eyebrow">{section.caption}</p> : null}
        <h3
          className={
            note
              ? "max-w-reading font-display text-3xl italic leading-tight text-foreground md:text-4xl"
              : "max-w-reading font-display text-3xl leading-tight text-foreground md:text-5xl"
          }
        >
          {section.title}
        </h3>

        <div className={note ? "mt-6 space-y-4 md:max-w-reading" : "mt-6 grid gap-5 md:grid-cols-2"}>
          {section.body.map((paragraph, index) => (
            <p
              key={index}
              className={
                note
                  ? "max-w-reading text-base leading-loose text-foreground"
                  : "text-sm leading-relaxed text-foreground"
              }
            >
              {paragraph}
            </p>
          ))}
        </div>

        {note ? <p className="mt-8 font-display text-xl text-foreground">Tai</p> : null}

        {!note && section.visualDirection ? (
          <figure className="mt-auto border-t border-border/60 pt-5">
            <p className="tt-eyebrow">Visual concept</p>
            <figcaption className="mt-2 max-w-reading text-sm leading-relaxed text-muted-foreground">
              {section.visualDirection}
            </figcaption>
          </figure>
        ) : null}
      </div>
    </AmbientSurface>
  );
}

/* -------------------------------------------------------------- the artifact */

function Document({
  artifact,
  label,
  busy,
  facts,
  onEdit,
}: {
  artifact: RoadmapArtifact;
  label: string;
  busy: boolean;
  facts: Map<string, PacketFact>;
  onEdit: (artifact: RoadmapArtifact, sections: ArtifactSection[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ArtifactSection[]>(artifact.sections);

  useEffect(() => {
    setDraft(artifact.sections);
    setEditing(false);
  }, [artifact.id, artifact.updatedAt, artifact.sections]);

  const accent = artifact.accent ?? null;
  let milestone = 0;

  return (
    <section aria-label={label}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="tt-eyebrow">{label}</p>
          {artifact.version > 1 ? <MetaPill>Version {artifact.version}</MetaPill> : null}
          {artifact.humanEdited ? <MetaPill>Edited by hand</MetaPill> : null}
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

      {editing ? (
        <ul className="space-y-4">
          {draft.map((section) => (
            <li key={section.key} className="tt-surface p-5">
              <p className="tt-eyebrow">{section.title}</p>
              <textarea
                className="tt-input mt-2 min-h-40 w-full text-sm leading-relaxed"
                defaultValue={section.body.join("\n\n")}
                onChange={(event) =>
                  setDraft((current) =>
                    current.map((entry) =>
                      entry.key === section.key
                        ? {
                            ...entry,
                            body: event.target.value
                              .split(/\n{2,}/)
                              .map((line) => line.trim())
                              .filter(Boolean),
                          }
                        : entry,
                    ),
                  )
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-6">
          {artifact.sections.map((section, index) => {
            const isMilestone = section.key.startsWith("milestone-");
            if (isMilestone) milestone += 1;
            return (
              <li key={section.key}>
                {index === 0 && section.key === "title" ? (
                  <TitlePage artifact={artifact} section={section} />
                ) : isMilestone ? (
                  <MilestonePage section={section} number={milestone} accent={accent} />
                ) : (
                  <EditorialPage
                    section={section}
                    accent={accent}
                    note={section.key === "note-from-tai"}
                  />
                )}
                {/* Provenance lives outside the client page, never on it. */}
                <Backing section={section} facts={facts} />
              </li>
            );
          })}
        </ul>
      )}

      {artifact.rejected.length > 0 ? (
        <details className="tt-surface mt-6 p-5">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {artifact.rejected.length} lines were refused for lacking approved backing
          </summary>
          <ul className="mt-3 space-y-2">
            {artifact.rejected.map((entry, index) => (
              <li key={index} className="text-xs text-muted-foreground">
                <span className="text-foreground">{entry.line}</span> {entry.reason}
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

  const packet = useMemo(
    () => buildEvidencePacket({ subjectLabel, kind: tab, strategy, milestones, research }),
    [subjectLabel, tab, strategy, milestones, research],
  );
  const summary = packetSummary(packet);
  const facts = useMemo(() => packetFactIndex(packet), [packet]);

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Studio"
        title="The client roadmap"
        description="Title page, Point A, the market gap and a note from Tai. The full roadmap adds one page per approved milestone. Approved strategy, approved milestones and sourced research only."
        action={
          <TTButton
            disabled={busy || !summary.ready}
            onClick={() => onCompose(tab, artifact?.humanEdited === true)}
          >
            {!artifact
              ? `Compose ${name}`
              : artifact.humanEdited
                ? `Replace ${name}`
                : `Recompose ${name}`}
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
          facts={facts}
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
