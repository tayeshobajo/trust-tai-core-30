import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { VideoStudio } from "@/components/tt/studio/video-studio";

/** The supplied reference covers only Video; the Studio index remains unchanged. */
export const Route = createFileRoute("/modules/studio/video")({
  head: () => ({
    meta: [{ title: "Studio · Video · Trust Tai OS" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <WorkspaceGate appId="studio">
      {(identity) => <VideoStudio identity={identity} />}
    </WorkspaceGate>
  ),
});
