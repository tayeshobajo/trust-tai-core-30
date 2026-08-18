/**
 * Roadmap detail, right rail.
 *
 * Three quiet cards: the actions that belong to this roadmap, the state of the
 * client copy, and the one thing that deserves attention next. Notes sit under
 * them because they are context, not a decision.
 */

import { useState } from "react";

import { TTButton, TTInput } from "@/components/tt/primitives";
import type { NextAttention, ExportFreshness } from "@/data/roadmap/detail/projection";
import type { RoadmapDetailNote } from "@/domain/roadmap-exports";
import { EXPORT_STATUS_LABEL } from "@/domain/roadmap-exports";

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <p className="tt-eyebrow">{title}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function ActionsCard({
  onResearch,
  onCompose,
  onExport,
  researching,
  composing,
  exporting,
  canExport,
  exportBlockedBecause,
}: {
  onResearch: () => void;
  onCompose: () => void;
  onExport: () => void;
  researching: boolean;
  composing: boolean;
  exporting: boolean;
  canExport: boolean;
  exportBlockedBecause: string;
}) {
  return (
    <RailCard title="Actions">
      <div className="flex flex-col gap-2">
        <TTButton size="sm" disabled={researching} onClick={onResearch}>
          {researching ? "Researching…" : "Run research"}
        </TTButton>
        <TTButton variant="secondary" size="sm" disabled={composing} onClick={onCompose}>
          {composing ? "Composing…" : "Compose client document"}
        </TTButton>
        <TTButton
          variant="secondary"
          size="sm"
          disabled={!canExport || exporting}
          onClick={onExport}
        >
          {exporting ? "Freezing copy…" : "Create client copy"}
        </TTButton>
        {!canExport ? (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {exportBlockedBecause}
          </p>
        ) : null}
      </div>
    </RailCard>
  );
}

export function ClientCopyCard({ freshness }: { freshness: ExportFreshness }) {
  const latest = freshness.latest;
  return (
    <RailCard title="Client copy">
      {latest ? (
        <div className="space-y-1.5">
          <p className="text-[14px] text-foreground">Version {latest.version}</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {EXPORT_STATUS_LABEL[latest.status]}
          </p>
          <p
            className={
              freshness.behind
                ? "text-[12px] leading-relaxed text-warning"
                : "text-[12px] leading-relaxed text-muted-foreground"
            }
          >
            {freshness.summary}
          </p>
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted-foreground">{freshness.summary}</p>
      )}
    </RailCard>
  );
}

export function NextAttentionCard({ attention }: { attention: NextAttention }) {
  return (
    <RailCard title="Next attention">
      <p className="text-[14px] leading-snug text-foreground">{attention.headline}</p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
        {attention.because}
      </p>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-royal">
        {attention.action}
      </p>
    </RailCard>
  );
}

export function NotesCard({
  notes,
  available,
  saving,
  onAdd,
}: {
  notes: RoadmapDetailNote[];
  available: boolean;
  saving: boolean;
  onAdd: (body: string) => void;
}) {
  const [body, setBody] = useState("");

  return (
    <RailCard title="Internal notes">
      {available ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!body.trim()) return;
            onAdd(body.trim());
            setBody("");
          }}
        >
          <TTInput
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Add a note"
            aria-label="Add an internal note"
          />
          <TTButton size="sm" type="submit" disabled={saving || !body.trim()}>
            Add
          </TTButton>
        </form>
      ) : (
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Notes are not set up in this backend yet.
        </p>
      )}

      <ul className="mt-3 space-y-3">
        {notes.slice(0, 4).map((note) => (
          <li key={note.id} className="border-l-2 border-border pl-3">
            <p className="text-[13px] leading-relaxed text-foreground">{note.body}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {note.authorLabel ?? "Someone"} · {new Date(note.createdAt).toLocaleDateString()}
            </p>
          </li>
        ))}
        {available && notes.length === 0 ? (
          <li className="text-[12px] text-muted-foreground">No notes yet.</li>
        ) : null}
      </ul>
    </RailCard>
  );
}
