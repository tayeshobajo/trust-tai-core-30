/**
 * Linking a project to the roadmap it executes.
 *
 * Roadmap owns roadmap truth. A project only records which roadmap it is
 * executing, so the Project workroom can read that truth and operate it
 * through Roadmap's own services. The link is a human act, never guessed from
 * a company name and never created because a client happens to have exactly
 * one roadmap.
 */

import type { ID } from "@/domain/entities";
import type { ExecutionProject, TransitionCheck } from "@/domain/projects";

export interface LinkableRoadmap {
  id: ID;
  clientId?: ID;
  subjectLabel: string;
  organizationId: ID;
}

/** Is this link honest, and if not, why not. Pure, so panel and write agree. */
export function checkRoadmapLink(
  project: Pick<ExecutionProject, "id" | "origin" | "organizationId"> & { clientId?: ID },
  roadmap: LinkableRoadmap,
): TransitionCheck {
  if (project.origin.kind === "roadmap_milestone") {
    return {
      ok: false,
      because:
        "This work was carried across from an approved roadmap milestone, so its roadmap lineage is Roadmap truth and cannot be reassigned here.",
    };
  }
  if (roadmap.organizationId !== project.organizationId) {
    return { ok: false, because: "That roadmap belongs to another workspace." };
  }
  if (project.clientId && roadmap.clientId && project.clientId !== roadmap.clientId) {
    return {
      ok: false,
      because:
        "That roadmap belongs to a different company than this project. Linking them would make the lineage read false.",
    };
  }
  if (project.origin.roadmapId === roadmap.id) {
    return { ok: false, because: "This project already reads that roadmap." };
  }
  return { ok: true, because: "Records which roadmap this work executes." };
}

/** Replay key, so linking the same roadmap twice never writes twice. */
export function roadmapLinkKey(projectId: ID, roadmapId: ID): string {
  return `project.roadmap_linked:${projectId}:${roadmapId}`;
}

/**
 * The roadmaps a person may legitimately choose from: this workspace, and,
 * when the project is attached to a client, that client's roadmaps only.
 * Returning one candidate is not permission to link it automatically.
 */
export function linkableRoadmaps<T extends LinkableRoadmap>(
  project: Pick<ExecutionProject, "id" | "origin" | "organizationId"> & { clientId?: ID },
  roadmaps: T[],
): T[] {
  return roadmaps.filter((roadmap) => checkRoadmapLink(project, roadmap).ok);
}
