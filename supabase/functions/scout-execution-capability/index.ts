/**
 * scout-execution-capability. Supabase Edge Function
 *
 * Cloud-native deployment of the Trust Tai Execution Bridge scout
 * capability API. This is a faithful port of the TanStack server routes
 * (src/routes/api/internal/execution/scout.{pipeline,icp,prospect}.ts on
 * origin/main) so Paperclip's Scout Growth Agent has a governed, always-on
 * HTTP boundary that does not depend on Lovable preview deployments or
 * Tai's laptop.
 *
 * Why this exists: the Lovable runtime env could not be kept in sync with
 * the TRUST_TAI_EXECUTION_KEY rotation, so cmd.trusttai.com served 401s.
 * Edge function secrets ARE the verified live values (hash-checked against
 * the Supabase secret store on 2026-08-17).
 *
 * Auth contract (unchanged from the server routes):
 *   X-Execution-Key: TRUST_TAI_EXECUTION_KEY secret
 *   X-Agent-Id:      Paperclip agent id, mapped through execution_agents
 *
 * Capabilities enforced (unchanged):
 *   GET  /scout/pipeline     -> scout.read
 *   GET  /scout/icp          -> scout.read_icp
 *   POST /scout/prospect     -> scout.create_prospect
 *   POST /scout/draft-intro  -> scout.draft_intro (drafts only, never sends)
 *
 * Path routing: requests to this function use the suffix after the
 * function name, e.g.
 *   POST https://<ref>.functions.supabase.co/scout-execution-capability/scout/pipeline
 *
 * Laws preserved: agent identity validated per call, capability scope
 * enforced, cross-org closed (agent row pins organization_id), idempotent
 * bindings, provenance persisted on every prospect, duplicates return
 * instead of inserting.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXECUTION_KEY = Deno.env.get("TRUST_TAI_EXECUTION_KEY");
const PAPERCLIP_API_URL = Deno.env.get("PAPERCLIP_API_URL") ?? "http://127.0.0.1:3100";
const PAPERCLIP_BOARD_KEY = Deno.env.get("PAPERCLIP_BOARD_KEY");
// Known Trust Tai Paperclip company id, stable config, not business truth.
// execution_bindings.paperclip_company_id is NOT NULL, so this constant is
// the required fallback when the board API is unreachable from the edge runtime.
const TRUST_TAI_COMPANY_ID = "aaa4eceb-44fb-4492-823c-65d3d90c5519";

const SCOUT_PIPELINE_TARGET = 15; // operating policy, not business truth

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fail(message: string, status: number): Response {
  return json({ error: message }, status);
}

// ------------------------------------------------------------- auth

function assertExecutionKey(req: Request): void {
  const header = req.headers.get("X-Execution-Key");
  if (!EXECUTION_KEY || !header || header !== EXECUTION_KEY) {
    throw Object.assign(new Error("Invalid execution key"), { status: 401 });
  }
}

function executionAgentId(req: Request): string {
  const agentId = req.headers.get("X-Agent-Id")?.trim();
  if (!agentId) throw Object.assign(new Error("Missing X-Agent-Id."), { status: 401 });
  return agentId;
}

interface AgentRecord {
  id: string;
  organization_id: string;
  paperclip_agent_id: string;
  name: string;
  principal: string;
  capabilities: string[];
  enabled: boolean;
}

async function validateAgent(paperclipAgentId: string, capability: string): Promise<AgentRecord> {
  const { data, error } = await supabase
.from("execution_agents")
.select("*")
.eq("paperclip_agent_id", paperclipAgentId)
.maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  if (!data) {
    throw Object.assign(new Error(`Execution agent ${paperclipAgentId} is not registered.`), {
      status: 403,
    });
  }
  if (!data.enabled) {
    throw Object.assign(new Error(`Execution agent ${paperclipAgentId} is disabled.`), {
      status: 403,
    });
  }
  const caps = (data.capabilities ?? []) as string[];
  if (!caps.includes(capability)) {
    throw Object.assign(
      new Error(`Execution agent ${paperclipAgentId} lacks ${capability}.`),
      { status: 403 },
    );
  }
  return data as AgentRecord;
}

// ------------------------------------------------------------- bindings

interface BindingResult {
  status: string;
  resultSummary?: string;
  businessOutputs?: Record<string, unknown>;
}

async function recordBinding(input: {
  organizationId: string;
  sourceApp: string;
  paperclipCompanyId: string | null;
  paperclipAgentId: string;
  objective: string;
  expectedOutcome?: string;
  idempotencyKey: string;
  businessOutputs?: Record<string, unknown>;
}): Promise<{ id: string; existing: boolean }> {
  const { data: existing, error: existingError } = await supabase
.from("execution_bindings")
.select("id")
.eq("idempotency_key", input.idempotencyKey)
.maybeSingle();
  if (existingError) throw Object.assign(new Error(existingError.message), { status: 500 });
  if (existing) return { id: existing.id as string, existing: true };

  const { data, error } = await supabase
.from("execution_bindings")
.insert({
      organization_id: input.organizationId,
      source_app: input.sourceApp,
      source_entity_type: "prospect",
      paperclip_company_id: input.paperclipCompanyId,
      paperclip_agent_id: input.paperclipAgentId,
      objective: input.objective,
      expected_outcome: input.expectedOutcome ?? null,
      status: "dispatched",
      business_outputs: input.businessOutputs ?? {},
      idempotency_key: input.idempotencyKey,
    })
.select("id")
.maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  if (!data) throw Object.assign(new Error("Execution binding insert returned no row."), {
    status: 500,
  });
  return { id: data.id as string, existing: false };
}

async function completeBinding(bindingId: string, result: BindingResult): Promise<void> {
  const { error } = await supabase
.from("execution_bindings")
.update({
      status: result.status,
      result_summary: result.resultSummary ?? null,
      business_outputs: result.businessOutputs ?? {},
      updated_at: new Date().toISOString(),
    })
.eq("id", bindingId);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
}

// ------------------------------------------------------------- reads

async function scoutPipelineState(organizationId: string, target: number) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [qualifiedResult, readyResult, recentResult] = await Promise.all([
    supabase
.from("prospects")
.select("id", { count: "exact", head: true })
.eq("organization_id", organizationId)
.eq("status", "qualified"),
    supabase
.from("prospects")
.select("id", { count: "exact", head: true })
.eq("organization_id", organizationId)
.eq("status", "ready_for_comms"),
    supabase
.from("prospects")
.select("id", { count: "exact", head: true })
.eq("organization_id", organizationId)
.gte("created_at", since),
  ]);
  if (qualifiedResult.error) throw Object.assign(new Error(qualifiedResult.error.message), { status: 500 });
  if (readyResult.error) throw Object.assign(new Error(readyResult.error.message), { status: 500 });
  if (recentResult.error) throw Object.assign(new Error(recentResult.error.message), { status: 500 });

  const qualified = qualifiedResult.count ?? 0;
  const readyForComms = readyResult.count ?? 0;
  const recent7d = recentResult.count ?? 0;
  const current = qualified + readyForComms;
  const deficit = Math.max(0, target - current);
  return {
    organizationId,
    qualified,
    readyForComms,
    recent7d,
    current,
    deficit,
    target,
    sourcingWarranted: current < target || recent7d < 3,
  };
}

// ------------------------------------------------------------- website url

/** Canonical `https://hostname` form, or null when the text is not an address. */
function normalizeWebsiteUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw: `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  const tld = host.split(".").pop() ?? "";
  if (tld.length < 2 || /^\d+$/.test(tld)) return null;
  return `https://${host}`;
}

