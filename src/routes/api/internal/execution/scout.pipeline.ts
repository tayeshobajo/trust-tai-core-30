import { createFileRoute } from "@tanstack/react-router";

import {
  assertExecutionKey,
  executionAgentId,
  scoutPipelineState,
  scoutPipelineTarget,
  validateAgent,
} from "@/lib/execution-bridge.server";

export const Route = createFileRoute("/api/internal/execution/scout/pipeline")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          assertExecutionKey(request);
          const agent = await validateAgent(executionAgentId(request), "scout.read");
          const pipeline = await scoutPipelineState(agent.organization_id, scoutPipelineTarget());
          return Response.json({
            qualified: pipeline.qualified,
            ready_for_comms: pipeline.readyForComms,
            recent_7d: pipeline.recent7d,
            sourcing_warranted: pipeline.sourcingWarranted,
            deficit: pipeline.deficit,
            target: pipeline.target,
            org_id: pipeline.organizationId,
          });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Execution pipeline read failed." },
            { status: 401 },
          );
        }
      },
    },
  },
});
