/**
 * Roadmap detail — Evidence.
 *
 * Anchor proof points, linked by hand. Everything here was read somewhere by
 * someone: a label, how it was learned, and where it can be checked. Nothing
 * is generated, and an unsourced claim stays visibly unsourced.
 */

import { useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";

import { TTButton } from "@/components/tt/primitives";
import { DetailSection } from "./parts";
import {
  EVIDENCE_KIND_LABEL,
  type RoadmapEvidenceInput,
  type RoadmapEvidenceItem,
  type RoadmapEvidenceKind,
} from "@/domain/roadmap-exports";

const KINDS: RoadmapEvidenceKind[] = ["page", "provider", "human", "computed"];

export function EvidenceLinksCard({
  items,
  available,
  saving,
  removingId,
  onAdd,
  onRemove,
}: {
  items: RoadmapEvidenceItem[];
  available: boolean;
  saving: boolean;
  removingId: string | null;
  onAdd: (input: RoadmapEvidenceInput) => void;
  onRemove: (id: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<RoadmapEvidenceKind>("page");
  const [note, setNote] = useState("");

  if (!available) {
    return (
      <DetailSection
        eyebrow="Evidence"
        title="Linked proof points are not set up in this backend yet"
        supporting="Apply docs/roadmap-exports-schema.sql to the shared backend to start linking anchor proof."
      >
        <p className="text-[13px] text-muted-foreground">
          The rest of the roadmap is unaffected; only hand-linked evidence is unavailable.
        </p>
      </DetailSection>
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!label.trim()) return;
    onAdd({
      label: label.trim(),
      kind,
      ...(url.trim() ? { url: url.trim() } : {}),
      ...(note.trim() ? { sourceNote: note.trim() } : {}),
    });
    setLabel("");
    setUrl("");
    setNote("");
  }

  return (
    <DetailSection
      eyebrow="Evidence"
      title="Anchor proof"
      supporting="What this roadmap rests on. Each point names where it came from so it can be checked."
    >
      {items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No proof point is linked yet. Everything downstream of here is inference until one is.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
            >
              <div className="min-w-0">
                <p className="text-[14px] text-foreground">{item.label}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {EVIDENCE_KIND_LABEL[item.kind]} ·{" "}
                  {new Date(item.createdAt).toLocaleDateString()}
                </p>
                {item.sourceNote ? (
                  <p className="mt-1 text-[13px] text-muted-foreground">{item.sourceNote}</p>
                ) : null}
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden />
                    Open source
                  </a>
                ) : null}
              </div>
              <button
                type="button"
                aria-label={`Remove ${item.label}`}
                disabled={removingId === item.id}
                onClick={() => onRemove(item.id)}
                className="rounded-md p-2 text-muted-foreground transition hover:text-danger disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="mt-5 space-y-3 border-t border-border pt-4">
        <p className="tt-eyebrow">Link a proof point</p>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="What it says, in one line"
          aria-label="Proof point"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-[14px]"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https:// where it can be checked (optional)"
            aria-label="Source link"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-[14px]"
          />
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as RoadmapEvidenceKind)}
            aria-label="How this was learned"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-[14px]"
          >
            {KINDS.map((entry) => (
              <option key={entry} value={entry}>
                {EVIDENCE_KIND_LABEL[entry]}
              </option>
            ))}
          </select>
        </div>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Anything a reader needs to judge it (optional)"
          aria-label="Source note"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-[14px]"
        />
        <TTButton size="sm" type="submit" disabled={!label.trim() || saving}>
          {saving ? "Linking…" : "Link proof point"}
        </TTButton>
      </form>
    </DetailSection>
  );
}
