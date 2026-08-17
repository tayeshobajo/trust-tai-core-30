import { createFileRoute } from "@tanstack/react-router";

import {
  assertExecutionKey,
  executionAgentId,
  latestIcpProfile,
  validateAgent,
} from "@/lib/execution-bridge.server";

export const Route = createFileRoute("/api/internal/execution/scout/icp")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          assertExecutionKey(request);
          const agent = await validateAgent(executionAgentId(request), "scout.read_icp");
          const icp = await latestIcpProfile(agent.organization_id);
          if (!icp) {
            return Response.json({ error: "No ICP found for this organization." }, { status: 404 });
          }
          return Response.json(icp);
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Execution ICP read failed." },
            { status: 401 },
          );
        }
      },
    },
  },
});
