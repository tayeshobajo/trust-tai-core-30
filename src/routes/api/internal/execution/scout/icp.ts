// src/routes/api/internal/execution/scout/icp.ts
// GET — returns current ICP for Scout

import { createFileRoute } from "@tanstack/react-router";
import { validateAgent, assertCapability } from "@/lib/execution-bridge.server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.TRUST_TAI_SUPABASE_URL!,
  process.env.TRUST_TAI_SUPABASE_SERVICE_KEY!
);

export const Route = createFileRoute("/api/internal/execution/scout/icp")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        try {
          const executionKey =
            request.headers.get("x-execution-key") ?? "";
          const paperclipAgentId =
            request.headers.get("x-agent-id") ?? "";
          const agent = await validateAgent(executionKey, paperclipAgentId);
          assertCapability(agent, "get_icp");

          const { data, error } = await supabase
            .from("icp_profiles")
            .select("content_markdown, version, org_id")
            .eq("organization_id", agent.organizationId)
            .eq("is_active", true)
            .order("version", { ascending: false })
            .limit(1)
            .single();

          if (error || !data) {
            return Response.json(
              { error: "No active ICP found" },
              { status: 404 }
            );
          }

          return Response.json(data);
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
