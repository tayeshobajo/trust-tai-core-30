/**
 * What Comms is connected to, and honestly what it is not.
 *
 * Nothing here fetches from a vendor. It reports connection state as stored,
 * and where there is no connection it says so plainly. There is no sample
 * mailbox, no sample event, and no implied capability.
 */

import { MetaPill, SectionHeading, TTCard } from "@/components/tt/primitives";
import { GmailConnection } from "@/components/tt/comms/gmail-connection";
import { AmbientRule } from "@/components/tt/ambient";
import {
  INTEGRATION_PROVIDER_LABEL,
  INTEGRATION_STATUS_LABEL,
  type IntegrationConnection,
  type IntegrationProvider,
} from "@/domain/comms-integrations";

interface TrackDescription {
  key: string;
  title: string;
  body: string;
  provider?: IntegrationProvider;
  needs: string;
}

const TRACKS: TrackDescription[] = [
  {
    key: "people",
    title: "People intelligence",
    body: "Roles, decision makers, and profile links from approved sources or entered by hand. LinkedIn is never scraped; a URL is stored as a link, never crawled.",
    needs: "An approved enrichment provider account.",
  },
  {
    key: "email",
    title: "Email discovery and verification",
    body: "Discovery and verification stay separate. A found address reads as found, never as verified, and a suppressed address is never drafted to.",
    needs: "A verification provider key.",
  },
  {
    key: "events",
    title: "Events",
    body: "Tennessee and travel-relevant events, each with why it matters and who is worth meeting. Manual and calendar imports first.",
    needs: "A calendar feed, an event page, or a provider key.",
  },
];

function statusFor(
  connections: IntegrationConnection[],
  provider: IntegrationProvider | undefined,
): IntegrationConnection | null {
  if (!provider) return null;
  return connections.find((connection) => connection.provider === provider) ?? null;
}

export function IntegrationsPanel({
  organizationId,
  connections,
  provisioned,
}: {
  organizationId: string;
  connections: IntegrationConnection[];
  provisioned: boolean;
}) {
  return (
    <section className="space-y-6">
      <SectionHeading
        title="Connections"
        description="Comms reads the outside world only through approved sources, and only under your own access. Nothing is sent from here."
      />

      {!provisioned ? (
        <TTCard className="p-5 text-sm text-muted-foreground">
          The integration tables are not in the workspace yet. Apply{" "}
          <code className="text-foreground">docs/comms-integrations-schema.sql</code> in the Trust
          Tai Supabase project to switch this layer on. Until then Comms runs on relationships,
          touches, and drafts alone.
        </TTCard>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <GmailConnection
          organizationId={organizationId}
          connection={statusFor(connections, "gmail")}
          provisioned={provisioned}
        />
        {TRACKS.map((track) => {
          const connection = statusFor(connections, track.provider);
          const label = connection
            ? INTEGRATION_STATUS_LABEL[connection.status]
            : INTEGRATION_STATUS_LABEL.disconnected;
          return (
            <TTCard key={track.key} className="space-y-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-base font-medium text-foreground">{track.title}</h3>
                <MetaPill>{label}</MetaPill>
              </div>
              <AmbientRule appId="comms" contextAccent={null} />
              <p className="text-sm leading-relaxed text-muted-foreground">{track.body}</p>
              {connection?.accountEmail ? (
                <p className="text-xs text-muted-foreground">
                  {INTEGRATION_PROVIDER_LABEL[connection.provider]} · {connection.accountEmail}
                  {connection.lastSyncAt
                    ? ` · last read ${new Date(connection.lastSyncAt).toLocaleString()}`
                    : ""}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Needs: {track.needs}</p>
              )}
              {connection?.lastError ? (
                <p className="text-xs text-destructive">{connection.lastError}</p>
              ) : null}
            </TTCard>
          );
        })}
      </div>
    </section>
  );
}
