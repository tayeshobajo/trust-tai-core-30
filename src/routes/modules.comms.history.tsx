/**
 * History.
 *
 * What has left and what came back, across the workspace or for one person.
 * Selection lives in the address, so the same view comes back after a reload.
 * Nothing here sends: preparing a new draft goes through the usual review.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AppShell } from "@/components/tt/app-shell";
import { CommsPageHeader, CommsTabs } from "@/components/tt/comms/comms-tabs";
import { HistoryWorkspace, type HistorySelection } from "@/components/tt/comms/history-workspace";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { HISTORY_FILTERS, type HistoryFilter } from "@/domain/comms-history";

const TITLE = "History · Comms · Trust Tai OS";
const DESCRIPTION =
  "Every message that has left, every reply on the record, and the drafts whose review ended in a send, with a way to write the next one from them.";

export const Route = createFileRoute("/modules/comms/history")({
  validateSearch: (search: Record<string, unknown>): HistorySelection => {
    const text = (key: string) =>
      typeof search[key] === "string" ? (search[key] as string).trim() : "";
    const filter = text("filter");
    const relationship = text("relationship");
    const q = text("q");
    return {
      ...(HISTORY_FILTERS.includes(filter as HistoryFilter)
        ? { filter: filter as HistoryFilter }
        : {}),
      ...(relationship ? { relationship } : {}),
      ...(q ? { q } : {}),
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
  component: HistoryRoute,
});

function HistoryRoute() {
  const selection = Route.useSearch();
  const navigate = useNavigate();
  return (
    <WorkspaceGate appId="comms">
      {(identity) => (
        <AppShell identity={identity}>
          <div className="space-y-5">
            <CommsPageHeader
              title="History"
              supporting="What has left, what came back, and the drafts whose review ended in a send. Write the next one straight from any of them."
            />
            <CommsTabs active="history" />
            <HistoryWorkspace
              identity={identity}
              selection={selection}
              onSelect={(next) =>
                void navigate({ to: "/modules/comms/history", search: next, replace: true })
              }
            />
          </div>
        </AppShell>
      )}
    </WorkspaceGate>
  );
}
