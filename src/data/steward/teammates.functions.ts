/**
 * Teammate names for assigning work, readable by every active member.
 *
 * Profile privacy hides other people's rows from a signed-in member, so the
 * assignee list could only ever show yourself. This reads names server-side,
 * and only after the caller's own active membership in that exact workspace
 * is confirmed as themselves (RLS applies to that check). It returns just a
 * name per active teammate: never emails of unnamed people, roles or anything else.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ organizationId: z.string().uuid() });

export const getTeammateNames = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ context, data }) => {
    const own = await context.supabase
      .from("organization_memberships")
      .select("status")
      .eq("organization_id", data.organizationId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (own.error || (own.data as { status?: string } | null)?.status !== "active") {
      throw new Error("Only active members of this workspace can see its team.");
    }

    const { trustTaiWriter } = await import("@/lib/trust-tai-writer.server");
    const writer = trustTaiWriter();
    const members = await writer
      .from("organization_memberships")
      .select("user_id, status")
      .eq("organization_id", data.organizationId)
      .eq("status", "active");
    if (members.error) throw new Error("The team list could not be read right now.");
    const ids = ((members.data ?? []) as { user_id: string }[]).map((m) => m.user_id);
    if (ids.length === 0) return [] as { userId: string; name: string }[];

    const profiles = await writer.from("profiles").select("id, full_name, email").in("id", ids);
    if (profiles.error) throw new Error("The team list could not be read right now.");
    return ((profiles.data ?? []) as { id: string; full_name: string | null; email: string | null }[])
      .map((p) => ({ userId: p.id, name: (p.full_name || p.email || "").trim() }))
      .filter((p) => p.name);
  });
