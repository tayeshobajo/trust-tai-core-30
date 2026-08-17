/**
 * Roadmap detail — shared primitives.
 *
 * Small, quiet pieces used across the inner page: section shells, state pills,
 * and the numbered milestone strip. Nothing here decides anything; it renders
 * what the projection already worked out.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  PATH_STATE_LABEL,
  type PathMilestone,
  type PathState,
} from "@/data/roadmap/detail/projection";

const STATE_STYLE: Record<PathState, string> = {
  complete: "border-success/30 bg-success/10 text-success",
  in_progress: "border-royal/30 bg-royal/10 text-royal",
  ready: "border-border bg-secondary text-foreground",
  proposed: "border-border bg-card text-muted-foreground",
  blocked: "border-warning/30 bg-warning/10 text-warning",
};

export function PathStatePill({ state, className }: { state: PathState; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]",
        STATE_STYLE[state],
        className,
      )}
    >
      {PATH_STATE_LABEL[state]}
    </span>
  );
}

/** A plain card with an eyebrow, used for every block on the inner page. */
export function DetailSection({
  eyebrow,
  title,
  supporting,
  action,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  supporting?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? <p className="tt-eyebrow">{eyebrow}</p> : null}
          <h2 className="mt-1 text-[17px] font-medium text-foreground">{title}</h2>
          {supporting ? (
            <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
              {supporting}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const DOT: Record<PathState, string> = {
  complete: "bg-success",
  in_progress: "bg-royal",
  ready: "bg-foreground/40",
  proposed: "bg-border",
  blocked: "bg-warning",
};

/** The horizontal path. Sequence first, state second, never a progress bar. */
export function MilestonePath({
  path,
  activeId,
  onSelect,
}: {
  path: PathMilestone[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
}) {
  if (path.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No milestones are sequenced yet. Research proposes candidates; a person decides which enter
        the path.
      </p>
    );
  }

  return (
    <ol className="flex gap-3 overflow-x-auto pb-1">
      {path.map((entry) => {
        const active = entry.id === activeId;
        const body = (
          <>
            <div className="flex items-center gap-2">
              <span className={cn("size-1.5 rounded-full", DOT[entry.state])} aria-hidden />
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {entry.ordinal}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 text-[13px] leading-snug text-foreground">
              {entry.name}
            </p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {PATH_STATE_LABEL[entry.state]}
            </p>
          </>
        );
        const shell = cn(
          "min-w-[168px] shrink-0 rounded-lg border p-3 text-left transition-colors",
          active ? "border-royal/40 bg-royal/5" : "border-border bg-card hover:bg-secondary",
        );
        return (
          <li key={entry.id}>
            {onSelect ? (
              <button type="button" className={shell} onClick={() => onSelect(entry.id)}>
                {body}
              </button>
            ) : (
              <div className={shell}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function KeyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="tt-eyebrow">{label}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-foreground">{value}</p>
    </div>
  );
}
