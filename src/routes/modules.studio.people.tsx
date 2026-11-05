import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { PeopleWorkspace } from "@/components/tt/studio/people-workspace";
export const Route = createFileRoute("/modules/studio/people")({
  head: () => ({
    meta: [{ title: "Studio · People · Trust Tai OS" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <WorkspaceGate appId="studio">
      {(identity) => <PeopleWorkspace identity={identity} />}
    </WorkspaceGate>
  ),
});
