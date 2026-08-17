// src/routes/api/internal/execution/scout/prospect.ts
// POST — upserts a prospect with provenance

import { createFileRoute } from "@tanstack/react-router";
import {
  validateAgent,
  assertCapability,
  recordBinding,
  completeBinding,
} from "@/lib/execution-bridge.server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.TRUST_TAI_SUPABASE_URL!,
  process.env.TRUST_TAI_SUPABASE_SERVICE_KEY!
);

export const Route = createFileRoute(
  "/api/internal/execution/scout/prospect"
)({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const executionKey =
            request.headers.get("x-execution-key") ?? "";
          const paperclipAgentId =
            request.headers.get("x-agent-id") ?? "";
          const agent = await validateAgent(executionKey, paperclipAgentId);
          assertCapability(agent, "create_prospect");

          const body = await request.json();
          const {
            company_name,
            website_url,
            contact_name,
            contact_title,
            contact_email,
            linkedin_url,
            discovery_source,
            rationale,
            suggested,
            idempotency_key,
          } = body;

          if (!company_name || !website_url) {
            return Response.json(
              { error: "company_name and website_url are required" },
              { status: 400 }
            );
          }

          // Check for duplicate by website_url
          const { data: existing } = await supabase
            .from("prospects")
            .select("id, status")
            .eq("organization_id", agent.organizationId)
            .eq("website_url", website_url)
            .single();

          if (existing) {
            return Response.json({
              id: existing.id,
              created: false,
              duplicate: true,
              status: existing.status,
            });
          }

          // Find or create a scout_discovery_run for today
          const today = new Date().toISOString().split("T")[0];
          let runId: string;
          const { data: existingRun } = await supabase
            .from("scout_discovery_runs")
            .select("id")
            .eq("organization_id", agent.organizationId)
            .eq("run_date", today)
            .single();

          if (existingRun) {
            runId = existingRun.id;
          } else {
            const { data: newRun } = await supabase
              .from("scout_discovery_runs")
              .insert({
                organization_id: agent.organizationId,
                run_date: today,
                agent_id: agent.agentId,
                status: "running",
              })
              .select("id")
              .single();
            runId = newRun!.id;
          }

          // Record execution binding
          const bindingId = await recordBinding({
            agent,
            sourceApp: "scout",
            objective: `Create prospect: ${company_name}`,
            idempotencyKey: idempotency_key,
            paperclipCompanyId: "aaa4eceb-44fb-4492-823c-65d3d90c5519",
          });

          // Insert prospect
          const { data: prospect, error } = await supabase
            .from("prospects")
            .insert({
              organization_id: agent.organizationId,
              company_name,
              website_url,
              contact_name,
              contact_title,
              contact_email,
              linkedin_url,
              discovery_source: discovery_source ?? "scout_agent",
              rationale,
              suggested: suggested ?? false,
              status: "pending_review",
              run_id: runId,
            })
            .select("id")
            .single();

          if (error || !prospect) {
            await completeBinding(bindingId, {
              status: "failed",
              summary: error?.message,
            });
            return Response.json(
              { error: error?.message ?? "Insert failed" },
              { status: 500 }
            );
          }

          await completeBinding(bindingId, {
            status: "completed",
            summary: `Created prospect ${prospect.id}`,
            outputs: { prospect_id: prospect.id },
          });

          return Response.json({
            id: prospect.id,
            created: true,
            duplicate: false,
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
