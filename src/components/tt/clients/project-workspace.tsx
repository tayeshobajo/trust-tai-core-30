/**
 * The client's projects, operated without leaving the client.
 *
 * Serving one company should not mean walking between rooms. The list on the
 * left is this company's delivery work; picking one loads that project's own
 * workroom in place, from the same component and the same canonical services
 * the standalone Projects room uses. Nothing here holds a second copy of a
 * project, a roadmap, a milestone or a conversation.
 */

import { Link } from "@tanstack/react-router";

import { ProjectWorkroom } from "@/components/tt/projects/detail/workroom";
import { EmptyState, MetaPill } from "@/components/tt/primitives";
import type { ProjectTab } from "@/components/tt/projects/detail/frame";
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
  surface,
  loading,
  onSelect,
  onSurfaceChange,
}: {
  identity: WorkspaceIdentity;
  projects: ExecutionProject[];
  /** The project currently open in this client workspace, if any. */
  selectedId: string | null;
  surface: ProjectTab;
  loading: boolean;
  onSelect: (projectId: string) => void;
  onSurfaceChange: (tab: ProjectTab) => void;
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Reading delivery work…</p>;
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        title="No delivery work recorded"
        body="No project names this company yet. Projects still owns that record; start one there and it will appear here."
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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
      <nav aria-label="Projects for this company" className="lg:sticky lg:top-24 lg:self-start">
        <p className="tt-eyebrow">This company&apos;s projects</p>
        <ul className="mt-3 space-y-1">
          {projects.map((project) => {
            const active = project.id === selected.id;
            const state = STATE_LABEL[project.state];
            return (
              <li key={project.id}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => onSelect(project.id)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                    active
                      ? "border-royal/40 bg-secondary"
                      : "border-transparent hover:bg-secondary/60",
                  )}
                >
                  <span className="block truncate text-[14px] text-foreground">{project.name}</span>
                  {state ? <MetaPill className="mt-1">{state}</MetaPill> : null}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-[12px] text-muted-foreground">
          Switching projects keeps you inside this company.
        </p>
      </nav>

      <div className="min-w-0">
        <ProjectWorkroom
          key={selected.id}
          identity={identity}
          projectId={selected.id}
          embedded
          surface={surface}
          onSurfaceChange={onSurfaceChange}
        />
      </div>
    </div>
  );
}
