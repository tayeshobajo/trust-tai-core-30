/**
 * The standalone delivery room for one project.
 *
 * This is the portfolio door into a project. The same workroom also renders
 * inside a Client workspace, from the same component and the same services,
 * so a person serving one company never has to come here to do the work.
 */

import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/tt/app-shell";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { ProjectWorkroom } from "@/components/tt/projects/detail/workroom";

export const Route = createFileRoute("/modules/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Delivery room · Projects · Trust Tai OS" },
      {
        name: "description",
        content:
          "One approved milestone in delivery: outcome, current work, blockers, decisions and lineage back to the roadmap.",
      },
      { property: "og:title", content: "Delivery room · Projects · Trust Tai OS" },
      {
        property: "og:description",
        content:
          "One approved milestone in delivery: outcome, current work, blockers, decisions and lineage back to the roadmap.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProjectRoute,
});

function ProjectRoute() {
  const { projectId } = Route.useParams();
  return (
    <WorkspaceGate appId="projects">
      {(identity) => (
        <AppShell identity={identity}>
          <ProjectWorkroom identity={identity} projectId={projectId} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}
