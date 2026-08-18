import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { SectionHeading } from "@/components/tt/primitives";
import { NotProvisioned, Toggle } from "@/components/tt/settings/pieces";
import { useSettingsIdentity } from "@/components/tt/settings/shell";
import {
  listMembers,
  readOrganizationApps,
  setOrganizationApp,
} from "@/data/supabase/settings-service";
import { resolveAppAccess } from "@/domain/app-access";
import { APP_REGISTRY } from "@/domain/registry";

export const Route = createFileRoute("/settings/apps")({
  component: AppsSettings,
});

function AppsSettings() {
  const identity = useSettingsIdentity();
  const queryClient = useQueryClient();

  const apps = useQuery({
    queryKey: ["settings", "org-apps", identity.organizationId],
    queryFn: () => readOrganizationApps(identity.organizationId),
  });
  const members = useQuery({
    queryKey: ["settings", "members", identity.organizationId],
    queryFn: () => listMembers(identity.organizationId),
  });

  const toggle = useMutation({
    mutationFn: async (input: { appId: string; appName: string; enabled: boolean }) =>
      setOrganizationApp({
        organizationId: identity.organizationId,
        actorUserId: identity.userId,
        ...input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "org-apps"] });
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const enabled = apps.data?.value ?? {};
  const provisioned = apps.data?.provisioned ?? false;

  function peopleWithAccess(appId: string): number {
    return (members.data ?? []).filter(
      (member) =>
        resolveAppAccess(appId, {
          role: member.role,
          membershipActive: member.status === "active",
          organizationEnabled: enabled[appId] !== false,
          override: member.access[appId],
        }).visible,
    ).length;
  }

  return (
    <div className="tt-surface p-6">
      <SectionHeading
        eyebrow="Workspace"
        title="Apps"
        description="Turn a room on or off for the whole organization. A disabled room disappears from everyone's navigation, whatever their role."
      />

      {provisioned ? null : (
        <div className="mb-5">
          <NotProvisioned what="Organization app settings" file="docs/settings-schema.sql" />
        </div>
      )}

      <div className="divide-y divide-border rounded-xl border border-border">
        {APP_REGISTRY.map((app) => {
          const on = enabled[app.id] !== false;
          return (
            <div key={app.id} className="flex flex-wrap items-center gap-4 px-4 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{app.name}</p>
                <p className="mt-0.5 max-w-reading text-xs text-muted-foreground">
                  {app.description}
                </p>
              </div>
              <p className="w-32 shrink-0 text-xs text-muted-foreground">
                {members.isPending ? "…" : `${peopleWithAccess(app.id)} with access`}
              </p>
              <Link
                to="/settings/people"
                className="shrink-0 text-[13px] text-royal hover:underline"
              >
                Manage access
              </Link>
              <Toggle
                label={`${app.name} enabled for the organization`}
                checked={on}
                disabled={!provisioned || !identity.canManage || toggle.isPending}
                onChange={(next) =>
                  toggle.mutate({ appId: app.id, appName: app.name, enabled: next })
                }
              />
            </div>
          );
        })}
      </div>

      {identity.canManage ? null : (
        <p className="mt-4 text-xs text-muted-foreground">
          Only owners and admins can change organization-level application state.
        </p>
      )}
      {toggle.error ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {(toggle.error as Error).message}
        </p>
      ) : null}
    </div>
  );
}
