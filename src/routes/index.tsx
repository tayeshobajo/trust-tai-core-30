import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck } from "lucide-react";

import { AppShell } from "@/components/tt/app-shell";
import { PersonalDashboard } from "@/components/tt/home/personal-dashboard";
import { memorySource } from "@/data/memory-source";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Your dashboard · Trust Tai OS";
const DESCRIPTION =
  "Your weekly goal, tasks, progress, AI teammate activity, and blockers in one operating view.";

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
    <WorkspaceGate appId="home">
      {(identity) => (
        <AppShell identity={identity} sidebar={<SystemStatus identity={identity} />}>
          <PersonalDashboard identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

/** Real state only: the shell can read the workspace, so it says so. */
function SystemStatus({ identity }: { identity: WorkspaceIdentity }) {
  const { isSuccess, isError } = useQuery({
    queryKey: ["home-status", identity.organizationId],
    queryFn: () =>
      memorySource.activity.list({ organizationId: identity.organizationId, limit: 1 }),
  });

  if (!isSuccess && !isError) return null;

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <CircleCheck
          className={isError ? "size-4 text-warning" : "size-4 text-success"}
          aria-hidden
        />
        {isError ? "Workspace unreachable" : "All systems operational"}
      </p>
    </div>
  );
}

