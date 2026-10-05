import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/tt/app-shell";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { BusinessTaskBoard } from "@/components/tt/steward/business-task-board";
export const Route = createFileRoute("/modules/steward/board")({
  validateSearch: (search: Record<string, unknown>): { scope?: "personal" | "business" } => ({
    ...(search["scope"] === "personal" ? { scope: "personal" as const } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Task board · Trust Tai OS" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: BoardRoute,
});
function BoardRoute() {
  const { scope = "business" } = Route.useSearch();
  return (
    <WorkspaceGate appId="steward">
      {(identity) => (
        <AppShell identity={identity}>
          <BusinessTaskBoard identity={identity} initialScope={scope} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}
