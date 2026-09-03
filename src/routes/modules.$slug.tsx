import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { EmptyState, MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import { getApp } from "@/domain/registry";
import { WorkspaceGate } from "@/components/tt/workspace-gate";

export const Route = createFileRoute("/modules/$slug")({
  loader: ({ params }) => {
    const app = getApp(params.slug);
    if (!app) throw notFound();
    return { app };
  },
  head: ({ loaderData }) => {
    const title = loaderData ? `${loaderData.app.name} · Trust Tai OS` : "Module, Trust Tai OS";
    const description = loaderData?.app.description ?? "A Trust Tai OS module outline.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: ModuleRoute,
});

function ModuleRoute() {
  const { app } = Route.useLoaderData();
  const external = app.status === "external";

  return (
    <WorkspaceGate appId={app.id}>
      {(identity) => (
        <AppShell identity={identity}>
          <div className="space-y-12">
            <AppHero
              appId={app.id}
              eyebrow={`Trust Tai OS / ${app.name}`}
              title={app.description}
              supporting={
                external
                  ? "Ops already exists as its own maintenance product. Trust Tai OS links to it rather than rebuilding it."
                  : "This module is mapped, not built. The shell, entities, and contracts it will use already exist."
              }
            />

            <section>
              <SectionHeading eyebrow="Contract" title="What this app will share" />
              <div className="flex flex-wrap gap-2">
                {app.capabilities.map((capability) => (
                  <MetaPill key={capability}>{capability}</MetaPill>
                ))}
                <MetaPill>route {app.route}</MetaPill>
                <MetaPill>status {app.status.replace("_", " ")}</MetaPill>
              </div>
            </section>

            <section>
              <EmptyState
                title={external ? "Ops runs outside this shell" : `${app.name} is not built yet`}
                belongsHere={
                  external
                    ? "Site health, maintenance tasks, and monitoring signals belong to the existing Ops product."
                    : `${app.name} will read shared clients, projects, and activity from the Trust Tai core, it will not keep its own copies.`
                }
                whyItMatters={
                  external
                    ? "Ops already writes into the shared activity contract, so its signals surface on Home."
                    : "Building on the shared foundation keeps one truth across the suite."
                }
                action={
                  <TTButton asChild variant="secondary">
                    <Link to="/">Back to Home</Link>
                  </TTButton>
                }
              />
            </section>
          </div>
        </AppShell>
      )}
    </WorkspaceGate>
  );
}
