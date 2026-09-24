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
    const { trustTaiWriter } = await import("@/lib/trust-tai-writer.server");
    // Throws a person-safe message when the external server key is absent.
    const writer = trustTaiWriter();
    const { getRequest } = await import("@tanstack/react-start/server");
    const authorization = getRequest()?.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) throw new Error("Unauthorized: No bearer token available");
    return executeStewardAgentTask({
      client: context.supabase,
      writer,
      organizationId: data.organizationId,
      taskId: data.taskId,
      agentId: data.agentId,
      userId: context.userId,
      token,
    });
  });

/** Presence and connection health of the AI's server access. Never the key. */
export const getAgentServerAccessHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { trustTaiWriterHealth } = await import("@/lib/trust-tai-writer.server");
    return trustTaiWriterHealth();
  });
