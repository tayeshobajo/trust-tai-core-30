/**
 * Pulse, the visibility room.
 *
 * One question: what deserves attention right now, and why? Signals are read
 * from the suite, sorted into four attention levels, and routed to the room
 * that owns the change. Pulse never changes another room's truth.
 */

import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/tt/app-shell";
import { PulseFilters, type PulseFilter } from "@/components/tt/pulse/filters";
import { PulseHeader } from "@/components/tt/pulse/header";
import { PulseRightRail } from "@/components/tt/pulse/right-rail";
import { PulseSidebar } from "@/components/tt/pulse/sidebar";
import { PulseSignalGroup } from "@/components/tt/pulse/signal-group";
import { EmptyState } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { deriveSignals } from "@/data/intelligence/derive";
import { loadSuiteSnapshot } from "@/data/intelligence/service";
import {
  PULSE_ROOM_LABEL,
  countSignals,
  groupSignals,
  recentlyUpdated,
  relativeAge,
  topAreas,
  toPulseSignals,
  weeklyTrend,
} from "@/data/pulse/projection";
import { pulseFeedback } from "@/data/supabase/pulse-feedback";
import { projectsService } from "@/data/supabase/projects-service";
import { unansweredRoutes } from "@/domain/route-ledger";
import type { PulseFeedbackKind, PulseSignal } from "@/domain/pulse";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Pulse · What deserves attention now · Trust Tai OS";
const DESCRIPTION =
  "The few signals across Scout, Comms, Roadmap, Projects and Ops that are worth deciding, each with its reason, its evidence, and the room that owns the work.";

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
    <WorkspaceGate appId="pulse">{(identity) => <Pulse identity={identity} />}</WorkspaceGate>
  );
}

function Pulse({ identity }: { identity: WorkspaceIdentity }) {
  const { organizationId } = identity;
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<PulseFilter>("all");
  const [room, setRoom] = useState<string | "all">("all");

  const suite = useQuery({
    queryKey: ["pulse", organizationId],
    queryFn: async () => {
      const snapshot = await loadSuiteSnapshot(organizationId);
      return {
        signals: deriveSignals(snapshot),
        withheld: snapshot.withheld,
        readAt: new Date().toISOString(),
      };
    },
  });

  const routes = useQuery({
    queryKey: ["pulse-routes", organizationId],
    queryFn: async () => unansweredRoutes(await projectsService.routeLedger(organizationId)),
  });

  const feedback = useQuery({
    queryKey: ["pulse-feedback", organizationId],
    queryFn: () => pulseFeedback.list(organizationId),
  });

  const now = suite.data?.readAt ?? new Date().toISOString();

  const signals = useMemo(
    () =>
      toPulseSignals({
        organizationId,
        now,
        signals: suite.data?.signals ?? [],
        routes: routes.data ?? [],
        feedback: feedback.data ?? [],
      }),
    [organizationId, now, suite.data, routes.data, feedback.data],
  );

  const counts = useMemo(() => countSignals(signals), [signals]);

  const feedbackBySignal = useMemo(() => {
    const map: Record<string, PulseFeedbackKind> = {};
    for (const entry of feedback.data ?? []) map[entry.signalId] = entry.kind;
    return map;
  }, [feedback.data]);

  const rooms = useMemo(() => {
    const ids = [...new Set(signals.map((signal) => signal.sourceApp))].sort();
    return ids.map((id) => ({ id, label: PULSE_ROOM_LABEL[id] ?? id }));
  }, [signals]);

  const visible = useMemo(
    () =>
      signals.filter(
        (signal) =>
          (filter === "all" || signal.severity === filter) &&
          (room === "all" || signal.sourceApp === room),
      ),
    [signals, filter, room],
  );

  const groups = useMemo(() => groupSignals(visible), [visible]);

  const record = useMutation({
    mutationFn: async ({ signal, kind }: { signal: PulseSignal; kind: PulseFeedbackKind }) =>
      pulseFeedback.record({
        organizationId,
        userId: identity.userId,
        signalId: signal.id,
        kind,
        signalTitle: signal.title,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["pulse-feedback", organizationId] }),
  });

  const lastUpdated = suite.data ? relativeAge(suite.data.readAt, new Date().toISOString()) : "-";

  return (
    <AppShell identity={identity} sidebar={<PulseSidebar counts={counts} />}>
      <div className="space-y-8">
        <PulseHeader
          lastUpdated={lastUpdated}
          refreshing={suite.isFetching}
          onRefresh={() => {
            void queryClient.invalidateQueries({ queryKey: ["pulse", organizationId] });
            void queryClient.invalidateQueries({ queryKey: ["pulse-routes", organizationId] });
          }}
        />

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-6">
            <section aria-labelledby="signals-heading" className="space-y-5">
              <div>
                <p className="tt-eyebrow">High-impact signals</p>
                <h2
                  id="signals-heading"
                  className="tt-display mt-2 max-w-[26ch] text-[22px] text-foreground sm:text-[26px]"
                >
                  {counts.total > 0
                    ? `${counts.total} signal${counts.total === 1 ? "" : "s"} about the business ${
                        counts.total === 1 ? "is" : "are"
                      } worth deciding.`
                    : "Nothing about the business needs deciding."}
                </h2>
              </div>

              {counts.total > 0 ? (
                <PulseFilters
                  counts={counts}
                  active={filter}
                  onChange={setFilter}
                  rooms={rooms}
                  room={room}
                  onRoomChange={setRoom}
                />
              ) : null}

              {suite.isLoading ? (
                <p className="text-sm text-muted-foreground">Reading the suite.</p>
              ) : suite.isError ? (
                <p className="text-sm text-muted-foreground">
                  That reading could not be completed. Nothing has been changed.
                </p>
              ) : groups.length > 0 ? (
                <div className="space-y-5">
                  {groups.map((group) => (
                    <PulseSignalGroup
                      key={group.severity}
                      severity={group.severity}
                      signals={group.signals}
                      feedback={feedbackBySignal}
                      onFeedback={(signal, kind) => record.mutate({ signal, kind })}
                    />
                  ))}
                </div>
              ) : counts.total > 0 ? (
                <EmptyState
                  title="Nothing matches this filter"
                  belongsHere="Clear the filter to see every signal Pulse read."
                  whyItMatters="A narrow view is useful, but the work may sit at another level."
                />
              ) : (
                <EmptyState
                  title="Nothing needs your attention"
                  belongsHere="Signals from Scout, Comms, Roadmap, Projects, Ops and Steward surface here."
                  whyItMatters="An empty Pulse is a truthful result: the work is moving without you."
                />
              )}

              {suite.data && suite.data.withheld.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Not read:{" "}
                  {suite.data.withheld
                    .map(
                      (w) =>
                        `${PULSE_ROOM_LABEL[w.appId] ?? w.appId} (${
                          WITHHELD_REASON[w.reason] ?? w.reason
                        })`,
                    )
                    .join(", ")}
                  .
                </p>
              ) : null}
            </section>

            <p className="text-[13px] text-muted-foreground">
              Pulse says what deserves attention and where the work lives. For the read behind a
              signal, what it rests on, what it would take, and any step you can authorise,{" "}
              <Link to="/modules/conductor" className="text-foreground underline underline-offset-4">
                open it in the Conductor
              </Link>
              .
            </p>
          </div>

          <PulseRightRail
            counts={counts}
            trend={weeklyTrend(signals, now)}
            areas={topAreas(signals)}
            recent={recentlyUpdated(signals, now)}
          />
        </div>
      </div>
    </AppShell>
  );
}
