/**
 * MOCKUP ONLY — Comms Direction B, conversation workspace.
 *
 * Fixture data and local state only. No production Comms record, route or
 * component is read or changed here, and nothing is ever sent.
 */

import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/tt/app-shell";
import { DirectionB } from "@/components/mockups/comms-familiar/direction-b";

const TITLE = "Mockup · Comms B, conversation workspace · Trust Tai OS";
const DESCRIPTION =
  "An isolated prototype of Comms with three destinations, Conversations, Follow-ups and People, and review kept inside the draft.";

export const Route = createFileRoute("/mockups/comms-familiar-b")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AppShell>
      <DirectionB />
    </AppShell>
  ),
});
