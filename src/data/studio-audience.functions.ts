import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  organizationId: z.string().uuid(),
  filter: z.enum(["all", "pending", "confirmed", "unsubscribed"]),
  page: z.number().int().min(1).max(10_000),
});

/** Read-only. Owner/admin of the bound workspace only; checked before any fetch. */
export const getStudioAudience = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }) => {
    const { readStudioAudience } = await import("@/lib/studio-audience.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const authorization = getRequest()?.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    return readStudioAudience({ token, ...data });
  });
