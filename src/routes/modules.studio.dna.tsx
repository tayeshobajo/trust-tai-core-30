import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { DnaWorkspace } from "@/components/tt/studio/dna-workspace";
export const Route = createFileRoute("/modules/studio/dna")({
  head: () => ({
    meta: [{ title: "Studio · Dna · Trust Tai OS" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <WorkspaceGate appId="studio">
      {(identity) => <DnaWorkspace identity={identity} />}
    </WorkspaceGate>
  ),
});
