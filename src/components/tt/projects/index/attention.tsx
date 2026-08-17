/**
 * Exceptions, above general activity. Only genuine exceptions appear here:
 * blocked work, work at risk, and reviews landing within two days.
 */

import { Link } from "@tanstack/react-router";

import { ProjectStatusPill } from "@/components/tt/projects/index/status-pill";
import type { ProjectRowModel } from "@/data/projects/index-projection";

export function NeedsAttention({ rows }: { rows: ProjectRowModel[] }) {
  if (rows.length === 0) {
    return (
      <section aria-labelledby="needs-attention">
        <h2 id="needs-attention" className="text-[15px] font-medium text-foreground">
          Needs attention
        </h2>
        <p className="mt-2 rounded-xl border border-border bg-card px-4 py-5 text-[13px] text-muted-foreground">
          Nothing is blocked or at risk. Delivery is moving.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="needs-attention">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="needs-attention" className="text-[15px] font-medium text-foreground">
          Needs attention
        </h2>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {rows.length} exception{rows.length === 1 ? "" : "s"}
        </p>
      </div>
      <ul className="mt-3 space-y-2">
        {rows.slice(0, 4).map((row) => (
          <li
            key={row.project.id}
            className={`rounded-xl border bg-card p-4 ${
              row.status === "blocked" ? "border-destructive/30" : "border-warning/30"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {row.lineage.company}
                  </p>
                  <ProjectStatusPill status={row.status} />
                </div>
                <h3 className="mt-1.5 text-[14px] font-medium text-foreground">
                  {row.project.name}
                </h3>
                <p className="mt-1 max-w-reading text-[13px] text-muted-foreground">
                  {row.blocker ? `Blocked: ${row.blocker}` : row.because}
                </p>
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  {row.ownerLabel} · {row.due}
                </p>
              </div>
              <Link
                to="/modules/projects/$projectId"
                params={{ projectId: row.project.id }}
                className="inline-flex h-9 shrink-0 items-center rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {row.status === "blocked" ? "Resolve block" : "Review"}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
