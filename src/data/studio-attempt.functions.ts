import { createServerFn } from "@tanstack/react-start";
import { attemptActionSchema } from "@/domain/studio-attempt-wire";
export const studioAttemptAction = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => attemptActionSchema.parse(input))
  .handler(async ({ data }) => {
    const { getRequest, setResponseHeader } = await import("@tanstack/react-start/server");
    setResponseHeader("Cache-Control", "no-store");
    try {
      const { studioAttemptApplication } = await import("@/lib/studio-research-attempt-startup.server");
      return { status: "ok" as const, view: await studioAttemptApplication(getRequest(), data) };
    } catch (error) {
      const allowed = new Set(["attempt_unavailable", "attempt_origin_rejected", "attempt_config_missing", "attempt_config_invalid", "attempt_credentials_unavailable", "attempt_private_key_invalid", "attempt_public_key_invalid", "attempt_assembly_failed", "attempt_request_rejected", "attempt_owner_mismatch", "attempt_storage_unconfirmed", "attempt_storage_binding", "attempt_view_mismatch", "attempt_expired", "authentication_required", "membership_required", "access_lookup_failed", "access_denied"]);
      const category = error && typeof error === "object" && "category" in error ? String(error.category) : error instanceof Error ? error.message : "";
      return { status: "unavailable" as const, diagnostic: allowed.has(category) ? category : "attempt_boundary_unconfirmed" };
    }
  });
