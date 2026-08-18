import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { StewardAgentRead } from "@/domain/steward-accountability";

/**
 * Single-org workspace: the org row must exist and the caller must hold a
 * validated session. Untyped on purpose, the generated Database types do not
 * describe this externally managed schema.
 */
async function assertMembership(context: any, organizationId: string) {
  const { data, error } = await context.supabase
    .from("organizations")
    .select("id")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You are not a member of this Trust Tai workspace.");
}

/** Read the Paperclip workforce for one workspace. Membership is enforced. */
export const getStewardAgents = createServerFn({ method: "GET" })
  .inputValidator((data: { organizationId: string }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<StewardAgentRead> => {
    await assertMembership(context, data.organizationId);

    const { readStewardAgents } = await import("@/lib/steward-agents.server");
    return await readStewardAgents(data.organizationId);
  });

/**
 * Hand one bounded task to a Paperclip agent. Steward asks; Paperclip decides
 * how and when it runs, and reports its own completion.
 */
export const assignStewardAgentTask = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      organizationId: string;
      agentId: string;
      title: string;
      description: string;
    }) => data,
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<{ issueId: string }> => {
    await assertMembership(context, data.organizationId);

    const { assignPaperclipTask } = await import("@/lib/steward-agents.server");
    return await assignPaperclipTask({
      organizationId: data.organizationId,
      agentId: data.agentId,
      title: data.title,
      description: data.description,
    });
  });
