import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { IdeasWorkspace } from "@/components/tt/studio/ideas-workspace";
export const Route = createFileRoute("/modules/studio/ideas")({
  head: () => ({
    meta: [{ title: "Studio · Ideas · Trust Tai OS" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <WorkspaceGate appId="studio">
      {(identity) => <IdeasWorkspace identity={identity} />}
    </WorkspaceGate>
  ),
});
