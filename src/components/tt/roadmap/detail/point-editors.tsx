/**
 * Writing Point A and Point B by hand.
 *
 * The system can propose either one. A person must be able to write the same
 * truth themselves, in the place they already read it, without a second page
 * and without a model call. Both editors are quiet: a plain link until
 * someone opens them, then one small form with a save.
 */

import { useEffect, useState } from "react";

import { TTButton } from "@/components/tt/primitives";
import { useReveal } from "@/lib/reveal";
import type { RoadmapNote } from "@/domain/roadmap";

function EditLink({
  children,
  onClick,
  disabled,
}: {
  children: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground disabled:opacity-50"
    >
      {children}
    </button>
  );
}

const TEXTAREA =
  "w-full rounded-lg border border-input bg-card px-4 py-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground";

/** One fact per line. The simplest editor that can hold a list honestly. */
export function PointAEditor({
  notes,
  busy,
  onSave,
}: {
  notes: RoadmapNote[];
  busy: boolean;
  onSave: (lines: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => notes.map((note) => note.value).join("\n"));
  const [refusal, setRefusal] = useState<string | null>(null);
  const panel = useReveal<HTMLDivElement>();

  useEffect(() => {
    if (!open) setText(notes.map((note) => note.value).join("\n"));
  }, [notes, open]);

  if (!open) {
    return (
      <div className="mt-3">
        <EditLink
          disabled={busy}
          onClick={() => {
            setRefusal(null);
            setOpen(true);
            panel.reveal();
          }}
        >
          {notes.length === 0 ? "Write where this stands" : "Edit these facts"}
        </EditLink>
      </div>
    );
  }

  return (
    <div ref={panel.ref} className="tt-reveal-target mt-3 rounded-2xl border border-border p-4">
      <label className="block space-y-2">
        <span className="text-sm font-medium text-foreground">Where this stands today</span>
        <textarea
          rows={5}
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
          placeholder={"One fact per line.\nOnly what is actually true today."}
          className={TEXTAREA}
        />
      </label>
      <p className="mt-2 text-xs text-muted-foreground">
        One fact per line. Leave out anything you cannot stand behind; an empty line is dropped.
      </p>
      {refusal ? <p className="mt-2 text-sm text-danger">{refusal}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <TTButton
          size="sm"
          disabled={busy}
          onClick={() => {
            const lines = text
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0);
            if (lines.length === 0) {
              setRefusal("Write at least one fact, or close this without saving.");
              return;
            }
            setRefusal(null);
            onSave(lines);
            setOpen(false);
          }}
        >
          Save
        </TTButton>
        <TTButton size="sm" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </TTButton>
      </div>
    </div>
  );
}

/** A destination a person writes is decided the moment they save it. */
export function PointBEditor({
  statement,
  because,
  present,
  busy,
  onSave,
}: {
  statement: string;
  because: string;
  present: boolean;
  busy: boolean;
  onSave: (input: { statement: string; because: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ statement, because });
  const [refusal, setRefusal] = useState<string | null>(null);
  const panel = useReveal<HTMLDivElement>();

  useEffect(() => {
    if (!open) setDraft({ statement, because });
  }, [statement, because, open]);

  if (!open) {
    return (
      <div className="mt-3">
        <EditLink
          disabled={busy}
          onClick={() => {
            setRefusal(null);
            setOpen(true);
            panel.reveal();
          }}
        >
          {present ? "Edit wording" : "Write the destination"}
        </EditLink>
      </div>
    );
  }

  return (
    <div ref={panel.ref} className="tt-reveal-target mt-3 rounded-2xl border border-border p-4">
      <label className="block space-y-2">
        <span className="text-sm font-medium text-foreground">Where this is going</span>
        <textarea
          rows={3}
          value={draft.statement}
          disabled={busy}
          onChange={(event) => setDraft((value) => ({ ...value, statement: event.target.value }))}
          placeholder="One sentence a client would recognise."
          className={TEXTAREA}
        />
      </label>
      <label className="mt-3 block space-y-2">
        <span className="text-sm font-medium text-foreground">
          Why this one <span className="tt-eyebrow ml-2">Optional</span>
        </span>
        <textarea
          rows={2}
          value={draft.because}
          disabled={busy}
          onChange={(event) => setDraft((value) => ({ ...value, because: event.target.value }))}
          placeholder="The reasoning behind it, in your words."
          className={TEXTAREA}
        />
      </label>
      <p className="mt-2 text-xs text-muted-foreground">
        Written by you, so it is decided the moment you save. Nothing here asks the system to
        propose anything.
      </p>
      {refusal ? <p className="mt-2 text-sm text-danger">{refusal}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <TTButton
          size="sm"
          disabled={busy}
          onClick={() => {
            const next = draft.statement.trim();
            if (!next) {
              setRefusal("A destination needs a sentence a person can read.");
              return;
            }
            setRefusal(null);
            onSave({ statement: next, because: draft.because.trim() });
            setOpen(false);
          }}
        >
          Save
        </TTButton>
        <TTButton size="sm" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </TTButton>
      </div>
    </div>
  );
}
