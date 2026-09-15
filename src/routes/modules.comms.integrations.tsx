/**
 * Comms connections.
 *
 * The honest state of every external source Comms can read. Fails closed: with
 * nothing connected, this page says nothing is connected.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/tt/app-shell";
import { CommsPageHeader, CommsTabs } from "@/components/tt/comms/comms-tabs";
import { IntegrationsPanel } from "@/components/tt/comms/integrations-panel";
import { TTButton } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { listIntegrations } from "@/data/supabase/comms-integrations";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Connections · Comms · Trust Tai OS";
const DESCRIPTION =
  "What Comms reads from the outside world: mailbox, people intelligence, email verification, and events.";

export const Route = createFileRoute("/modules/comms/integrations")({
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
  component: IntegrationsRoute,
});

function IntegrationsRoute() {
  return (
    <WorkspaceGate appId="comms">
      {(identity) => (
        <AppShell identity={identity}>
          <Connections identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function Connections({ identity }: { identity: WorkspaceIdentity }) {
  const query = useQuery({
    queryKey: ["comms", "integrations", identity.organizationId],
    queryFn: () => listIntegrations(identity.organizationId),
  });

  return (
    <div className="space-y-6">
      <CommsPageHeader
        title="Connections"
        supporting="Comms reads only approved sources, only under your own access, and never sends anything."
      />
      <CommsTabs active="integrations" />

      {query.isError ? (
        /* A failed read is said plainly and can be tried again. An empty
           panel here would read as "nothing is connected", which is a
           different and much worse claim. */
        <div className="space-y-2">
          <p className="text-sm text-destructive">
            {query.error instanceof Error
              ? query.error.message
              : "The connection state could not be read, so none is shown. This is not the same as nothing being connected."}
          </p>
          <TTButton size="sm" variant="quiet" onClick={() => void query.refetch()}>
            Try again
          </TTButton>
        </div>
      ) : query.isLoading ? (
        <p className="text-sm text-muted-foreground">Reading connection state…</p>
      ) : (
        <div className="space-y-4">
          <IntegrationsPanel
            organizationId={identity.organizationId}
            connections={query.data?.connections ?? []}
            provisioned={query.data?.provisioned ?? false}
          />
          {/* Nothing here is subscribed. Say when it was read rather than
              letting a stale page look current. */}
          <p className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <span>
              {query.isFetching
                ? "Reading connection state now."
                : `Read at ${new Date(query.dataUpdatedAt).toLocaleTimeString()}. Changes made elsewhere show when you return to this tab or check again.`}
            </span>
            <TTButton
              size="sm"
              variant="quiet"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Check again
            </TTButton>
          </p>
        </div>
      )}
    </div>
  );
}
