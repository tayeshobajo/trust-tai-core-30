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

/** Temporary read-only probe through the same registered server-function request context. */
export const studioManualOriginDiagnostic = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequest, setResponseHeader } = await import("@tanstack/react-start/server");
  const { studioPreviewOriginDiagnostic } = await import("@/lib/studio-research-preview-origin.server");
  setResponseHeader("Cache-Control", "no-store");
  return studioPreviewOriginDiagnostic(getRequest());
});
