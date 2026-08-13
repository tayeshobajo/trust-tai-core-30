/**
 * Roadmap — the sequencing room.
 *
 * Two things lead: what needs a decision, and what is actually moving.
 * Everything is read from the live Trust Tai backend under the caller's own
 * access. A failure is reported as itself; there are no fixtures.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { EmptyState, MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import { StartRoadmapForm, type StartRoadmapValues } from "@/components/tt/roadmap/start-form";
import { TierChip } from "@/components/tt/roadmap/tier";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { listSubjects } from "@/data/supabase/roadmap-subjects";
import { roadmapService, type RoadmapContext } from "@/data/supabase/roadmap-service";
import type { Roadmap, RoadmapDecision } from "@/domain/roadmap";
import { isActiveRoadmap, ROADMAP_STATUS_LABEL } from "@/domain/roadmap";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Roadmap — Point A to Point B — Trust Tai OS";
const DESCRIPTION =
  "Trust Tai's sequencing room: current truth, an agreed destination, and the build order between them.";

export const Route = createFileRoute("/modules/roadmap/")({
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
  component: RoadmapRoute,
});

function RoadmapRoute() {
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <RoadmapRoom identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function RoadmapRoom({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const context: RoadmapContext = {
    organizationId: identity.organizationId,
    userId: identity.userId,
    userLabel: identity.name,
  };

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const roadmapsQuery = useQuery({
    queryKey: ["roadmap", "list", identity.organizationId],
    queryFn: () => roadmapService.list(identity.organizationId),
    retry: false,
  });

  const decisionsQuery = useQuery({
    queryKey: ["roadmap", "decisions", identity.organizationId],
    queryFn: () => roadmapService.openDecisions(identity.organizationId),
    retry: false,
    enabled: !roadmapsQuery.isError,
  });

  const subjectsQuery = useQuery({
    queryKey: ["roadmap", "subjects", identity.organizationId],
    queryFn: () => listSubjects(identity.organizationId),
    enabled: starting,
  });

  const create = useMutation({
    mutationFn: (values: StartRoadmapValues) =>
      roadmapService.create(
        {
          subject: { kind: values.subject.kind, id: values.subject.id },
          objective: values.objective,
          extraContext: values.extraContext || undefined,
        },
        context,
      ),
    onSuccess: async () => {
      setStarting(false);
      setStartError(null);
      await queryClient.invalidateQueries({ queryKey: ["roadmap"] });
    },
    onError: (error: unknown) =>
      setStartError(error instanceof Error ? error.message : "That roadmap could not be drafted."),
  });

  if (roadmapsQuery.isError) {
    const error = roadmapsQuery.error;
    return (
      <div className="space-y-8">
        <RoadmapHero identity={identity} />
        <EmptyState
          title="Roadmap could not be read."
          belongsHere="Roadmaps, their stages, and their decisions live in the shared Trust Tai backend, read under your own access."
          whyItMatters={
            error instanceof Error ? error.message : "An unexpected error stopped the read."
          }
        />
      </div>
    );
  }

  const roadmaps = roadmapsQuery.data ?? [];
  const decisions = decisionsQuery.data ?? [];
  const active = roadmaps.filter(isActiveRoadmap);
  const settled = roadmaps.filter((roadmap) => !isActiveRoadmap(roadmap));

  return (
    <div className="space-y-10">
      <RoadmapHero
        identity={identity}
        action={
          starting ? undefined : (
            <TTButton onClick={() => setStarting(true)}>Start a roadmap</TTButton>
          )
        }
      />

      {starting ? (
        <StartRoadmapForm
          subjects={subjectsQuery.data ?? []}
          loading={subjectsQuery.isLoading}
          busy={create.isPending}
          error={startError}
          onStart={(values) => create.mutate(values)}
          onCancel={() => {
            setStarting(false);
            setStartError(null);
          }}
        />
      ) : null}

      <section aria-labelledby="needs-decision">
        <SectionHeading
          eyebrow="Needs your decision"
          title={
            decisions.length === 0
              ? "Nothing is waiting on you"
              : `${decisions.length} ${decisions.length === 1 ? "decision" : "decisions"} are holding work up`
          }
          description="Decisions sit above activity because nothing downstream moves until they are made."
        />
        {decisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every open question on every roadmap has an answer. The next moves below can go ahead.
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {decisions.map((decision) => (
              <li key={decision.id}>
                <DecisionSummary decision={decision} roadmaps={roadmaps} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="active-roadmaps">
        <SectionHeading
          eyebrow="In motion"
          title="Active roadmaps"
          description="Each one carries a current truth, a destination, and one next move."
        />
        {active.length === 0 ? (
          <EmptyState
            title="No roadmaps yet."
            belongsHere="A roadmap belongs here once a client, prospect or relationship needs a sequenced path rather than a conversation."
            whyItMatters="Without one, the order of work lives in someone's head and depends on them being available."
            action={<TTButton onClick={() => setStarting(true)}>Start a roadmap</TTButton>}
          />
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {active.map((roadmap) => (
              <li key={roadmap.id}>
                <RoadmapCard roadmap={roadmap} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {settled.length > 0 ? (
        <section aria-labelledby="settled-roadmaps">
          <SectionHeading eyebrow="History" title="Complete and archived" />
          <ul className="grid gap-4 lg:grid-cols-2">
            {settled.map((roadmap) => (
              <li key={roadmap.id}>
                <RoadmapCard roadmap={roadmap} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function RoadmapHero({
  identity,
  action,
}: {
  identity: WorkspaceIdentity;
  action?: ReactNode;
}) {
  return (
    <AppHero
      appId="roadmap"
      eyebrow="Roadmap"
      greeting={`${identity.firstName}, here is the order of things.`}
      title="Point A to Point B, sequenced."
      supporting="Roadmap turns what we already know into a path someone can follow: current truth, an agreed destination, and the build order between them."
      action={action}
    />
  );
}

function DecisionSummary({
  decision,
  roadmaps,
}: {
  decision: RoadmapDecision;
  roadmaps: Roadmap[];
}) {
  const roadmap = roadmaps.find((entry) => entry.id === decision.roadmapId);
  return (
    <Link
      to="/modules/roadmap/$roadmapId"
      params={{ roadmapId: decision.roadmapId }}
      className="tt-surface block border-royal/20 p-5 transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="tt-eyebrow text-royal">Needs your decision</p>
      <p className="mt-2 text-sm font-medium text-foreground">{decision.question}</p>
      <p className="mt-1 text-sm text-muted-foreground">{decision.whyItMatters}</p>
      {roadmap ? <MetaPill className="mt-3">{roadmap.subjectLabel}</MetaPill> : null}
    </Link>
  );
}

function RoadmapCard({ roadmap }: { roadmap: Roadmap }) {
  return (
    <Link
      to="/modules/roadmap/$roadmapId"
      params={{ roadmapId: roadmap.id }}
      className="tt-surface block p-6 transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-wrap items-center gap-2">
        <MetaPill>{ROADMAP_STATUS_LABEL[roadmap.status]}</MetaPill>
        <MetaPill>{roadmap.subjectLabel}</MetaPill>
      </div>
      <h3 className="mt-3 font-display text-xl text-foreground">{roadmap.title}</h3>

      {roadmap.pointB ? (
        <div className="mt-4">
          <p className="tt-eyebrow">Point B</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <TierChip tier={roadmap.pointB.tier} />
          </div>
          <p className="mt-2 text-sm text-foreground">{roadmap.pointB.statement}</p>
        </div>
      ) : null}

      {roadmap.nextMove ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="tt-eyebrow">Next move</p>
          <p className="mt-1 text-sm text-foreground">{roadmap.nextMove.action}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Carried by {roadmap.nextMove.ownerLabel ?? "no one yet"}
          </p>
        </div>
      ) : null}
    </Link>
  );
}
