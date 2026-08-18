import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { StewardAgentRead } from "@/domain/steward-accountability";

/** Read the Paperclip workforce for one workspace. Membership is enforced. */
export const getStewardAgents = createServerFn({ method: "GET" })
  .inputValidator((data: { organizationId: string }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<StewardAgentRead> => {
    const { data: org, error } = await context.supabase
      .from("organizations")
      .select("id")
      .eq("id", data.organizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!org) throw new Error("You are not a member of this Trust Tai workspace.");

    const { readStewardAgents } = await import("@/lib/steward-agents.server");
    return await readStewardAgents(data.organizationId);
  });
