import { createServerFn } from "@tanstack/react-start";
import { attemptActionSchema } from "@/domain/studio-attempt-wire";
export const studioAttemptAction = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => attemptActionSchema.parse(input))
  .handler(async ({ data }) => {
    const { getRequest, setResponseHeader } = await import("@tanstack/react-start/server");
    const { studioAttemptApplication } =
      await import("@/lib/studio-research-attempt-startup.server");
    setResponseHeader("Cache-Control", "no-store");
    try {
      return { status: "ok" as const, view: await studioAttemptApplication(getRequest(), data) };
    } catch {
      return { status: "unavailable" as const };
    }
  });
