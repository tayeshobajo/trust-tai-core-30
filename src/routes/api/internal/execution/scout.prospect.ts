import { createFileRoute } from "@tanstack/react-router";

import {
  assertExecutionKey,
  completeBinding,
  executionAgentId,
  recordBinding,
  trustTaiServiceRoleClient,
  validateAgent,
} from "@/lib/execution-bridge.server";
import { paperclipClient } from "@/lib/paperclip-client.server";
import { normalizeWebsiteUrl } from "@/lib/website-url";

interface ProspectPayload {
  company_name?: unknown;
  website_url?: unknown;
  why_sourced?: unknown;
  icp_version?: unknown;
  observed?: unknown;
  inferred?: unknown;
  provenance?: unknown;
  idempotency_key?: unknown;
}

export const Route = createFileRoute("/api/internal/execution/scout/prospect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertExecutionKey(request);
          const agentId = executionAgentId(request);
          const agent = await validateAgent(agentId, "scout.create_prospect");
          const paperclipAgent = await paperclipClient.getAgent(agent.paperclip_agent_id);

          const body = (await request.json()) as ProspectPayload;
          const companyName = typeof body.company_name === "string" ? body.company_name.trim() : "";
          const whySourced = typeof body.why_sourced === "string" ? body.why_sourced.trim() : "";
          const idempotencyKey =
            typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";
          const websiteUrl =
            typeof body.website_url === "string" ? normalizeWebsiteUrl(body.website_url) : null;

          if (!companyName || !websiteUrl || !whySourced || !idempotencyKey) {
            return Response.json(
              {
                error:
                  "company_name, website_url, why_sourced, and idempotency_key are required.",
              },
              { status: 400 },
            );
          }

          const supabase = trustTaiServiceRoleClient();
          const { data: existing, error: existingError } = await supabase
            .from("prospects")
            .select("id, organization_id")
            .eq("organization_id", agent.organization_id)
            .eq("website_url", websiteUrl)
            .maybeSingle();
          if (existingError) throw new Error(existingError.message);

          const binding = await recordBinding({
            organizationId: agent.organization_id,
            sourceApp: "scout",
            sourceEntityType: "prospect",
            sourceEntityId: existing?.id ?? null,
            paperclipCompanyId: paperclipAgent.companyId,
            paperclipAgentId: agent.paperclip_agent_id,
            objective: whySourced,
            expectedOutcome: "Create a discovered Scout prospect with evidence and provenance.",
            idempotencyKey,
            businessOutputs: {
              company_name: companyName,
              website_url: websiteUrl,
            },
          });

          if (existing) {
            await completeBinding(binding.id, {
              status: "completed",
              resultSummary: `${companyName} already existed on the Scout board.`,
              businessOutputs: {
                prospect_id: existing.id,
                duplicate: true,
                created: false,
                company_name: companyName,
                website_url: websiteUrl,
              },
            });
            return Response.json({ id: existing.id, created: false, duplicate: true });
          }

          const { data, error } = await supabase
            .from("prospects")
            .insert({
              organization_id: agent.organization_id,
              company_name: companyName,
              website_url: websiteUrl,
              status: "discovered",
              source: "scout_execution_bridge",
              observed: body.observed ?? [],
              inferred: body.inferred ?? {},
              suggested: {},
              provenance: {
                ...(body.provenance && typeof body.provenance === "object" ? body.provenance : {}),
                app: "scout_execution_bridge",
                paperclip_agent_id: agent.paperclip_agent_id,
                icp_version: typeof body.icp_version === "number" ? body.icp_version : null,
                why_sourced: whySourced,
                source_event_key: idempotencyKey,
              },
            })
            .select("id")
            .maybeSingle();
          if (error) throw new Error(error.message);
          if (!data) throw new Error("Prospect insert returned no row.");

          await completeBinding(binding.id, {
            status: "completed",
            resultSummary: `${companyName} was added to Scout as a discovered prospect.`,
            businessOutputs: {
              prospect_id: data.id,
              duplicate: false,
              created: true,
              company_name: companyName,
              website_url: websiteUrl,
            },
          });

          return Response.json({ id: data.id, created: true, duplicate: false });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Prospect creation failed." },
            { status: 400 },
          );
        }
      },
    },
  },
});
