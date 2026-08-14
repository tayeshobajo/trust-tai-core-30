/**
 * Ops — the specialist room that runs outside this shell.
 *
 * Trust Tai OS does not rebuild Ops and does not mirror its technical state.
 * This page is a door: it hands the current session to Ops over a checked
 * handshake, and it shows the Ops evidence that already reached the shared
 * activity stream.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { LaunchOpsButton } from "@/components/tt/ops/launch-ops";
import { EmptyState, MetaPill, SectionHeading, TTCard } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { opsEventsOf } from "@/data/intelligence/derive";
import { loadSuiteSnapshot } from "@/data/intelligence/service";
import { OPS_ORIGIN } from "@/domain/ops";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Ops — Technical stewardship — Trust Tai OS";
const DESCRIPTION =
  "Open Trust Tai Ops with your Trust Tai session, and read the Ops evidence that reached the shared activity stream.";

export const Route = createFileRoute("/modules/ops")({
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
  component: OpsRoute,
});

function OpsRoute() {
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <OpsRoom identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function OpsRoom({ identity }: { identity: WorkspaceIdentity }) {
  const { data, isLoading } = useQuery({
    queryKey: ["ops-evidence", identity.organizationId],
    queryFn: async () => opsEventsOf(await loadSuiteSnapshot(identity.organizationId)),
  });

  const events = data ?? [];

  return (
    <div className="space-y-12">
      <AppHero
        appId="ops"
        eyebrow="Trust Tai OS / Ops"
        title="Technical stewardship lives in Ops."
        supporting="Ops is its own application. Trust Tai OS carries your identity across, and reads back what Ops recorded."
      />

      <section>
        <SectionHeading
          eyebrow="Launch"
          title="Open Ops with this session"
          description={`Ops runs at ${OPS_ORIGIN}. Your session is handed over in memory once Ops answers, never in a link.`}
        />
        <LaunchOpsButton organizationId={identity.organizationId} returnContext="ops-room" />
      </section>

      <section>
        <SectionHeading
          eyebrow="Shared evidence"
          title="What Ops has recorded here"
          description="Only real rows Ops wrote into the shared activity stream for your organization."
        />
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Reading the activity stream.</p>
        ) : events.length === 0 ? (
          <EmptyState
            title="No Ops evidence yet"
            belongsHere="Issues, runs, approvals and QA results Ops records will appear here."
            whyItMatters="An empty list is a truthful result. Nothing is shown that Ops did not write."
          />
        ) : (
          <div className="space-y-3">
            {events.map((event) => (
              <TTCard key={event.idempotencyKey} className="p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <MetaPill>{event.name.replace("ops.", "").replace(/_/g, " ")}</MetaPill>
                  <MetaPill>{new Date(event.at).toLocaleDateString()}</MetaPill>
                  {event.canonicalProjectId ? <MetaPill>linked to a project</MetaPill> : null}
                </div>
                <p className="mt-2 text-sm text-foreground">{event.summary}</p>
                <a
                  href={event.destinationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground underline underline-offset-4"
                >
                  Open in Ops →
                </a>
              </TTCard>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
