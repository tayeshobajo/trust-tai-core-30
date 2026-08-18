import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppWindow, Plug, User, Users } from "lucide-react";

import { SectionHeading, TTButton } from "@/components/tt/primitives";
import { SummaryCard } from "@/components/tt/settings/pieces";
import { useSettingsIdentity } from "@/components/tt/settings/shell";
import { listMembers, readOrganizationApps } from "@/data/supabase/settings-service";
import { readIntegrations } from "@/data/supabase/settings-integrations";
import { APP_REGISTRY } from "@/domain/registry";

export const Route = createFileRoute("/settings/")({
  component: SettingsOverview,
});

function SettingsOverview() {
  const identity = useSettingsIdentity();

  const members = useQuery({
    queryKey: ["settings", "members", identity.organizationId],
    queryFn: () => listMembers(identity.organizationId),
  });
  const apps = useQuery({
    queryKey: ["settings", "org-apps", identity.organizationId],
    queryFn: () => readOrganizationApps(identity.organizationId),
  });
  const integrations = useQuery({
    queryKey: ["settings", "integrations", identity.organizationId],
    queryFn: () => readIntegrations(identity.organizationId),
  });

  const activeMembers = (members.data ?? []).filter((m) => m.status === "active").length;
  const enabledApps = APP_REGISTRY.filter(
    (app) => (apps.data?.value ?? {})[app.id] !== false,
  ).length;
  const connected = (integrations.data ?? []).filter((i) => i.health === "connected").length;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Your profile"
          value={identity.name}
          supporting={identity.email}
          icon={<User className="size-[18px]" aria-hidden />}
        />
        <SummaryCard
          label="People"
          value={members.isPending ? "…" : `${activeMembers} active`}
          supporting={
            members.isPending ? "Reading membership" : `${members.data?.length ?? 0} in total`
          }
          icon={<Users className="size-[18px]" aria-hidden />}
        />
        <SummaryCard
          label="Applications"
          value={apps.isPending ? "…" : `${enabledApps} enabled`}
          supporting={`${APP_REGISTRY.length} registered`}
          icon={<AppWindow className="size-[18px]" aria-hidden />}
        />
        <SummaryCard
          label="Connections"
          value={integrations.isPending ? "…" : `${connected} connected`}
          supporting={
            integrations.isPending
              ? "Checking health"
              : `${(integrations.data ?? []).length} represented`
          }
          icon={<Plug className="size-[18px]" aria-hidden />}
        />
      </div>

      <div className="tt-surface p-6">
        <SectionHeading
          title="Start where the question is"
          description="Settings stays simple on the surface. Detail opens only when you need it."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { to: "/settings/profile", title: "My profile", note: "How you appear across the OS." },
            {
              to: "/settings/people",
              title: "People & access",
              note: "Invite, set roles, decide which rooms each person sees.",
            },
            {
              to: "/settings/apps",
              title: "Apps",
              note: "Turn a room on or off for the whole organization.",
            },
            {
              to: "/settings/integrations",
              title: "Integrations",
              note: "Real health for the systems the suite depends on.",
            },
          ].map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-xl border border-border p-4 transition-colors hover:bg-secondary"
            >
              <p className="text-sm font-medium text-foreground">{item.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>
            </Link>
          ))}
        </div>
        {identity.canManage ? null : (
          <p className="mt-5 text-xs text-muted-foreground">
            You can read the workspace settings. Changing people, roles and application access is
            reserved for owners and admins.
          </p>
        )}
        <div className="mt-6">
          <TTButton asChild variant="secondary" size="sm">
            <Link to="/modules/activity" search={{ view: "today", page: 1 }}>
              View recent workspace activity
            </Link>
          </TTButton>
        </div>
      </div>
    </>
  );
}
