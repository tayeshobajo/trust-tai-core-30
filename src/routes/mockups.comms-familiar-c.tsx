/**
 * MOCKUP ONLY — Comms Direction C, relationship-first.
 *
 * Fixture data and local state only. No production Comms record, route or
 * component is read or changed here, and nothing is ever sent.
 */

import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/tt/app-shell";
import { DirectionC } from "@/components/mockups/comms-familiar/direction-c";

const TITLE = "Mockup · Comms C, relationship-first · Trust Tai OS";
const DESCRIPTION =
  "An isolated prototype of Comms that starts from people, opens their whole history in place, and keeps review inside the draft.";

export const Route = createFileRoute("/mockups/comms-familiar-c")({
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
      <DirectionC />
    </AppShell>
  ),
});
