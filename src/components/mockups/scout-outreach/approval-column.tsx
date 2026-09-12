import { useState } from "react";

import { TTButton, TonePill } from "@/components/tt/primitives";
import { cn } from "@/lib/utils";
import type { DraftEmail, ReadyProspect } from "./types";

interface ApprovalColumnProps {
  drafts: DraftEmail[];
  onApprove: (draft: DraftEmail) => void;
  onReject: (draft: DraftEmail) => void;
  onEdit: (draft: DraftEmail) => void;
}

export function ApprovalColumn({ drafts, onApprove, onReject, onEdit }: ApprovalColumnProps) {
  return (
    <section className="tt-surface p-5">
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <h2 className="tt-title-card text-base">Awaiting your approval</h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {drafts.length}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Approve is the send. Nothing leaves without you.
        </p>
      </div>

      <div className="space-y-4">
        {drafts.map((draft) => (
          <DraftCard
            key={draft.id}
            draft={draft}
            onApprove={() => onApprove(draft)}
            onReject={() => onReject(draft)}
            onEdit={(next) => onEdit(next)}
          />
        ))}
      </div>
    </section>
  );
}

interface DraftCardProps {
  draft: DraftEmail;
  onApprove: () => void;
  onReject: () => void;
  onEdit: (draft: DraftEmail) => void;
}

function DraftCard({ draft, onApprove, onReject, onEdit }: DraftCardProps) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);

  const save = () => {
    onEdit({ ...draft, subject, body });
    setEditing(false);
  };

  const cancel = () => {
    setSubject(draft.subject);
    setBody(draft.body);
    setEditing(false);
  };

  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            {draft.recipient} · {draft.company}
          </h3>
          <p className="text-xs text-muted-foreground">{draft.email}</p>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
          {draft.template}
        </span>
      </div>

      {editing ? (
        <div className="mt-4 space-y-3">
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground"
          />
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={6}
            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground"
          />
          <div className="flex gap-2">
            <TTButton size="sm" onClick={save}>
              Save
            </TTButton>
            <TTButton size="sm" variant="quiet" onClick={cancel}>
              Cancel
            </TTButton>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 rounded-lg bg-studio-paper px-4 py-3">
            <p className="text-sm font-medium text-foreground">{draft.subject}</p>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
              {draft.body}
            </p>
          </div>

          <div className="mt-3">
            <TonePill tone="good" dot>
              Voice check passed
            </TonePill>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <TTButton size="sm" onClick={onApprove}>
              Approve &amp; send
            </TTButton>
            <TTButton size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </TTButton>
            <TTButton size="sm" variant="quiet" onClick={onReject}>
              Reject
            </TTButton>
          </div>
        </>
      )}
    </article>
  );
}
