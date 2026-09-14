/**
 * Drafts & Reviews.
 *
 * One page for writing that has not gone anywhere yet: the drafts held at the
 * human boundary, and the review records that govern them. A new draft of a
 * stated kind starts here too. Nothing on this page sends.
 */

import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/tt/app-shell";
import { CommsTabs, NEW_DRAFT_LABEL, type NewDraftKind } from "@/components/tt/comms/comms-tabs";
import { DraftQueue } from "@/components/tt/comms/draft-queue";
import { ReviewWorkspace } from "@/components/tt/comms/review-workspace";
import { PageHeader } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";

const TITLE = "Drafts & Reviews · Comms · Trust Tai OS";
const DESCRIPTION =
  "Messages, emails and proposals that have not been sent: what is waiting on a review, and the review record that governs each one.";

const KINDS: NewDraftKind[] = ["message", "email", "proposal"];

export const Route = createFileRoute("/modules/comms/drafts")({
  validateSearch: (search: Record<string, unknown>): { new?: NewDraftKind; session?: string } => {
    const kind = typeof search["new"] === "string" ? search["new"] : "";
    const session = typeof search["session"] === "string" ? search["session"].trim() : "";
    return {
      ...(KINDS.includes(kind as NewDraftKind) ? { new: kind as NewDraftKind } : {}),
      ...(session ? { session } : {}),
    };
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
  component: DraftsRoute,
});

function DraftsRoute() {
  const { new: kind, session } = Route.useSearch();
  return (
    <WorkspaceGate appId="comms">
      {(identity) => (
        <AppShell identity={identity}>
          <div className="space-y-8">
            <PageHeader
              eyebrow="Comms"
              title="Drafts & Reviews"
              supporting="Writing that has not gone anywhere yet, and the one review record each piece has to clear."
              appId="comms"
            />
            <CommsTabs active="drafts" />
            {kind ? (
              <p className="rounded-xl border border-border px-4 py-3 text-[13px] text-muted-foreground">
                Starting a new <span className="text-foreground">{NEW_DRAFT_LABEL[kind]}</span>. Use
                the intake below: paste what you are responding to, then your draft. Structured
                proposal sections are not built yet — for now a proposal is written as text.
              </p>
            ) : null}
            <DraftQueue identity={identity} />
            <ReviewWorkspace identity={identity} {...(session ? { openSessionId: session } : {})} />
          </div>
        </AppShell>
      )}
    </WorkspaceGate>
  );
}
