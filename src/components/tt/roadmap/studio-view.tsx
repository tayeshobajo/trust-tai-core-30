/**
 * Studio view.
 *
 * The client facing document. Studio is model backed but evidence bound: every
 * line here was written from approved strategy and approved milestones, then
 * validated back against that same approved evidence before it was saved.
 *
 * The page is rendered editorially rather than as a data table, because this is
 * the artifact a client actually reads. Anything the validator refused is shown
 * openly underneath, so a thin section reads as missing evidence rather than as
 * a confident sentence nobody can defend.
 */

import { useEffect, useState } from "react";

import { EvidenceList, TierChip } from "@/components/tt/roadmap/tier";
import { EmptyState, MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import type { ArtifactSection, RoadmapArtifact } from "@/domain/roadmap-intel";

function SectionCard({
  section,
  editing,
  onChange,
}: {
  section: ArtifactSection;
  editing: boolean;
  onChange: (body: string[]) => void;
}) {
  return (
    <li className="tt-surface p-6 md:p-8">
      <div className="flex flex-wrap items-center gap-2">
        <TierChip tier={section.tier} />
        {section.caption ? <MetaPill>{section.caption}</MetaPill> : null}
      </div>
      <h3 className="mt-3 font-display text-2xl leading-tight text-foreground md:text-3xl">
        {section.title}
      </h3>

      {editing ? (
        <label className="mt-4 block">
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
        section.body.map((paragraph, index) => (
          <p key={index} className="mt-3 max-w-reading text-sm leading-relaxed text-foreground">
            {paragraph}
          </p>
        ))
      )}

      {section.unlocks && section.unlocks.length > 0 ? (
        <div className="mt-5">
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
        <p className="mt-5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
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

  return (
    <section aria-label={label}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="tt-eyebrow">{label}</p>
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

      <ul className="space-y-4">
        {(editing ? draft : artifact.sections).map((section, index) => (
          <SectionCard
            key={section.key}
            section={section}
            editing={editing}
            onChange={(body) =>
              setDraft((current) =>
                current.map((entry, position) =>
                  position === index ? { ...entry, body } : entry,
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
  preview,
  full,
  busy,
  stage,
  onCompose,
  onEdit,
}: {
  preview: RoadmapArtifact | null;
  full: RoadmapArtifact | null;
  busy: boolean;
  stage: string | null;
  onCompose: (kind: "preview" | "full", replace?: boolean) => void;
  onEdit: (artifact: RoadmapArtifact, sections: ArtifactSection[]) => void;
}) {
  function composeLabel(artifact: RoadmapArtifact | null, name: string) {
    if (!artifact) return `Compose ${name}`;
    return artifact.humanEdited ? `Replace ${name}` : `Recompose ${name}`;
  }

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Studio"
        title="The client roadmap"
        description="Title page, Point A, the market gap, and a note from Tai. The full roadmap adds one page per approved milestone. Approved evidence only."
        action={
          <div className="flex flex-wrap gap-2">
            <TTButton
              variant="secondary"
              disabled={busy}
              onClick={() => onCompose("preview", preview?.humanEdited === true)}
            >
              {composeLabel(preview, "preview")}
            </TTButton>
            <TTButton
              variant="secondary"
              disabled={busy}
              onClick={() => onCompose("full", full?.humanEdited === true)}
            >
              {composeLabel(full, "full roadmap")}
            </TTButton>
          </div>
        }
      />

      {busy && stage ? (
        <p className="text-sm text-muted-foreground" role="status">
          {stage}
        </p>
      ) : null}

      {!preview && !full ? (
        <EmptyState
          title="Nothing has been composed yet."
          belongsHere="Studio turns approved strategy and approved milestones into language a client can read."
          whyItMatters="Anything not approved stays out of the document rather than becoming a confident sentence."
        />
      ) : null}

      {preview ? (
        <Document artifact={preview} label="Roadmap preview" busy={busy} onEdit={onEdit} />
      ) : null}
      {full ? (
        <Document artifact={full} label="Full roadmap" busy={busy} onEdit={onEdit} />
      ) : null}
    </div>
  );
}
