/**
 * Trust Tai OS — real auth + workspace boundary.
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

