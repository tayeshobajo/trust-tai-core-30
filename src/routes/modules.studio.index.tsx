import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { OverviewWorkspace } from "@/components/tt/studio/overview-workspace";
export const Route = createFileRoute("/modules/studio/")({
  head: () => ({
    meta: [{ title: "Studio · Overview · Trust Tai OS" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <WorkspaceGate appId="studio">
      {(identity) => <OverviewWorkspace identity={identity} />}
    </WorkspaceGate>
  ),
});
