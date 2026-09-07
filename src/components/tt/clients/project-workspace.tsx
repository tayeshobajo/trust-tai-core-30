/**
 * Work: all delivery for one company, operated inside the client workspace.
 *
 * The Client page is Home for that company, so there is exactly one primary
 * navigation. This surface adds no second menu: a compact switcher chooses the
 * current work context when the company has more than one project, and the
 * selected project's own operating page renders in place, composed from the
 * same canonical Projects and Roadmap services the standalone rooms use.
 * Nothing here holds a second copy of a project, a roadmap or a milestone.
 */

import { Link } from "@tanstack/react-router";

import { ProjectWorkroom } from "@/components/tt/projects/detail/workroom";
import { EmptyState, MetaPill } from "@/components/tt/primitives";
import type { ExecutionProject } from "@/domain/projects";
import type { WorkspaceIdentity } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const STATE_LABEL: Record<string, string> = {
  blocked: "Blocked",
  delivered: "Delivered",
};

export function ClientProjectWorkspace({
  identity,
  projects,
  selectedId,
  loading,
  onSelect,
}: {
  identity: WorkspaceIdentity;
  projects: ExecutionProject[];
  /** The project currently open in this client workspace, if any. */
  selectedId: string | null;
  loading: boolean;
  onSelect: (projectId: string) => void;
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Reading delivery work…</p>;
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        title="No delivery work recorded"
        belongsHere="Delivery for this company is operated here."
        whyItMatters="No project names this company yet. Projects still owns that record; start one there and it will appear here."
        action={
          <Link to="/modules/projects" className="text-sm font-medium text-royal">
            Open the Projects room
          </Link>
        }
      />
    );
  }

  const selected = projects.find((project) => project.id === selectedId) ?? projects[0]!;

  return (
    <div className="space-y-6">
      {projects.length > 1 ? (
        <div className="tt-surface flex flex-wrap items-center gap-2 px-4 py-3">
          <span className="tt-eyebrow mr-1">Current work</span>
          {projects.map((project) => {
            const active = project.id === selected.id;
            const state = STATE_LABEL[project.state];
            return (
              <button
                key={project.id}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect(project.id)}
                className={cn(
                  "inline-flex max-w-[18rem] items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors",
                  active
                    ? "border-royal/40 bg-secondary font-medium text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="truncate">{project.name}</span>
                {state ? <MetaPill>{state}</MetaPill> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <ProjectWorkroom key={selected.id} identity={identity} projectId={selected.id} embedded mode="composed" />
    </div>
  );
}
