/**
 * Comms connections.
 *
 * The honest state of every external source Comms can read. Fails closed: with
 * nothing connected, this page says nothing is connected.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/tt/app-shell";
import { CommsTabs } from "@/components/tt/comms/comms-tabs";
import { IntegrationsPanel } from "@/components/tt/comms/integrations-panel";
import { PageHeader } from "@/components/tt/primitives";
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
    <div className="space-y-8">
      <PageHeader
        eyebrow="Comms"
        title="Connections"
        supporting="Comms reads only approved sources, only under your own access, and never sends anything."
        appId="comms"
      />
      <CommsTabs active="integrations" />

      {query.isError ? (
        <p className="text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "That read failed."}
        </p>
      ) : query.isLoading ? (
        <p className="text-sm text-muted-foreground">Reading connection state…</p>
      ) : (
        <IntegrationsPanel
          organizationId={identity.organizationId}
          connections={query.data?.connections ?? []}
          provisioned={query.data?.provisioned ?? false}
        />
      )}
    </div>
  );
}
