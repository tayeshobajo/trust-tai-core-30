/**
 * The primary moves, offered where the work is.
 *
 * A person should not have to open a page to say a thing is blocked. The same
 * six words appear on the card and in the drawer, refused for the same reasons
 * in the same language, and Blocked and Waiting always ask what for.
 */

import { useState } from "react";

import { TTButton, TTInput } from "@/components/tt/primitives";
import {
  changesForSurface,
  surfaceActions,
  type SurfaceMoveChanges,
} from "@/data/projects/surface-actions";
import type { SurfaceStatus } from "@/data/projects/index-projection";
import type { ExecutionProject } from "@/domain/projects";
import { cn } from "@/lib/utils";

export interface ProjectMove {
  (project: ExecutionProject, changes: SurfaceMoveChanges): void;
}

export function ProjectActionBar({
  project,
  onMove,
  pending,
  error,
  className,
}: {
  project: ExecutionProject;
  onMove: ProjectMove;
  pending?: boolean;
  error?: string | null;
  className?: string;
}) {
  const [asking, setAsking] = useState<SurfaceStatus | null>(null);
  const [reason, setReason] = useState("");

  const actions = surfaceActions(project, asking ? reason : "");
  const open = asking ? actions.find((entry) => entry.target === asking) : null;

  function press(target: SurfaceStatus, needsReason: boolean, ok: boolean) {
    if (needsReason) {
      setAsking(target);
      setReason("");
      return;
    }
    if (!ok) return;
    onMove(project, changesForSurface(target));
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {actions.map((entry) => (
          <button
            key={entry.target}
            type="button"
            title={entry.because}
            aria-disabled={!entry.ok && !entry.needsReason}
            disabled={pending || entry.current || (!entry.ok && !entry.needsReason)}
            onClick={() => press(entry.target, entry.needsReason, entry.ok)}
            className={cn(
              "rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors",
              entry.current
                ? "border-royal/30 bg-royal/8 text-royal"
                : "border-border bg-card text-muted-foreground hover:border-royal/30 hover:text-foreground",
              "disabled:cursor-not-allowed disabled:opacity-45",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {open ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-secondary/40 p-2">
          <TTInput
            autoFocus
            className="h-8 min-w-[200px] flex-1 text-[13px]"
            value={reason}
            aria-label={open.reasonPrompt ?? "Reason"}
            placeholder={open.reasonPrompt ?? "Reason"}
            onChange={(event) => setReason(event.target.value)}
          />
          <TTButton
            size="sm"
            disabled={pending || !open.ok}
            title={open.because}
            onClick={() => {
              if (!open.ok) return;
              onMove(project, changesForSurface(open.target, reason));
              setAsking(null);
              setReason("");
            }}
          >
            {pending ? "Saving…" : `Mark ${open.label}`}
          </TTButton>
          <TTButton
            size="sm"
            variant="quiet"
            onClick={() => {
              setAsking(null);
              setReason("");
            }}
          >
            Cancel
          </TTButton>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-[12px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
