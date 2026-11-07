import { ResearchDiagnosticError } from "./studio-research-diagnostics.server";
import { authorizeStudioResearch } from "./studio-research-access.server";
import {
  createStudioTransport,
  studioTransportDiagnostic,
} from "./studio-research-transport.server.mjs";
import { createResearchStore } from "./studio-research-store.server";
import {
  startStudioResearch,
  readStudioResearch,
  type ResearchDeps,
} from "./studio-research.server";
import { createCoordinatorRequestStore } from "./studio-research-coordinator-request-store.server";
import { createStudioCoordinatorHandlers } from "./studio-research-coordinator-studio.server";
import { researchRequestSchema } from "@/domain/studio-research";

// These non-secret IDs are verified in the approved Paperclip handoff. Never browser inputs.
export const studioBinding = {
  origin: "https://agents.trusttai.com",
  companyId: "aaa4eceb-44fb-4492-823c-65d3d90c5519",
  projectId: "d5160872-5d1c-41fb-b793-9ad7e4469f86",
  agentId: "5cbc9418-0ff9-4f1c-a807-c0632e26a538",
};
async function context(request: Request, org: string, work = false) {
  const auth = await authorizeStudioResearch(request, org, work).catch((error: unknown) => {
    if (error instanceof ResearchDiagnosticError) throw error;
    throw new ResearchDiagnosticError("access_check_failed");
  });
  if (!process.env["PAPERCLIP_STUDIO_ORGANIZATION_ID"])
    throw new ResearchDiagnosticError("binding_missing");
  if (process.env["PAPERCLIP_STUDIO_ORGANIZATION_ID"] !== org)
    throw new ResearchDiagnosticError("binding_mismatch");
  const organization = await auth.client
    .from("organizations")
    .select("slug")
    .eq("id", org)
    .maybeSingle();
  if (organization.error) throw new ResearchDiagnosticError("workspace_lookup_failed");
  if (organization.data?.slug !== "trust-tai")
    throw new ResearchDiagnosticError("workspace_mismatch");
  return auth;
}
function transport() {
  return createStudioTransport({
    ...studioBinding,
    key: process.env["PAPERCLIP_STUDIO_BRIDGE_KEY"] ?? "",
  });
}
function storage(userId: string) {
  return createResearchStore(
    userId,
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] || process.env["SUPABASE_SERVICE_ROLE_KEY"] || "",
  );
}
export async function researchConnection(request: Request, org: string) {
  await context(request, org);
  if (!process.env["PAPERCLIP_STUDIO_BRIDGE_KEY"]) return { status: "secret_missing" as const };
  try {
    const agent = await transport().readAgent(studioBinding.agentId);
    return {
      status: "verified" as const,
      agentStatus: agent.status,
      dispatchEnabled: process.env["PAPERCLIP_STUDIO_RESEARCH_ENABLED"] === "true",
    };
  } catch (error) {
    return { status: "identity_unverified" as const, diagnostic: studioTransportDiagnostic(error) };
  }
}
export async function researchHistory(request: Request, org: string) {
  const auth = await context(request, org);
  return storage(auth.user.id).list(org);
}
export async function researchAction(
  request: Request,
  input: unknown,
  operation: "start" | "read",
) {
  const parsed = researchRequestSchema.parse(input);
  const auth = await context(request, parsed.organizationId, operation === "start");
  // Local preparation only: never enabled/configured by startup. Read path cannot issue authority or execute.
  if (operation === "read" && process.env["PAPERCLIP_STUDIO_COORDINATOR_READ_ENABLED"] === "true") {
    const receipts = createCoordinatorRequestStore(
      process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] ||
        process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
        "",
    );
    const row = await receipts.read(parsed.organizationId, parsed.requestId);
    if (row?.coordinator_state)
      return createStudioCoordinatorHandlers({
        store: receipts,
        enabled: false,
        now: Date.now,
      }).read(request, { organizationId: parsed.organizationId, requestId: parsed.requestId });
  }
  const store = storage(auth.user.id);
  const remote = transport();
  const deps: ResearchDeps = {
    ...store,
    createIssue: remote.createIssue,
    readIssue: remote.readIssue,
    agent: remote.readAgent,
    authorize: async (_token, org, action) => {
      try {
        await context(request, org, action === "work");
        return true;
      } catch {
        return false;
      }
    },
    configuration: async (org) => ({
      organizationId: org,
      enabled: process.env["PAPERCLIP_STUDIO_RESEARCH_ENABLED"] === "true",
      ...studioBinding,
      owningApp: "studio",
      capabilities: ["studio.research"],
    }),
  };
  if (operation === "start") return startStudioResearch("server-authorized", parsed, deps);
  const result = await readStudioResearch(
    "server-authorized",
    parsed.organizationId,
    parsed.requestId,
    deps,
  );
  if (result.status === "review_ready")
    await store.saveResult(
      parsed.organizationId,
      parsed.requestId,
      result.commentId,
      result.result,
    );
  return result;
}
