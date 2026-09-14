/**
 * Comms review, on real records.
 *
 * A person brings the message they received and the reply they intend to
 * send. Comms judges their words, tracks every question they were asked, and
 * records approval against one exact version. Nothing here sends anything.
 */

import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/tt/app-shell";
import { CommsTabs } from "@/components/tt/comms/comms-tabs";
import { ReviewWorkspace } from "@/components/tt/comms/review-workspace";
import { PageHeader } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";

const TITLE = "Review · Comms · Trust Tai OS";
const DESCRIPTION =
  "Check a reply before it goes: what was asked, what the draft answers, what it claims, and who approved these exact words.";

export const Route = createFileRoute("/modules/comms/review")({
  /* The queue hands a message over by naming its review. Nothing else about
     this screen changes: the review is still opened and read as the caller. */
  validateSearch: (search: Record<string, unknown>): { session?: string } => {
    const value = typeof search["session"] === "string" ? search["session"].trim() : "";
    return value ? { session: value } : {};
  },
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReviewRoute,
});

function ReviewRoute() {
  const { session } = Route.useSearch();
  return (
    <WorkspaceGate appId="comms">
      {(identity) => (
        <AppShell identity={identity}>
          <div className="space-y-8">
            <PageHeader
              eyebrow="Comms"
              title="Review"
              supporting="Your words, judged against theirs, before anything is sent."
              appId="comms"
            />
            <CommsTabs active="drafts" />
            <ReviewWorkspace identity={identity} {...(session ? { openSessionId: session } : {})} />
          </div>
        </AppShell>
      )}
    </WorkspaceGate>
  );
}
