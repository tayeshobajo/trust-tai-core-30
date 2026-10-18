/**
 * Steward, the meeting workroom.
 *
 * The first page under Steward: stored meetings on the left, the confirmed
 * promises of one meeting in the middle, and the selected promise's source
 * and next step on the right. Real rows only; meeting review confirms
 * proposals, not completion. Verify/reopen controls remain unavailable.
 * The compact Steward workroom is embedded in AppShell; global suite
 * navigation and account controls remain in the shared shell.
 */

import { createFileRoute } from "@tanstack/react-router";

import { StewardWorkroom } from "@/components/tt/steward/workroom";
import { WorkspaceGate } from "@/components/tt/workspace-gate";

const TITLE = "Steward · Meetings · Trust Tai OS";
const DESCRIPTION =
  "What was promised in each meeting, who owns it, and what is genuinely verified complete.";

export const Route = createFileRoute("/modules/steward/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: StewardWorkroomRoute,
});

function StewardWorkroomRoute() {
  return (
    <WorkspaceGate appId="steward">
      {(identity) => <StewardWorkroom identity={identity} />}
    </WorkspaceGate>
  );
}
