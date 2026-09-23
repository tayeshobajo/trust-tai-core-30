import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RunInput = z.object({
  organizationId: z.string().uuid(),
  taskId: z.string().uuid(),
  agentId: z.string().min(1).max(200),
});

/** Person-triggered only. Automated and recurring callers have no entry point here. */
export const runStewardAgentTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunInput.parse(input))
  .handler(async ({ context, data }) => {
    const { executeStewardAgentTask } = await import("@/lib/steward-agent-runner.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const authorization = getRequest()?.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) throw new Error("Unauthorized: No bearer token available");
    return executeStewardAgentTask({
      client: context.supabase,
      writer: supabaseAdmin,
      organizationId: data.organizationId,
      taskId: data.taskId,
      agentId: data.agentId,
      userId: context.userId,
      token,
    });
  });