/**
 * Pulse — the intelligence room.
 *
 * Pulse reads the suite and shows what it noticed: one card per signal, with
 * why it matters, what it rests on, and a door into the room that owns the
 * change. Pulse never changes another room's truth.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { BusinessRead } from "@/components/tt/intelligence/business-read";
import { LearningTrailPanel } from "@/components/tt/intelligence/learning-trail";
import { useIntelligenceRuns } from "@/hooks/use-intelligence-runs";
import { EmptyState, MetaPill, SectionHeading, TTButton, TTCard } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { deriveSignals } from "@/data/intelligence/derive";
import { intelligenceService, loadSuiteSnapshot } from "@/data/intelligence/service";
import { CONFIDENCE_LEVEL_LABEL } from "@/domain/confidence";
import { SIGNAL_CATEGORY_LABEL, type Signal } from "@/domain/signals";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Pulse — Signals across the suite — Trust Tai OS";
const DESCRIPTION =
  "What Trust Tai noticed across Scout, Comms, Roadmap and Projects: each signal with its evidence and a door into the room that owns it.";

const ROOM_LABEL: Record<string, string> = {
  scout: "Scout",
  comms: "Comms",
  roadmap: "Roadmap",
  projects: "Projects",
  studio: "Studio",
  ops: "Ops",
  steward: "Steward",
  activity: "Activity",
};

const WITHHELD_REASON: Record<string, string> = {
  unauthorized: "not readable for you",
  not_connected: "not connected yet",
  no_data: "nothing recorded yet",
};

export const Route = createFileRoute("/modules/pulse")({
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
  component: PulseRoute,
});

function PulseRoute() {
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <Pulse identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function Pulse({ identity }: { identity: WorkspaceIdentity }) {
  const { organizationId } = identity;
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["pulse", organizationId],
    queryFn: async () => {
      const snapshot = await loadSuiteSnapshot(organizationId);
      return { signals: deriveSignals(snapshot), withheld: snapshot.withheld };
    },
  });

  /*
   * The engine runs itself: on arrival, when a room records something, and
   * once a day in a quiet week. A person can always ask for a read now.
   */
  const engine = useIntelligenceRuns(organizationId);

  const signals = data?.signals ?? [];

  return (
    <div className="space-y-12">
      <AppHero
        appId="pulse"
        eyebrow="Trust Tai OS / Pulse"
        title="What the system noticed."
        supporting="Signals are read, not stored. Each one says why it matters, what it rests on, and where the work happens."
      />

      {engine.read ? (
        <div className="space-y-4">
          <BusinessRead
            read={engine.read}
            reasoning={engine.refreshing}
            onDecide={async ({ recommendation, decision, editedText }) => {
              await intelligenceService.decide({
                organizationId,
                userId: identity.userId,
                userName: identity.name,
                recommendation,
                decision,
                ...(editedText ? { editedText } : {}),
              });
              await engine.invalidate();
            }}
            onAuthorize={async ({ proposal, decision, note }) => {
              await intelligenceService.authorizeAction({
                organizationId,
                userId: identity.userId,
                userName: identity.name,
                proposal,
                decision,
                ...(note ? { note } : {}),
              });
            }}
          />

          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-muted-foreground">
              {engine.refreshing ? "Reading again." : engine.because}
            </p>
            <TTButton variant="quiet" onClick={() => void engine.refresh()}>
              Read now
            </TTButton>
          </div>
        </div>
      ) : engine.loading ? (
        <p className="text-sm text-muted-foreground">Reading the business.</p>
      ) : engine.failed ? (
        <p className="text-sm text-muted-foreground">
          That read could not be completed. Nothing has been changed.
        </p>
      ) : null}

      {engine.trail ? <LearningTrailPanel trail={engine.trail} /> : null}

      <section aria-labelledby="signals-heading">
        <SectionHeading
          eyebrow="Read just now"
          title={
            signals.length > 0
              ? `${signals.length} signal${signals.length === 1 ? "" : "s"}`
              : "Signals"
          }
          description="Most urgent first. Pulse recommends and routes; the room that owns the change is where you act."
        />

        <div id="signals-heading" className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Reading the suite.</p>
          ) : isError ? (
            <p className="text-sm text-muted-foreground">
              That reading could not be completed. Nothing has been changed.
            </p>
          ) : signals.length > 0 ? (
            signals.map((signal) => <SignalCard key={signal.id} signal={signal} />)
          ) : (
            <EmptyState
              title="Nothing needs your attention"
              belongsHere="Signals from Scout, Comms, Roadmap, Projects and Ops surface here."
              whyItMatters="An empty Pulse is a truthful result: the work is moving without you."
            />
          )}
        </div>

        {data && data.withheld.length > 0 ? (
          <p className="mt-6 text-xs text-muted-foreground">
            Not read:{" "}
            {data.withheld
              .map(
                (w) =>
                  `${ROOM_LABEL[w.appId] ?? w.appId} (${WITHHELD_REASON[w.reason] ?? w.reason})`,
              )
              .join(", ")}
            .
          </p>
        ) : null}
      </section>
    </div>
  );
}

function SignalCard({ signal }: { signal: Signal }) {
  return (
    <TTCard className="p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <MetaPill>{SIGNAL_CATEGORY_LABEL[signal.category]}</MetaPill>
        <MetaPill>{CONFIDENCE_LEVEL_LABEL[signal.confidence]}</MetaPill>
        <MetaPill>via {ROOM_LABEL[signal.destination.appId] ?? signal.destination.appId}</MetaPill>
      </div>

      <h3 className="mt-3 text-base font-semibold text-foreground">{signal.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{signal.why}</p>

      <p className="mt-3 text-sm text-foreground">
        <span className="text-muted-foreground">Recommended: </span>
        {signal.recommendedNextMove}
      </p>

      {signal.evidence.length > 0 ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="tt-eyebrow mb-2">What this rests on</p>
          <ul className="flex flex-wrap gap-1.5">
            {signal.evidence.map((ref, index) => (
              <li key={`${ref.label}-${index}`}>
                {ref.url ? (
                  <a
                    href={ref.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[13px] text-foreground underline underline-offset-4"
                  >
                    {ref.label}
                  </a>
                ) : (
                  <MetaPill>{ref.label}</MetaPill>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/^https?:\/\//.test(signal.destination.route) ? (
        <a
          href={signal.destination.route}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground underline underline-offset-4 transition-colors hover:text-royal"
        >
          {signal.destination.label} →
        </a>
      ) : (
        <Link
          to={signal.destination.route}
          className="mt-4 inline-block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground underline underline-offset-4 transition-colors hover:text-royal"
        >
          {signal.destination.label} →
        </Link>
      )}
    </TTCard>
  );
}
