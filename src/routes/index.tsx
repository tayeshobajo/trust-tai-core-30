import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/tt/app-shell";
import { ContextPanel } from "@/components/tt/context-panel";
import { DecisionCard } from "@/components/tt/decision-card";
import { LockedWorkspace } from "@/components/tt/locked-workspace";
import {
  EmptyState,
  MetaPill,
  PageHeader,
  SectionHeading,
  StatusPill,
  TTButton,
  TTCard,
} from "@/components/tt/primitives";
import { memorySource } from "@/data/memory-source";
import { APP_REGISTRY } from "@/domain/registry";
import { resolveAccess } from "@/lib/auth-boundary";

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
  const access = resolveAccess();
  if (access.state !== "authenticated") {
    return (
      <LockedWorkspace
        reason={
          access.state === "unconfigured"
            ? access.reason
            : "You are signed out of Trust Tai."
        }
      />
    );
  }
  return (
    <AppShell>
      <Home organizationId={access.organizationId} />
    </AppShell>
  );
}

function Home({ organizationId }: { organizationId: string }) {
  const { data } = useQuery({
    queryKey: ["home", organizationId],
    queryFn: async () => {
      const [decisions, projects, users, activity, context] = await Promise.all([
        memorySource.decisions.list(organizationId),
        memorySource.projects.list(organizationId),
        memorySource.users.list(organizationId),
        memorySource.activity.list({ organizationId, limit: 4 }),
        memorySource.intelligence.retrieve({ organizationId, userId: "usr_tai" }),
      ]);
      return { decisions, projects, users, activity, context };
    },
  });

  const openDecisions = data?.decisions.filter((d) => d.status === "open") ?? [];
  const userById = (id?: string) => data?.users.find((u) => u.id === id);

  return (
    <div className="space-y-14">
      <PageHeader
        eyebrow="Trust Tai OS"
        title="One operating system for how Trust Tai works."
        supporting="A shared foundation for clients, projects, communication, operations, and intelligence."
      />

      {/* Needs your decision — always first */}
      <section aria-labelledby="decisions-heading">
        <SectionHeading
          eyebrow="Decision first"
          title="Needs your decision"
          description="Everything below this section is information. This section is judgement only you can give."
        />
        <div id="decisions-heading" className="grid gap-4 lg:grid-cols-2">
          {openDecisions.length > 0 ? (
            openDecisions.map((decision) => (
              <DecisionCard
                key={decision.id}
                decision={decision}
                owner={userById(decision.ownerUserId)}
                onResolve={(id, status) => memorySource.decisions.setStatus(id, status)}
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
              {(data?.activity ?? []).map((event) => (
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

      {/* The Trust Tai suite */}
      <section aria-labelledby="suite-heading">
        <SectionHeading
          eyebrow="Where we are going"
          title="The Trust Tai suite"
          description="One identity, one organisation, shared entities. Each app reads the same core data rather than keeping its own copy."
        />
        <ul id="suite-heading" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {APP_REGISTRY.map((app) => (
            <li key={app.id}>
              <Link
                to={app.route}
                className="block h-full rounded-xl border border-border bg-card p-5 transition-transform duration-200 hover:-translate-y-0.5"
              >
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
              </Link>
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
            <Link to="/modules/scout">Open Scout outline</Link>
          </TTButton>
        </TTCard>
      </section>
    </div>
  );
}
