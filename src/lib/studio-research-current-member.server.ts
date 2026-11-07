/** Unregistered Studio receipt boundary. No credential loading or network default. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveAppAccess } from "@/domain/app-access";
import { COORDINATOR } from "./studio-research-coordinator-contracts";

/** Supply only a trusted server-owned client. Signed receipt identity is checked by the caller;
 * this lookup independently rechecks current membership/work permission, never browser claims.
 * No cache: revocation is observed on each operation. This is not a transaction-time lock.
 */
export function makeStudioCurrentMember(client: Pick<SupabaseClient, "from">) {
  return async (subject: string, organization: string): Promise<void> => {
    try {
      z.string().uuid().parse(subject);
      z.literal(COORDINATOR.organizationId).parse(organization);
      const membership = await client
        .from("organization_memberships")
        .select("status, role")
        .eq("organization_id", organization)
        .eq("user_id", subject)
        .maybeSingle();
      if (membership.error) throw Error();
      const member = z
        .object({ status: z.literal("active"), role: z.string().min(1) })
        .parse(membership.data);
      const [org, override, role] = await Promise.all([
        client
          .from("organization_app_settings")
          .select("enabled")
          .eq("organization_id", organization)
          .eq("app_key", "studio")
          .maybeSingle(),
        client
          .from("member_app_access")
          .select("access_level")
          .eq("organization_id", organization)
          .eq("user_id", subject)
          .eq("app_key", "studio")
          .maybeSingle(),
        client
          .from("organization_role_app_access")
          .select("access_level")
          .eq("organization_id", organization)
          .eq("role", member.role)
          .eq("app_key", "studio")
          .maybeSingle(),
      ]);
      if (org.error || override.error || role.error) throw Error();
      const setting = z.object({ enabled: z.boolean() }).nullable().parse(org.data);
      const accessRow = z
        .object({ access_level: z.enum(["hidden", "view", "work", "manage"]) })
        .nullable();
      const personal = accessRow.parse(override.data),
        template = accessRow.parse(role.data);
      const access = resolveAppAccess("studio", {
        role: member.role,
        membershipActive: true,
        organizationEnabled: setting?.enabled !== false,
        override: personal?.access_level ?? template?.access_level,
      });
      if (!access.visible || !access.canWork) throw Error();
    } catch {
      throw Error("studio_current_access_rejected");
    }
  };
}