// ------------------------------------------------------------- handlers

async function handlePipeline(req: Request): Promise<Response> {
  assertExecutionKey(req);
  const agent = await validateAgent(executionAgentId(req), "scout.read");
  const pipeline = await scoutPipelineState(agent.organization_id, SCOUT_PIPELINE_TARGET);
  return json({
    qualified: pipeline.qualified,
    ready_for_comms: pipeline.readyForComms,
    recent_7d: pipeline.recent7d,
    sourcing_warranted: pipeline.sourcingWarranted,
    deficit: pipeline.deficit,
    target: pipeline.target,
    org_id: pipeline.organizationId,
  });
}

async function handleIcp(req: Request): Promise<Response> {
  assertExecutionKey(req);
  const agent = await validateAgent(executionAgentId(req), "scout.read_icp");
  const { data, error } = await supabase
.from("icp_profiles")
.select("*")
.eq("organization_id", agent.organization_id)
.order("version", { ascending: false })
.limit(1)
.maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  if (!data) return fail("No ICP found for this organization.", 404);
  return json(data);
}

async function handleProspect(req: Request): Promise<Response> {
  assertExecutionKey(req);
  const agent = await validateAgent(executionAgentId(req), "scout.create_prospect");

  // Resolve Paperclip company id for binding provenance. Best-effort: the
  // agent row metadata carries it, and the board API is the fallback.
  // Resolve Paperclip company id for binding provenance.
  // Fallback: TRUST_TAI_COMPANY_ID is a stable known constant (NOT business truth).
  // paperclip_company_id is NOT NULL in execution_bindings, so the fallback is mandatory.
  let paperclipCompanyId: string = TRUST_TAI_COMPANY_ID;
  if (PAPERCLIP_BOARD_KEY) {
    try {
      const res = await fetch(`${PAPERCLIP_API_URL}/api/agents/${agent.paperclip_agent_id}`, {
        headers: { Authorization: `Bearer ${PAPERCLIP_BOARD_KEY}` },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const boardAgent = (await res.json()) as { companyId?: string };
        paperclipCompanyId = boardAgent.companyId ?? TRUST_TAI_COMPANY_ID;
      }
    } catch {
      // Board unreachable from edge runtime, fall through to known constant.
    }
  }

  const body = (await req.json()) as Record<string, unknown>;
  const companyName = typeof body.company_name === "string" ? body.company_name.trim(): "";
  const whySourced = typeof body.why_sourced === "string" ? body.why_sourced.trim(): "";
  const idempotencyKey =
    typeof body.idempotency_key === "string" ? body.idempotency_key.trim(): "";
  const websiteUrl =
    typeof body.website_url === "string" ? normalizeWebsiteUrl(body.website_url): null;

  if (!companyName || !websiteUrl || !whySourced || !idempotencyKey) {
    return fail(
      "company_name, website_url, why_sourced, and idempotency_key are required.",
      400,
    );
  }

  const { data: existing, error: existingError } = await supabase
.from("prospects")
.select("id, organization_id")
.eq("organization_id", agent.organization_id)
.eq("website_url", websiteUrl)
.maybeSingle();
  if (existingError) throw Object.assign(new Error(existingError.message), { status: 500 });

  const binding = await recordBinding({
    organizationId: agent.organization_id,
    sourceApp: "scout",
    paperclipCompanyId,
    paperclipAgentId: agent.paperclip_agent_id,
    objective: whySourced,
    expectedOutcome: "Create a discovered Scout prospect with evidence and provenance.",
    idempotencyKey,
    businessOutputs: { company_name: companyName, website_url: websiteUrl },
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
    return json({ id: existing.id, created: false, duplicate: true });
  }

  const provenanceInput =
    body.provenance && typeof body.provenance === "object" && !Array.isArray(body.provenance)
      ? (body.provenance as Record<string, unknown>)
: {};

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
...provenanceInput,
        app: "scout_execution_bridge",
        paperclip_agent_id: agent.paperclip_agent_id,
        icp_version: typeof body.icp_version === "number" ? body.icp_version: null,
        why_sourced: whySourced,
        source_event_key: idempotencyKey,
      },
    })
