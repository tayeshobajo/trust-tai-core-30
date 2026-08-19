/**
 * Ownership decision inspector.
 *
 * The law is deterministic, so it can be shown its own working: the words it
 * matched, the room that carries the work, the rooms that only support it,
 * and the sentence a person reads. For QA, and for anyone who wants to know
 * why a milestone landed where it did.
 */

import { useState } from "react";

import { MetaPill } from "@/components/tt/primitives";
import { EXECUTION_ROOM_LABEL, type OwnershipRead } from "@/domain/execution-ownership";

function Terms({ label, terms }: { label: string; terms: string[] }) {
  return (
    <div>
      <p className="tt-eyebrow">{label}</p>
      {terms.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">None matched</p>
      ) : (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {terms.map((term) => (
            <span
              key={term}
              className="rounded-md border border-border bg-secondary px-2 py-0.5 font-mono text-[11px] text-foreground"
            >
              {term}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function OwnershipDecision({
  read,
  boundary,
}: {
  read: OwnershipRead;
  boundary?: string | undefined;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center gap-2">
        <MetaPill>Owned by {EXECUTION_ROOM_LABEL[read.primary]}</MetaPill>
        {read.secondary.map((support) => (
          <MetaPill key={support}>Supports: {EXECUTION_ROOM_LABEL[support]}</MetaPill>
        ))}
      </div>
      <p className="mt-2 max-w-reading text-sm text-foreground">{read.because}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Terms label="Engineering words" terms={read.signals.engineering} />
        <Terms label="Maintenance words" terms={read.signals.maintenance} />
        <Terms label="Content words" terms={read.signals.content} />
      </div>

      {boundary ? (
        <div className="mt-4">
          <p className="tt-eyebrow">Boundary as it reads</p>
          <p className="mt-1 max-w-reading text-sm text-muted-foreground">{boundary}</p>
        </div>
      ) : null}
    </div>
  );
}

/** The same decision, folded away until someone asks for it. */
export function OwnershipInspector({
  read,
  boundary,
  subject,
}: {
  read: OwnershipRead;
  boundary?: string | undefined;
  subject: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        {open ? "Hide ownership decision" : `Why ${EXECUTION_ROOM_LABEL[read.primary]} owns this`}
      </button>
      {open ? (
        <div className="mt-2">
          <p className="sr-only">Ownership decision for {subject}</p>
          <OwnershipDecision read={read} boundary={boundary} />
        </div>
      ) : null}
    </div>
  );
}
