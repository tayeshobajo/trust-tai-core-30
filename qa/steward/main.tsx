import type { StewardUpdate, StewardUpdateInput } from "@/data/supabase/steward-updates";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { AppShell } from "@/components/tt/app-shell";
import { ApprovedMeetings } from "@/components/tt/steward/approved-meetings";
import { buildWorkroom } from "@/domain/steward-workroom";
import type { Commitment } from "@/domain/steward";
import type { WorkspaceIdentity } from "@/lib/workspace";
import "@/styles.css";
// Isolated browser fixture. No app route, real task read, or production writes.
const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];
const meetings = ids.map((id, i) => ({
  id,
  title: [
    "Delivery planning",
    "Website launch check-in",
    "Client onboarding review",
    "Research catch-up",
  ][i]!,
  occurredAt: `2026-10-${19 - i}T10:00:00Z`,
  provider: "manual",
  sourceUrl: "",
  participantCount: 0,
  segmentCount: 0,
  lastSegmentAt: null,
}));
const initial = meetings.flatMap((m, i) =>
  Array.from(
    { length: [12, 6, 5, 0][i] },
    (_, j) =>
      ({
        id: `${i + 5}0000000-0000-4000-8000-${String(j + 1).padStart(12, "0")}`,
        organizationId: ids[0],
        conversationId: m.id,
        status: j < [8, 3, 5, 0][i] ? "kept" : "open",
        what: [
          "Capture repeatable in-house delivery learnings",
          "Maintain complete decision coverage",
          "Prepare Trust Tai case-study evidence",
          "Resolve Content Engine experiment design",
        ][j % 4],
        evidence: [],
        sourceKey: `sample-${i}-${j}`,
        ownerName: "Sample editor",
        dueAt: j === 11 ? "2026-10-01" : undefined,
        createdAt: "2026-10-01",
        updatedAt: "2026-10-01",
      }) as Commitment,
  ),
);
const identity = {
  userId: ids[1],
  organizationId: ids[0],
  name: "Sample editor",
  email: "fixture@example.invalid",
  firstName: "Sample",
  organizationName: "Fictional review",
  organizationSlug: "fixture",
  avatarUrl: null,
  apps: ["home", "scout", "comms", "roadmap", "steward", "pulse"].map((appId) => ({
    appId,
    level: "work",
    visible: true,
    canWork: true,
    canManage: false,
    because: "Isolated test",
  })),
  role: "owner",
  canManage: true,
} as WorkspaceIdentity;
function Fixture() {
  const [commitments, setCommitments] = useState(initial);
  const [selection, setSelection] = useState(() => {
    const p = new URLSearchParams(location.search);
    return { meetingId: p.get("meeting"), rowKey: p.get("task") };
  });
  React.useEffect(() => {
    const pop = () => {
      const p = new URLSearchParams(location.search);
      setSelection({ meetingId: p.get("meeting"), rowKey: p.get("task") });
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const updates = {
    list: async (_org: string, id: string) =>
      JSON.parse(localStorage.getItem(`fixture-${id}`) || "[]"),
    post: async (input: StewardUpdateInput) => {
      await new Promise((r) => setTimeout(r, 150));
      const key = `fixture-${input.taskId}`;
      const old = JSON.parse(localStorage.getItem(key) || "[]");
      if (!old.some((e: StewardUpdate) => e.id === input.operationId)) {
        old.unshift({
          id: input.operationId,
          entity_id: input.taskId,
          actor_user_id: identity.userId,
          occurred_at: new Date().toISOString(),
          summary: "Fixture update",
          payload: {
            note: input.note,
            author_name: "Sample editor",
            action: input.action,
            later_date: input.laterDate,
            later_meeting_id: input.laterMeetingId,
          },
        });
        localStorage.setItem(key, JSON.stringify(old));
      }
    },
  };
  return (
    <>
      <div className="bg-blue-50 p-2 text-center text-xs">
        ISOLATED DESIGN TEST · FICTIONAL DATA · NO PRODUCTION CONNECTION
      </div>
      <AppShell identity={identity} canvas="workroom">
        <ApprovedMeetings
          identity={identity}
          meetings={buildWorkroom(
            meetings,
            commitments,
            undefined,
            new Map([
              [ids[0], 2],
              [ids[3], 3],
            ]),
          )}
          commitmentFor={(id) => commitments.find((c) => c.id === id)}
          receiptsFailed={false}
          sync={{
            running: false,
            failure: null,
            lastSuccessAt: null,
            added: 0,
            refreshed: 0,
            unchanged: 0,
            preserved: 0,
            warnings: [],
            pendingTranscript: 0,
            hasMore: false,
            onRetry: () => {},
          }}
          linkedRead={{ state: "ready", truncated: false }}
          headerMenu={null}
          accountSlot={null}
          canChange={() => true}
          onStatus={async (row, status) => {
            setCommitments((old) =>
              old.map((c) =>
                c.id === row.id ? { ...c, status: status as Commitment["status"] } : c,
              ),
            );
          }}
          selection={selection}
          onSelect={(meetingId, rowKey) => {
            setSelection({ meetingId, rowKey });
            const p = new URLSearchParams();
            if (meetingId) p.set("meeting", meetingId);
            if (rowKey) p.set("task", rowKey);
            history.pushState(null, "", `${location.pathname}?${p}`);
          }}
          updates={updates}
        />
      </AppShell>
    </>
  );
}
const route = createRootRoute({ component: Fixture });
const router = createRouter({ routeTree: route });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
