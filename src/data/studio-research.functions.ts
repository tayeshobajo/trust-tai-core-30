import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { researchRequestSchema } from "@/domain/studio-research";
const orgSchema = z.object({ organizationId: z.string().uuid() }).strict();
export const checkStudioResearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => orgSchema.parse(input))
  .handler(async ({ data }) => {
    const { researchConnection } = await import("@/lib/studio-research-runtime.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    try {
      return await researchConnection(getRequest(), data.organizationId);
    } catch {
      return { status: "unavailable" as const };
    }
  });
export const listStudioResearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => orgSchema.parse(input))
  .handler(async ({ data }) => {
    const { researchHistory } = await import("@/lib/studio-research-runtime.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    try {
      return {
        status: "ready" as const,
        runs: await researchHistory(getRequest(), data.organizationId),
      };
    } catch {
      return { status: "unavailable" as const, runs: [] };
    }
  });
export const runStudioResearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ operation: z.enum(["start", "read"]), request: researchRequestSchema })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { researchAction } = await import("@/lib/studio-research-runtime.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    try {
      return await researchAction(getRequest(), data.request, data.operation);
    } catch {
      return { status: "unavailable" as const };
    }
  });
