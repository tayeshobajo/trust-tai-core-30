/**
 * Steward, a teammate's dashboard (team scope, status only).
 *
 * The same per-person dashboard a viewer sees for themselves, rendered for
 * someone else with the team boundary enforced by one derivation: scope is
 * "team" whenever the viewer is not looking at their own userId. Team scope
 * never shows a task title and offers no action, confirm, checkbox or undo.
 */

import { createFileRoute, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/tt/app-shell";
import { PersonDashboard } from "@/components/tt/steward/dashboard/person-dashboard";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { readStewardDashboard } from "@/data/steward/dashboard-read";
import { listMembers } from "@/data/supabase/settings-service";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward · Teammate dashboard · Trust Tai OS";
const DESCRIPTION = "A teammate's week, status only: counts, not titles or actions.";

export const Route = createFileRoute("/modules/steward/people/$userId")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PersonRoute,
});

function PersonRoute() {
  const { userId } = Route.useParams();
  return (
    <WorkspaceGate appId="steward">
      {(identity) => (
        <AppShell identity={identity}>
          <TeammateDashboard identity={identity} targetUserId={userId} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function TeammateDashboard({
  identity,
  targetUserId,
}: {
  identity: WorkspaceIdentity;
  targetUserId: string;
}) {
  /* Self viewing their own people/:userId link lands on the same dashboard
     they see at Home; the scope derivation below
     still gives them full self detail, never a status-only view of themselves. */
  const scope = targetUserId === identity.userId ? "self" : "team";

  const members = useQuery({
    queryKey: ["steward", "members", identity.organizationId],
    queryFn: () => listMembers(identity.organizationId),
  });

  const target = members.data?.find((member) => member.userId === targetUserId) ?? null;

  const read = useQuery({
    queryKey: ["steward", "dashboard", identity.organizationId, targetUserId],
    queryFn: () =>
      readStewardDashboard(
        identity.organizationId,
        targetUserId,
        target?.name ?? "Teammate",
        target?.jobTitle ?? null,
      ),
    enabled: members.isSuccess,
  });

  if (members.isSuccess && !target) {
    throw notFound();
  }

  if (read.isError) {
    return (
      <div className="space-y-8">
        <StewardTabs active="team" />
        <StewardUnavailable error={read.error} />
      </div>
    );
  }

  if (!read.data) {
    return (
      <div className="space-y-8">
        <StewardTabs active="team" />
        <p className="text-sm text-muted-foreground">Loading this teammate's dashboard.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <StewardTabs active="team" />
      <PersonDashboard
        read={read.data}
        scope={scope}
        tasksHref="/modules/steward/tasks"
        activityHref="/modules/activity"
        onCompleteTask={() => {}}
        onConfirmGoal={() => {}}
        confirmingGoal={false}
        onUndoActivity={() => {}}
      />
    </div>
  );
}
