import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { StewardAgentRead } from "@/domain/steward-accountability";

/** Read the Paperclip workforce for one workspace. Membership is enforced. */
export const getStewardAgents = createServerFn({ method: "GET" })
  .inputValidator((data: { organizationId: string }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<StewardAgentRead> => {
    const { assertStewardMembership, readStewardAgents } = await import(
      "@/lib/steward-agents.server"
    );
    await assertStewardMembership(context, data.organizationId);
    return await readStewardAgents(data.organizationId);
  });

/**
 * Hand one bounded task to a Paperclip agent. Steward asks; Paperclip decides
 * how and when it runs, and reports its own completion.
 */
export const assignStewardAgentTask = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { organizationId: string; agentId: string; title: string; description: string }) => data,
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<{ issueId: string }> => {
    const { assertStewardMembership, assignPaperclipTask } = await import(
      "@/lib/steward-agents.server"
    );
    await assertStewardMembership(context, data.organizationId);
    return await assignPaperclipTask({
      organizationId: data.organizationId,
      agentId: data.agentId,
      title: data.title,
      description: data.description,
    });
  });
