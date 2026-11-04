import React, { useState } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "@/components/tt/app-shell";
import { CommsTabs } from "@/components/tt/comms/comms-tabs";
import { APP_REGISTRY } from "@/domain/registry";
import { createRoot } from "react-dom/client";
import { CommsInbox } from "@/components/tt/comms/comms-inbox";
import { ConversationRoom } from "@/components/tt/comms/conversation-room";
import { RelationshipSummary } from "@/components/tt/comms/relationship-summary";
import { ReplyRecordBar } from "@/components/tt/comms/reply-record";
import { inboxEntries, inboxView, inboxPage } from "@/data/comms-inbox";
import "@/styles.css";
import "@/components/tt/comms/comms-workspace.css";
const relationships = Array.from({ length: 6 }, (_, i) => ({
  id: `test-${i}`,
  organizationId: "preview-only",
  fullName: [
    "Example Client",
    "Example Partner",
    "Example Colleague",
    "Example Team",
    "Example Contact",
    "Example Studio",
  ][i],
  companyName: "Local preview · test data",
  email: `example${i}@example.test`,
  stage: "client",
  source: "manual",
  observed: [],
  inferred: [],
  decided: [],
  metadata: {},
  nextAction: "Confirm a time for the next conversation.",
  followUpDueAt: "2026-11-04T10:00:00Z",
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-03T10:00:00Z",
  lastTouchAt: "2026-11-03T10:00:00Z",
}));
const entries = inboxEntries(
  relationships as Parameters<typeof inboxEntries>[0],
  {},
  new Date("2026-11-04T10:00:00Z"),
);
function Preview() {
  const [selected, setSelected] = useState(0),
    [room, setRoom] = useState(false),
    [query, setQuery] = useState(""),
    [tab, setTab] = useState<React.ComponentProps<typeof CommsInbox>["tab"]>("all"),
    [health, setHealth] = useState<React.ComponentProps<typeof CommsInbox>["health"]>(null),
    [reply, setReply] = useState(""),
    [register, setRegister] =
      useState<React.ComponentProps<typeof ReplyRecordBar>["register"]>("follow_up"),
    [notice, setNotice] = useState("");
  const view = inboxView(entries, { tab, query, health, now: new Date("2026-11-04T10:00:00Z") });
  const entry = entries[selected]!;
  const days = [
    {
      key: "2026-11-03",
      label: "Nov 3, 2026",
      events: [
        {
          id: "sample-1",
          kind: "they_texted",
          title: "Planning our next conversation",
          body: "Could we find a time to review the next steps together? This is local test content.",
          occurredAt: "2026-11-03T09:18:00Z",
        },
        {
          id: "sample-2",
          kind: "i_texted",
          title: "Next steps",
          body: "Absolutely. I will share a few times that work for our team. This preview does not connect to a live account.",
          occurredAt: "2026-11-03T09:58:00Z",
        },
      ],
    },
  ];
  return (
    <>
      <p style={{ margin: 0, padding: 8, background: "#fff6df", fontSize: 12 }}>
        LOCAL COMPONENT PREVIEW · TEST DATA ONLY · No messages or records are sent or saved.
      </p>
      <AppShell
        appearance="comms"
        identity={
          {
            userId: "",
            organizationId: "",
            name: "Preview user",
            firstName: "Preview",
            email: "preview@example.test",
            organizationName: "LOCAL PREVIEW",
            organizationSlug: "preview",
            role: "preview",
            canManage: false,
            avatarUrl: null,
            apps: APP_REGISTRY.map((app) => ({ appId: app.id, canSee: true, canWork: false })),
          } as unknown as React.ComponentProps<typeof AppShell>["identity"]
        }
      >
        <div className="comms-workspace">
          <header className="comms-workspace-hero">
            <p className="tt-eyebrow">Comms</p>
            <h1>Conversations</h1>
            <p>
              All client communication in one place. Stay responsive, keep momentum, and never miss
              a follow-up.
            </p>
          </header>
          <div className="comms-workspace-navigation">
            <CommsTabs active="conversations" workspace />
          </div>
          <div className="comms-workspace-grid">
            <aside
              className={`comms-card comms-inbox-pane overflow-hidden p-0 lg:block ${room ? "hidden" : ""}`}
            >
              <CommsInbox
                compact
                view={view}
                page={inboxPage(view, 1)}
                onPage={() => {}}
                tab={tab}
                onTab={setTab}
                query={query}
                onQuery={setQuery}
                health={health}
                onHealth={setHealth}
                selectedId={entry.relationship.id}
                onSelect={(id) => {
                  setSelected(entries.findIndex((x) => x.relationship.id === id));
                  setRoom(true);
                }}
                empty={false}
              />
            </aside>
            <section
              className={`comms-card comms-room-pane flex-col overflow-hidden p-0 lg:flex ${room ? "flex" : "hidden"}`}
            >
              <ConversationRoom
                relationship={entry.relationship}
                health={entry.health}
                days={days as React.ComponentProps<typeof ConversationRoom>["days"]}
                onBack={() => setRoom(false)}
                onViewProfile={() => setNotice("Profile action called")}
                onOpenContext={() => setNotice("Context action called")}
                onAddInteraction={() => setNotice("Interaction action called")}
              >
                <ReplyRecordBar
                  compact
                  drafting={false}
                  busy={false}
                  value={reply}
                  onValueChange={setReply}
                  register={register}
                  onRegisterChange={setRegister}
                  onPrepareDraft={() => setNotice("Preview only: no draft created")}
                  onSaveWriting={async () => {
                    setNotice("Preview only: text kept, no record saved");
                    return false;
                  }}
                  onRecordInteraction={() => setNotice("Interaction action called")}
                />
              </ConversationRoom>
            </section>
            <aside className={`comms-summary-pane ${room ? "" : "hidden lg:block"}`}>
              <RelationshipSummary
                relationship={entry.relationship}
                health={entry.health}
                onContext={() => setNotice("Context action called")}
                onProfile={() => setNotice("Profile action called")}
                onInteraction={() => setNotice("Interaction action called")}
              />
            </aside>
          </div>
          <p role="status">{notice}</p>
        </div>
      </AppShell>
    </>
  );
}
const rootRoute = createRootRoute();
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/modules/comms/relationships",
  component: Preview,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([route]),
  history: createMemoryHistory({ initialEntries: ["/modules/comms/relationships"] }),
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
