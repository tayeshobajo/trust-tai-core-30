/** Local-only fictional chrome fixture. No workspace identity or data client calls. */
import React from "react";
import { createRoot } from "react-dom/client";
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "../../src/components/tt/app-shell";
import {
  CommsTabs,
  CommsPageHeader,
  type CommsSection,
} from "../../src/components/tt/comms/comms-tabs";
import "../../src/styles.css";
import "../../src/components/tt/comms/comms-workspace.css";
const sections: Record<string, [CommsSection, string]> = {
  relationships: ["conversations", "Conversations"],
  integrations: ["integrations", "Accounts & Connections"],
  voice: ["voice", "How Tai sounds."],
  drafts: ["drafts", "Saved writing"],
  history: ["history", "Communication records"],
};
function Fixture() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [active, title] = sections[path.split("/").at(-1)!] ?? sections.relationships;
  return (
    <AppShell appearance="comms">
      <div className="comms-workspace comms-secondary-workspace">
        <div className="space-y-6">
          <CommsPageHeader
            title={title}
            supporting="Local visual fixture · fictional data · no reads, sends or live writes"
          />
          <CommsTabs active={active} />
          {active === "conversations" ? (
            <>
              <p className="text-xs text-muted-foreground">
                Gmail is limited to labelled threads and bounded sync passes. LinkedIn inbox
                coverage is not verified. Attention includes stored messages; it is not proof every
                mailbox message was captured.
              </p>
              <div className="comms-workspace-grid">
                <section className="comms-card p-5">
                  <h2>Inbox</h2>
                  <p>Example relationship</p>
                </section>
                <section className="comms-card p-5">
                  <h2>Example conversation</h2>
                  <p>Fictional message for layout review.</p>
                </section>
                <section className="comms-card p-5">
                  <h2>Relationship</h2>
                  <p>Needs attention</p>
                </section>
              </div>
            </>
          ) : (
            <section className="comms-card p-6">
              <h2>{title}</h2>
              <p className="mt-4">
                Existing records and functions remain on their original routes.
              </p>
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}
const root = createRootRoute({ component: Fixture });
const router = createRouter({
  history: createHashHistory(),
  routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: "$" })]),
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
