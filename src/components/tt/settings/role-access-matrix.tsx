/**
 * Per-role room access. Owners and admins decide, role by role, which rooms a
 * role can see and how far it may act inside them.
 *
 * Two laws hold: a grant can never exceed what the role's permissions already
 * carry, and a per-person override still wins over the role default here.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { SectionHeading } from "@/components/tt/primitives";
import {
  readRoleAppAccess,
  setRoleAppAccess,
} from "@/data/supabase/settings-service";
import { ROLE_LABEL, type WorkspaceRole } from "@/domain/access";
import { APP_ACCESS_DESCRIPTION, APP_ACCESS_LABEL } from "@/domain/app-access";
import { roleAccessFor, selectableLevels } from "@/domain/role-access";
import { APP_REGISTRY } from "@/domain/registry";
import { MEMBERSHIP_ROLES } from "@/data/supabase/schema";

import { InfoTip, NotProvisioned, TTSelect } from "./pieces";

const ROLES = MEMBERSHIP_ROLES as readonly WorkspaceRole[];

export function RoleAccessMatrix({
  organizationId,
  actorUserId,
  canManage,
  orgEnabled,
}: {
  organizationId: string;
  actorUserId: string;
  canManage: boolean;
  orgEnabled: Record<string, boolean>;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState<string | null>(null);

  const roleAccess = useQuery({
    queryKey: ["settings", "role-access", organizationId],
    queryFn: () => readRoleAppAccess(organizationId),
  });

  const change = useMutation({
    mutationFn: (input: {
      role: WorkspaceRole;
      appId: string;
      appName: string;
      level: ReturnType<typeof roleAccessFor>;
    }) =>
      setRoleAppAccess({
        organizationId,
        role: input.role,
        appId: input.appId,
        appName: input.appName,
        level: input.level,
        actorUserId,
      }),
    onSuccess: (_result, input) => {
      setNote(
        `${ROLE_LABEL[input.role]} access to ${input.appName} is now ${APP_ACCESS_LABEL[input.level]}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const map = roleAccess.data?.value ?? {};

  return (
    <div className="tt-surface p-6">
      <SectionHeading
        eyebrow="Workspace"
        title="Role permissions"
        description="Grant or revoke individual rooms for a whole role. A role can never be given more than its permissions already carry, and a person's own override still wins."
      />

      {roleAccess.data?.provisioned === false ? (
        <NotProvisioned what="Role permissions" file="docs/settings-schema.sql" />
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/50">
              <th className="tt-eyebrow px-4 py-2 font-normal">Room</th>
              {ROLES.map((role) => (
                <th key={role} className="tt-eyebrow px-4 py-2 font-normal">
                  {ROLE_LABEL[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {APP_REGISTRY.map((app) => {
              const enabled = orgEnabled[app.id] !== false;
              return (
                <tr key={app.id}>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-foreground">
                      {app.name}
                      <InfoTip label={`About ${app.name}`}>
                        {enabled
                          ? "Set how far each role may go in this room."
                          : "This room is switched off for the organization, so nobody enters it whatever a role says."}
                      </InfoTip>
                    </span>
                  </td>
                  {ROLES.map((role) => {
                    const options = selectableLevels(role, app.id);
                    const level = roleAccessFor(role, app.id, map);
                    const locked =
                      !canManage ||
                      !enabled ||
                      options.length <= 1 ||
                      roleAccess.data?.provisioned === false;
                    return (
                      <td key={role} className="px-4 py-3">
                        {locked ? (
                          <span className="text-[13px] text-muted-foreground">
                            {APP_ACCESS_LABEL[level]}
                          </span>
                        ) : (
                          <TTSelect
                            className="h-9 w-28"
                            aria-label={`${ROLE_LABEL[role]} access to ${app.name}`}
                            value={level}
                            onChange={(event) =>
                              change.mutate({
                                role,
                                appId: app.id,
                                appName: app.name,
                                level: event.target
                                  .value as ReturnType<typeof roleAccessFor>,
                              })
                            }
                          >
                            {options.map((option) => (
                              <option key={option} value={option} title={APP_ACCESS_DESCRIPTION[option]}>
                                {APP_ACCESS_LABEL[option]}
                              </option>
                            ))}
                          </TTSelect>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {change.error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {(change.error as Error).message}
        </p>
      ) : note ? (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}
