import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppArtwork } from "@/components/tt/app-artwork";
import { AppHero } from "@/components/tt/app-hero";
import { AppLink } from "@/components/tt/app-link";
import { AppShell } from "@/components/tt/app-shell";
import { ContextPanel } from "@/components/tt/context-panel";
import { DecisionCard } from "@/components/tt/decision-card";
import { IntelligenceConsole } from "@/components/tt/intelligence-console";
import { JourneySpine, type SpineStage } from "@/components/tt/journey-spine";
import { TodayPanel } from "@/components/tt/today-panel";
import {
  EmptyState,
  MetaPill,
  SectionHeading,
  StatusPill,
  TTButton,
  TTCard,
} from "@/components/tt/primitives";
import { memorySource } from "@/data/memory-source";
import { getAppTheme } from "@/domain/app-theme";
import { APP_REGISTRY } from "@/domain/registry";
import { useLastVisit } from "@/hooks/use-last-visit";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Trust Tai OS — one operating system for how Trust Tai works";
const DESCRIPTION =
  "The shared foundation for Trust Tai internal apps: one identity, shared core entities, an app registry, and a common activity and intelligence contract.";

export const Route = createFileRoute("/")({
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
  component: HomeRoute,
});

function HomeRoute() {
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <Home identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function Home({ identity }: { identity: WorkspaceIdentity }) {
  const { organizationId, userId } = identity;
  const { data } = useQuery({
    queryKey: ["home", organizationId, userId],
    queryFn: async () => {
      const [decisions, projects, users, activity, context] = await Promise.all([
        memorySource.decisions.list(organizationId),
        memorySource.projects.list(organizationId),
        memorySource.users.list(organizationId),
        memorySource.activity.list({ organizationId, limit: 6 }),
        memorySource.intelligence.retrieve({ organizationId, userId }),
      ]);
      return { decisions, projects, users, activity, context };
    },
  });

  const { lastVisit, ready } = useLastVisit();
  const [resolvedCount, setResolvedCount] = useState(0);

  const decisions = data?.decisions ?? [];
  const openDecisions = decisions.filter((d) => d.status === "open");
  const userById = (id?: string) => data?.users.find((u) => u.id === id);
  const firstName = identity.firstName;

  const newSignals = useMemo(() => {
    const events = data?.activity ?? [];
    if (!ready) return [];
    if (!lastVisit) return events.slice(0, 3);
    return events.filter((event) => event.occurredAt > lastVisit);
  }, [data?.activity, lastVisit, ready]);

  const leadDecision = openDecisions[0];
  const attention =
    openDecisions.length > 0
      ? `${openDecisions.length} decision${openDecisions.length === 1 ? " is" : "s are"} waiting on your judgement.`
      : "Nothing is waiting on your judgement today.";
  const nextMove =
    leadDecision?.title ??
    data?.projects.find((p) => p.nextMove)?.nextMove ??
    "Keep going — the work is moving without you.";

  const stages: SpineStage[] = [
    {
      label: "Signal",
      detail: "Ops and Projects are writing into one shared activity stream.",
      state: "done",
    },
    {
      label: "Decision",
      detail:
        openDecisions.length > 0
          ? `${openDecisions.length} open, carried by you.`
          : "All caught up.",
      state: openDecisions.length > 0 ? "current" : "done",
    },
    {
      label: "Action",
      detail: "Approved decisions release the next build order.",
      state: openDecisions.length > 0 ? "ahead" : "current",
    },
    {
      label: "Outcome",
      detail: "Northbank launch, tracked enquiries, a steward on every client.",
      state: "ahead",
    },
  ];

  return (
    <div className="space-y-14">
      <AppHero
        appId="home"
        eyebrow="Trust Tai OS"
        greeting={firstName ? `Welcome, ${firstName}` : undefined}
        title="One operating system for how Trust Tai works."
        supporting="A shared foundation for clients, projects, communication, operations, and intelligence."
      />

      <TodayPanel
        changedCount={newSignals.length}
        attention={attention}
        nextMove={nextMove}
        nextMoveInferred={Boolean(leadDecision)}
        newSignals={newSignals}
        action={
          leadDecision ? (
            <TTButton asChild variant="signal">
              <a href="#decisions-heading">Make the decision that is waiting</a>
            </TTButton>
          ) : undefined
        }
      />

      <IntelligenceConsole organizationId={organizationId} />

      {/* Needs your decision — always first */}
      <section aria-labelledby="decisions-heading">
        <SectionHeading
          eyebrow="Decision first"
          title="Needs your decision"
          description="Everything below this section is information. This section is judgement only you can give."
        />
        <div id="decisions-heading" className="grid gap-4 lg:grid-cols-2">
          {decisions.length > 0 ? (
            decisions.map((decision) => (
              <DecisionCard
                key={decision.id}
                decision={decision}
                owner={userById(decision.ownerUserId)}
                unlocks={
                  decision.projectId
                    ? "This releases the next build order for that project."
                    : "This gives the work a named owner, so signals stop sitting unread."
                }
                onResolve={(id, status) => {
                  memorySource.decisions.setStatus(id, status);
                  setResolvedCount((n) => n + 1);
                }}
              />
            ))
          ) : (
            <EmptyState
              title="Nothing is waiting on you"
              belongsHere="Decisions raised by any Trust Tai app appear here."
              whyItMatters="When this is empty, work is moving without needing you."
            />
          )}
        </div>
        {resolvedCount > 0 ? (
          <p className="tt-rise mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {resolvedCount} decision{resolvedCount === 1 ? "" : "s"} handled this visit
          </p>
        ) : null}
      </section>

      {/* Progression spine */}
      <section aria-labelledby="spine-heading">
        <SectionHeading
          eyebrow="Where this is going"
          title="Signal → Decision → Action → Outcome"
          description="One spine across the suite, so you always know whether you are looking at history, current work, or something still ahead."
        />
        <div id="spine-heading">
          <JourneySpine stages={stages} />
        </div>
      </section>

      {/* What is active now + context */}
      <section aria-labelledby="active-heading" className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div>
          <SectionHeading
            eyebrow="Current truth"
            title="What is active now"
            description="Live work across the organisation, with the person who carries it."
          />
          <ul id="active-heading" className="space-y-3">
            {(data?.projects ?? []).map((project) => (
              <li key={project.id}>
                <TTCard className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-base font-semibold text-foreground">{project.name}</h3>
                    <StatusPill status={project.status} />
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {project.pointA} → {project.pointB}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <MetaPill>Carried by {userById(project.ownerUserId)?.name ?? "Unassigned"}</MetaPill>
                    {project.nextMove ? <MetaPill>Next: {project.nextMove}</MetaPill> : null}
                  </div>
                </TTCard>
              </li>
            ))}
          </ul>

          <div className="mt-6 border-t border-border pt-5">
            <p className="tt-eyebrow mb-3">Recent signals</p>
            <ul className="space-y-2">
              {(data?.activity ?? []).slice(0, 4).map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {event.name}
                  </span>
                  <span className="text-foreground">{event.summary}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    via {event.provenance.appId}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {data?.context ? <ContextPanel result={data.context} /> : null}
      </section>

      {/* The Trust Tai suite — rooms in one world */}
      <section aria-labelledby="suite-heading">
        <SectionHeading
          eyebrow="The world"
          title="Rooms in one Trust Tai world"
          description="Each app is a room with its own character, reading the same core data. Step into one to see what it holds."
        />
        <ul id="suite-heading" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {APP_REGISTRY.map((app) => (
            <li key={app.id}>
              <AppLink
                app={app}
                className="group block h-full overflow-hidden rounded-xl border border-border bg-card transition-transform duration-200 hover:-translate-y-1"
              >
                <div
                  className="relative h-24 border-b border-border sm:h-28"
                  style={{
                    backgroundColor: `color-mix(in oklab, ${getAppTheme(app.id).tint} 5%, var(--card))`,
                  }}
                >
                  <AppArtwork
                    appId={app.id}
                    className="absolute inset-0"
                    motifClassName="opacity-60"
                  />
                </div>
                <div className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-foreground">{app.name}</span>
                    <StatusPill
                      status={
                        app.status === "live"
                          ? "live"
                          : app.status === "in_build"
                            ? "in_build"
                            : app.status === "external"
                              ? "live"
                              : "mapped"
                      }
                    />
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{app.description}</p>
                  <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground transition-colors group-hover:text-royal">
                    Enter {app.name} →
                  </p>
                </div>
              </AppLink>
            </li>
          ))}
        </ul>
      </section>

      {/* Next move */}
      <section aria-labelledby="next-heading">
        <SectionHeading eyebrow="Next move" title="What happens next" />
        <TTCard id="next-heading" className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-reading text-sm text-muted-foreground">
            Connect the shared Trust Tai backend so identity, clients, projects, and activity are
            real. Build Scout first — everything downstream depends on qualified clients.
          </p>
          <TTButton asChild variant="signal">
            <Link to="/modules/$slug" params={{ slug: "scout" }}>Open Scout outline</Link>
          </TTButton>
        </TTCard>
      </section>
    </div>
  );
}
