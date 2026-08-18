/**
 * Surfaces with nothing honest to say collapse here, one line each, with the
 * thing that would fill them. Never an empty card.
 */

import type { UnknownNote } from "@/domain/prospect-modules";

export function UnknownStrip({ notes }: { notes: UnknownNote[] }) {
  return (
    <section className="rounded-xl border border-dashed border-border p-5">
      <p className="tt-eyebrow">Not yet known</p>
      <ul className="mt-3 space-y-2">
        {notes.map((note) => (
          <li key={note.id} className="text-[13px] text-muted-foreground">
            <span className="text-foreground">{note.label}</span> · {note.fills}
          </li>
        ))}
      </ul>
    </section>
  );
}
