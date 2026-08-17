// src/routes/api/internal/execution/scout/pipeline.ts
// GET — returns pipeline state for Scout decision-making

import { createFileRoute } from "@tanstack/react-router";
import { validateAgent, assertCapability } from "@/lib/execution-bridge.server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.TRUST_TAI_SUPABASE_URL!,
  process.env.TRUST_TAI_SUPABASE_SERVICE_KEY!
);

export const Route = createFileRoute(
  "/api/internal/execution/scout/pipeline"
)({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        try {
          const executionKey =
            request.headers.get("x-execution-key") ?? "";
          const paperclipAgentId =
            request.headers.get("x-agent-id") ?? "";
          const agent = await validateAgent(executionKey, paperclipAgentId);
          assertCapability(agent, "get_pipeline_state");

          const sevenDaysAgo = new Date(
            Date.now() - 7 * 24 * 60 * 60 * 1000
          ).toISOString();

          const [qualified, readyForComms, recent] = await Promise.all([
            supabase
              .from("prospects")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", agent.organizationId)
              .eq("status", "qualified"),
            supabase
              .from("prospects")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", agent.organizationId)
              .eq("status", "ready_for_comms"),
            supabase
              .from("prospects")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", agent.organizationId)
              .gte("created_at", sevenDaysAgo),
          ]);

          const qualifiedCount = qualified.count ?? 0;
          const WEEKLY_GOAL = 5;
          const deficit = Math.max(0, WEEKLY_GOAL - (recent.count ?? 0));

          return Response.json({
            qualified: qualifiedCount,
            ready_for_comms: readyForComms.count ?? 0,
            recent_7d: recent.count ?? 0,
            sourcing_warranted: deficit > 0,
            deficit,
          });
        } catch (err: any) {
          return Response.json(
            { error: err.message },
            { status: err.status ?? 500 }
          );
        }
      },
    },
  },
});
