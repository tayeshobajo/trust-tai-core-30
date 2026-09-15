/**
 * Drafts & Reviews.
 *
 * One page for writing that has not gone anywhere yet. Selection lives in the
 * address, so the same record comes back after a reload. Nothing here sends
 * without the governed approval.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AppShell } from "@/components/tt/app-shell";
import { CommsPageHeader, CommsTabs } from "@/components/tt/comms/comms-tabs";
import {
  DraftsWorkspace,
  DRAFTS_FILTERS,
  type DraftsFilter,
  type DraftsSelection,
} from "@/components/tt/comms/drafts-workspace";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { DRAFT_KINDS, type DraftKind } from "@/domain/comms-draft-kind";

const TITLE = "Drafts & Reviews · Comms · Trust Tai OS";
const DESCRIPTION =
  "Messages, emails and proposals that have not been sent: what is waiting on you, and the one review record that governs each of them.";

export const Route = createFileRoute("/modules/comms/drafts")({
  validateSearch: (search: Record<string, unknown>): DraftsSelection => {
    const text = (key: string) =>
      typeof search[key] === "string" ? (search[key] as string).trim() : "";
    const kind = text("new");
    const filter = text("filter");
    const draft = text("draft");
    const session = text("session");
    return {
      ...(session ? { session } : {}),
      ...(draft ? { draft } : {}),
      ...(DRAFTS_FILTERS.includes(filter as DraftsFilter)
        ? { filter: filter as DraftsFilter }
        : {}),
      ...(DRAFT_KINDS.includes(kind as DraftKind) ? { new: kind as DraftKind } : {}),
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
  const selection = Route.useSearch();
  const navigate = useNavigate();
  return (
    <WorkspaceGate appId="comms">
      {(identity) => (
        <AppShell identity={identity}>
          <div className="space-y-5">
            <CommsPageHeader
              title="Drafts & Reviews"
              supporting="Writing that has not gone anywhere yet, and the one review each piece has to clear."
            />
            <CommsTabs active="drafts" />
            <DraftsWorkspace
              identity={identity}
              selection={selection}
              onSelect={(next) =>
                void navigate({ to: "/modules/comms/drafts", search: next, replace: false })
              }
            />
          </div>
        </AppShell>
      )}
    </WorkspaceGate>
  );
}
