/**
 * Intelligence Runtime status endpoint.
 *
 * One shared health probe for the whole suite: Comms, Scout, Roadmap,
 * Steward, Studio, and Conductor all reason through the same runtime, so one
 * endpoint answers "can the suite reason right now, and on which provider."
 * Secret-free by contract — provider name and model only, never a key.
 */

import { createFileRoute } from "@tanstack/react-router";

import { runtimeProviderStatus } from "@/lib/intelligence-runtime.server";

export const Route = createFileRoute("/api/public/intelligence/status")({
  server: {
    handlers: {
      GET: async () => {
        const status = runtimeProviderStatus();
        return Response.json(
          {
            configured: status.configured,
            provider: status.provider,
            model: status.model,
            capabilities: status.capabilities,
            checkedAt: new Date().toISOString(),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