.select("id")
.maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  if (!data) throw Object.assign(new Error("Prospect insert returned no row."), { status: 500 });

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

  return json({ id: data.id, created: true, duplicate: false });
}

/**
 * POST /scout/draft-intro
 * Mirror of src/routes/api/internal/execution/scout.draft-intro.ts.
 * The Scout agent drafts, it never sends: the output is a comms_drafts row
 * in review_state 'needs_human_review'. No path from here touches
 * comms-send, Resend, or any provider.
 *
 * NOTE on voice: the deterministic voice policy (src/data/voice-policy.ts)
 * is not ported to Deno, so this mirror cannot run it. Every draft written
 * here is marked rationale.voice_checked = false, and the app re-runs the
 * voice check at approval time before a human can approve the draft.
 */
async function handleDraftIntro(req: Request): Promise<Response> {
  assertExecutionKey(req);
  const agent = await validateAgent(executionAgentId(req), "scout.draft_intro");

  let paperclipCompanyId: string = TRUST_TAI_COMPANY_ID;
  if (PAPERCLIP_BOARD_KEY) {
    try {
      const res = await fetch(`${PAPERCLIP_API_URL}/api/agents/${agent.paperclip_agent_id}`, {
        headers: { Authorization: `Bearer ${PAPERCLIP_BOARD_KEY}` },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const boardAgent = (await res.json()) as { companyId?: string };
        paperclipCompanyId = boardAgent.companyId ?? TRUST_TAI_COMPANY_ID;
      }
    } catch {
      // Board unreachable from edge runtime, fall through to known constant.
    }
  }

  const body = (await req.json()) as Record<string, unknown>;
  const prospectId = typeof body.prospect_id === "string" ? body.prospect_id.trim() : "";
  const templateId = typeof body.template_id === "string" ? body.template_id.trim() : "";
  const draftBodyOverride =
    typeof body.draft_body === "string" && body.draft_body.trim() ? body.draft_body : null;
  const draftSubjectOverride =
    typeof body.draft_subject === "string" && body.draft_subject.trim()
      ? body.draft_subject.trim()
      : null;
  const idempotencyKey =
    typeof body.idempotency_key === "string" && body.idempotency_key.trim()
      ? body.idempotency_key.trim()
      : `scout.draft_intro:${prospectId}:${templateId}:${crypto.randomUUID()}`;

  if (!prospectId || !templateId) {
    return fail("prospect_id and template_id are required.", 400);
  }

  const { data: prospect, error: prospectError } = await supabase
    .from("prospects")
    .select("id, organization_id, company_name, website_url, status")
    .eq("id", prospectId)
    .eq("organization_id", agent.organization_id)
    .maybeSingle();
  if (prospectError) throw Object.assign(new Error(prospectError.message), { status: 500 });
  if (!prospect) return fail("Prospect not found in this organization.", 404);

  const { data: template, error: templateError } = await supabase
    .from("scout_intro_templates")
    .select("id, organization_id, name, subject, body, active")
    .eq("id", templateId)
    .eq("organization_id", agent.organization_id)
    .maybeSingle();
  if (templateError) throw Object.assign(new Error(templateError.message), { status: 500 });
  if (!template) return fail("Template not found in this organization.", 404);
  if (!template.active) return fail("Template is not active.", 409);

  const rawBody = draftBodyOverride ?? (template.body as string);
  const subject = draftSubjectOverride ?? (template.subject as string | null) ?? null;
  if (!rawBody || !rawBody.trim()) return fail("The draft body is empty.", 400);

  const binding = await recordBinding({
    organizationId: agent.organization_id,
    sourceApp: "scout",
    paperclipCompanyId,
    paperclipAgentId: agent.paperclip_agent_id,
    objective: `Draft an intro to ${prospect.company_name} for human review.`,
    expectedOutcome: "A comms draft awaiting human review. Nothing is sent.",
    idempotencyKey,
    businessOutputs: { prospect_id: prospect.id, template_id: template.id },
  });

  // Find or create the relationship carrying this prospect in Comms.
  const { data: existingRel, error: relError } = await supabase
    .from("comms_relationships")
    .select("id")
    .eq("organization_id", agent.organization_id)
    .eq("prospect_id", prospect.id)
    .maybeSingle();
  if (relError) throw Object.assign(new Error(relError.message), { status: 500 });

  let relationshipId = (existingRel as { id?: string } | null)?.id ?? null;
  if (!relationshipId) {
    const { data: createdRel, error: createRelError } = await supabase
      .from("comms_relationships")
      .insert({
        organization_id: agent.organization_id,
        prospect_id: prospect.id,
        full_name: prospect.company_name,
        company_name: prospect.company_name,
        source: "scout",
        stage: "ready_to_reach",
        next_action: `Review the Scout intro draft for ${prospect.company_name}.`,
        metadata: {
          scout_draft_intro: {
            prospect_id: prospect.id,
            created_by_agent: agent.paperclip_agent_id,
          },
        },
      })
      .select("id")
      .single();
    if (createRelError) throw Object.assign(new Error(createRelError.message), { status: 500 });
    relationshipId = (createdRel as { id: string }).id;
  }

  const { data: draft, error: draftError } = await supabase
    .from("comms_drafts")
    .insert({
      organization_id: agent.organization_id,
      relationship_id: relationshipId,
      intent: "introduce",
      register: "scout_intro",
      subject,
      body: rawBody,
      review_state: "needs_human_review",
      rationale: {
        source: "scout_agent",
        template_id: template.id,
        template_name: template.name,
        prospect_id: prospect.id,
        agent_id: agent.paperclip_agent_id,
        // Voice policy lives in the app (src/data/voice-policy.ts) and is not
        // ported to Deno. The app MUST re-check voice at approval time.
        voice_checked: false,
        idempotency_key: idempotencyKey,
      },
    })
    .select("id")
    .maybeSingle();
  if (draftError) throw Object.assign(new Error(draftError.message), { status: 500 });
  if (!draft) throw Object.assign(new Error("Draft insert returned no row."), { status: 500 });

  // Only the untouched 'discovered' state advances; human-decided states stay.
  let prospectStatus = prospect.status as string;
  if (prospect.status === "discovered") {
    const { error: statusError } = await supabase
      .from("prospects")
      .update({ status: "ready_for_comms", updated_at: new Date().toISOString() })
      .eq("id", prospect.id)
      .eq("organization_id", agent.organization_id)
      .eq("status", "discovered");
    if (statusError) throw Object.assign(new Error(statusError.message), { status: 500 });
    prospectStatus = "ready_for_comms";
  }

  await completeBinding(binding.id, {
    status: "completed",
    resultSummary: `Drafted an intro to ${prospect.company_name}; waiting for human review.`,
    businessOutputs: {
      draft_id: (draft as { id: string }).id,
      relationship_id: relationshipId,
      prospect_id: prospect.id,
      template_id: template.id,
      review_state: "needs_human_review",
    },
  });

  return json({
    draft_id: (draft as { id: string }).id,
    relationship_id: relationshipId,
    prospect_id: prospect.id,
    prospect_status: prospectStatus,
    review_state: "needs_human_review",
    voice_checked: false,
  });
}

// ------------------------------------------------------------- router

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  // Accept both /scout-execution-capability/scout/<cap> and /scout/<cap>
  const match = url.pathname.match(/\/scout\/(pipeline|icp|prospect|draft-intro)\/?$/);
  if (!match) {
    return fail(
      "Not found. Use /scout/pipeline, /scout/icp, /scout/prospect, or /scout/draft-intro.",
      404,
    );
  }
  const capability = match[1];
  const method = req.method.toUpperCase();

  try {
    if (capability === "pipeline" && method === "GET") return await handlePipeline(req);
    if (capability === "icp" && method === "GET") return await handleIcp(req);
    if (capability === "prospect" && method === "POST") return await handleProspect(req);
    if (capability === "draft-intro" && method === "POST") return await handleDraftIntro(req);
    return fail(`Method ${method} not allowed for /scout/${capability}.`, 405);
  } catch (error) {
    const status =
      error instanceof Error && "status" in error && typeof (error as { status: unknown }).status === "number"
        ? (error as { status: number }).status
: 500;
    return fail(error instanceof Error ? error.message: "Capability call failed.", status);
  }
});
