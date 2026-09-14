/**
 * MOCKUP ONLY — Comms Next.
 *
 * A connected interactive prototype of the proposed Comms experience, shown
 * inside the authenticated app. It reads no production record, writes nothing,
 * calls no service, and sends nothing. `/modules/comms` is untouched by this
 * file.
 */

import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/tt/app-shell";
import { CommsNextWorkspace } from "@/components/mockups/comms-next/workspace";

const TITLE = "Mockup · Comms Next · Trust Tai OS";
const DESCRIPTION =
  "An interactive prototype of the proposed Comms experience: Conversations, Review and Follow-ups, built on labelled sample data.";

export const Route = createFileRoute("/mockups/comms-next")({
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
  component: CommsNextMockup,
});

function CommsNextMockup() {
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-warning/30 bg-warning/10 px-3 py-1 text-[12px] text-warning">
          Prototype · sample data only, nothing is sent or saved
        </p>
        <CommsNextWorkspace />
      </div>
    </AppShell>
  );
}
