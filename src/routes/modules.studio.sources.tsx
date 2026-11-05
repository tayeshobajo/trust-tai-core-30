import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { SourcesWorkspace } from "@/components/tt/studio/sources-workspace";
export const Route = createFileRoute("/modules/studio/sources")({
  head: () => ({
    meta: [{ title: "Studio · Sources · Trust Tai OS" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <WorkspaceGate appId="studio">
      {(identity) => <SourcesWorkspace identity={identity} />}
    </WorkspaceGate>
  ),
});
