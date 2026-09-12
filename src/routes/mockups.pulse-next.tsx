/**
 * MOCKUP ONLY — Pulse Next.
 *
 * An isolated visual prototype for approval. It is not linked from navigation,
 * reads no production data, writes nothing, and calls no service. Every value
 * comes from static fixtures. `/modules/pulse` is untouched by this file.
 */

import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/tt/app-shell";
import {
  BusinessRead,
  NeedsTai,
  PulseNextHeader,
  RecentMovement,
  SignalField,
} from "@/components/mockups/pulse-next/pieces";

const TITLE = "Mockup · Pulse Next · Trust Tai OS";
const DESCRIPTION =
  "An isolated visual prototype of the proposed Pulse experience: what needs you, the business read, the signal field, and recent movement. Fixture data only.";

export const Route = createFileRoute("/mockups/pulse-next")({
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
  component: PulseNextMockup,
});

function PulseNextMockup() {
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl pb-24">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-warning/30 bg-warning/8 px-3 py-1 text-[11px] text-warning">
          Prototype · illustrative data, nothing wired
        </p>

        <PulseNextHeader />

        <div className="mt-7 space-y-7">
          <NeedsTai />
          <BusinessRead />

          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_260px]">
            <SignalField />
            <RecentMovement />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
