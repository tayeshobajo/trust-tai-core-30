import { createServerFn } from "@tanstack/react-start";
import { manualActionSchema, type ManualReply } from "@/domain/studio-manual-wire";
export const studioManualAction = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => manualActionSchema.parse(input))
  .handler(async ({ data }): Promise<ManualReply> => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { studioManualApplication } = await import("@/lib/studio-research-app.server");
    try {
      return await studioManualApplication(getRequest(), data);
    } catch {
      return { status: "unavailable", reason: "request_unconfirmed" };
    }
  });
