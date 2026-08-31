/**
 * Trust Tai OS, real auth + workspace boundary.
 *
 * Fails closed. Nothing about the workspace is rendered until:
 *  1. Supabase Auth confirms a session, and
 *  2. an organization membership is read back through RLS.
 *
 * Membership is never created here. If an authenticated person has no
 * membership row, the shell shows a calm "access not provisioned" state.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { accessContext, type AccessContext } from "@/domain/access";
import { visibleApps, type AppAccessDecision } from "@/domain/app-access";
import { readMemberAccess, readOrganizationApps } from "@/data/supabase/settings-service";
import { clearRoomAuthority, setRoomAuthority } from "@/lib/room-authority";
import { supabase } from "@/integrations/trust-tai/supabase";
import {
  ADMIN_ROLES,
  type MembershipRow,
  type OrganizationRow,
  type ProfileRow,
} from "@/data/supabase/schema";

export interface WorkspaceIdentity {
  userId: string;
  email: string;
  name: string;
  firstName: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: string;
  /** Owner/admin members may change organization-level intelligence. */
  canManage: boolean;
  /** Profile photo, when the person has set one. */
  avatarUrl: string | null;
  /**
   * Every room this person may actually see, already resolved against the
   * organization's app switches, their per-app overrides and their role.
   * The shell navigation reads only this. Fails closed by construction.
   */
  apps: AppAccessDecision[];
}

/** May this person see this room? Unknown room, unknown access: no. */
export function canSeeApp(identity: WorkspaceIdentity, appId: string): boolean {
  return identity.apps.some((app) => app.appId === appId);
}

/** May this person work in this room? */
export function canWorkIn(identity: WorkspaceIdentity, appId: string): boolean {
  return identity.apps.some((app) => app.appId === appId && app.canWork);
}

export type WorkspaceState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "no_membership"; email: string }
  | { status: "error"; message: string }
  | { status: "ready"; identity: WorkspaceIdentity };

const SessionContext = createContext<{ session: Session | null; loading: boolean }>({
  session: null,
  loading: true,
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;

    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void queryClient.invalidateQueries({ queryKey: ["workspace"] });
      }
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [queryClient]);

  return (
    <SessionContext.Provider value={{ session, loading }}>{children}</SessionContext.Provider>
  );
}

function displayName(profile: ProfileRow | null, email: string): string {
  const candidate =
    profile?.full_name ?? profile?.display_name ?? profile?.name ?? email.split("@")[0] ?? "there";
  return String(candidate).trim();
}

function activeMembership(rows: MembershipRow[]): MembershipRow | null {
  const usable = rows.filter((row) => !row.status || row.status === "active");
  return usable[0] ?? rows[0] ?? null;
}

/** The workspace boundary. Every product surface reads access from here. */
export function useWorkspace(): WorkspaceState {
  const { session, loading } = useContext(SessionContext);
  const userId = session?.user?.id;
  const email = session?.user?.email ?? "";

  const query = useQuery({
    queryKey: ["workspace", userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<WorkspaceState> => {
      if (!userId) return { status: "signed_out" };

      const memberships = await supabase
        .from("organization_memberships")
        .select("*")
        .eq("user_id", userId);
      if (memberships.error) {
        return { status: "error", message: memberships.error.message };
      }

      const membership = activeMembership((memberships.data ?? []) as MembershipRow[]);
      if (!membership) return { status: "no_membership", email };

      const [profileResult, orgResult] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        supabase
          .from("organizations")
          .select("*")
          .eq("id", membership.organization_id)
          .maybeSingle(),
      ]);

      const profile = (profileResult.data ?? null) as ProfileRow | null;
      const organization = (orgResult.data ?? null) as OrganizationRow | null;
      if (!organization) return { status: "no_membership", email };

      const name = displayName(profile, email);
      const role = membership.role ?? "member";
      const membershipActive = !membership.status || membership.status === "active";

      /* App switches, role defaults and per-person overrides are optional
         persistence: until the Settings tables exist, role templates alone
         decide visibility. A person's own override always wins over the
         role-level default beneath it. */
      const [organizationApps, memberAccess, roleAccess] = await Promise.all([
        readOrganizationApps(organization.id).catch(() => ({ provisioned: false, value: {} })),
        readMemberAccess(organization.id).catch(() => ({ provisioned: false, value: {} })),
        readRoleAppAccess(organization.id).catch(() => ({ provisioned: false, value: {} })),
      ]);

      const apps = visibleApps({
        role,
        membershipActive,
        organization: { enabled: organizationApps.value },
        overrides: effectiveOverrides({
          role,
          appIds: APP_REGISTRY.map((app) => app.id),
          roleAccess: roleAccess.value as RoleAccessMap,
          memberAccess: (memberAccess.value as Record<string, Record<string, AppAccessLevel>>)[
            userId
          ],
        }),
      });


      /* Publish authority once, so room services can refuse a write that this
         person's access does not carry. Visibility alone is not authority. */
      setRoomAuthority(apps);


      return {
        status: "ready",
        identity: {
          userId,
          email,
          name,
          firstName: name.split(/\s+/)[0] ?? name,
          organizationId: organization.id,
          organizationName: organization.name,
          organizationSlug: organization.slug,
          role,
          canManage: ADMIN_ROLES.includes(role),
          avatarUrl: profile?.avatar_url ?? null,
          apps,
        },
      };
    },
  });

  if (loading) return { status: "loading" };
  if (!userId) return { status: "signed_out" };
  if (query.isPending) return { status: "loading" };
  if (query.error) return { status: "error", message: (query.error as Error).message };
  return query.data ?? { status: "loading" };
}

export async function signOut(queryClient: ReturnType<typeof useQueryClient>) {
  clearRoomAuthority();
  await queryClient.cancelQueries();
  queryClient.clear();
  await supabase.auth.signOut();
}

/**
 * The authorization envelope for a verified identity.
 *
 * Built only from a membership the database already returned, so every
 * permission question in the product asks the same, fail-closed question.
 */
export function workspaceAccess(identity: WorkspaceIdentity): AccessContext {
  return accessContext({
    userId: identity.userId,
    organizationId: identity.organizationId,
    role: identity.role,
  });
}

