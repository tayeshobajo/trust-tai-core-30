/**
 * The project name, corrected where it is read.
 *
 * Operability law (canon 16): the control that changes a truth belongs where
 * the truth is shown. This is not a second store or a second rule. It calls the
 * same Projects update service, and refuses with the same words as the manage
 * panel, through `checkDetailEdit`.
 */

import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { checkDetailEdit, type ExecutionProject } from "@/domain/projects";

export function InlineProjectName({
  project,
  busy,
  savedLabel,
  onRename,
}: {
  project: ExecutionProject;
  busy: boolean;
  /** Set by the room after a save lands, so a change visibly confirms. */
  savedLabel: string | null;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const input = useRef<HTMLInputElement>(null);

  // The recorded name is the truth. A save, or someone else's change, wins.
  useEffect(() => {
    setDraft(project.name);
    setEditing(false);
  }, [project.id, project.name]);

  useEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);

  const check = checkDetailEdit(project, { name: draft });
  const changed = draft.trim() !== project.name;

  function save() {
    if (!check.ok) return;
    if (!changed) {
      setEditing(false);
      return;
    }
    onRename(draft.trim());
    setEditing(false);
  }

  function cancel() {
    setDraft(project.name);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit project name, currently ${project.name}`}
          className="group -mx-2 flex min-w-0 items-center gap-2 rounded-xl px-2 py-1 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h1 className="min-w-0 font-display text-[34px] leading-[1.1] text-foreground">
            {project.name}
          </h1>
          <Pencil
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </button>
        {savedLabel ? (
          <span role="status" className="text-[12px] text-royal">
            {savedLabel}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-2">
      <h1 className="sr-only">{project.name}</h1>
      <input
        ref={input}
        value={draft}
        disabled={busy}
        aria-label="Project name"
        aria-invalid={!check.ok}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        onBlur={cancel}
        className="w-full max-w-2xl rounded-xl border border-border bg-card px-3 py-2 font-display text-[28px] leading-[1.15] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {check.ok ? (
        <p className="text-[12px] text-muted-foreground">
          Enter saves this name. Escape leaves it as it was.
        </p>
      ) : (
        <p role="alert" className="text-[12px] text-danger">
          {check.because}
        </p>
      )}
    </div>
  );
}
