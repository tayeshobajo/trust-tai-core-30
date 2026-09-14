/**
 * MOCKUP ONLY — Comms Direction A, inbox-first.
 *
 * Fixture data and local state only. No production Comms record, route or
 * component is read or changed here, and nothing is ever sent.
 */

import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/tt/app-shell";
import { DirectionA } from "@/components/mockups/comms-familiar/direction-a";

const TITLE = "Mockup · Comms A, inbox-first · Trust Tai OS";
const DESCRIPTION =
  "An isolated prototype of Comms with two destinations, Inbox and People, and Trust Tai's reading, review and follow-ups inside the thread.";

export const Route = createFileRoute("/mockups/comms-familiar-a")({
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
      <DirectionA />
    </AppShell>
  ),
});
