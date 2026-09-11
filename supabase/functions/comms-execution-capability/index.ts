/**
 * comms-execution-capability. Supabase Edge Function
 *
 * Governed capability API for the Trust Tai Comms Agent.
 * Mirrors the Scout bridge pattern; all five endpoints enforce:
 *   - execution key auth
 *   - agent identity + capability scope
 *   - cross-org isolation (agent row pins organization_id)
 *
 * Capability map (comms.send is permanently absent):
 *   GET  /comms/relationships         -> comms.read
 *   GET  /comms/threads/:id           -> comms.read
 *   GET  /comms/voice                 -> comms.read_voice
 *   POST /comms/draft                 -> comms.draft
 *   POST /comms/message               -> comms.inject_message
 *   POST /comms/confirm-route         -> comms.confirm_route
 *
 * Governance boundary:
 *   - Comms Agent may read threads and write drafts.
 *   - It may NOT send, NOT contact anyone, NOT modify relationship stage.
 *   - comms.send is permanently off the capability list.
 *   - comms.inject_message = manual touch log only (no outbound send).
 *   - comms.confirm_route asserts that a channel handle belongs to a person.
 *     It is the seam that lets an inbound reply resolve instead of queueing.
 *     It refuses ambiguity rather than guessing, requires a stated basis, and
 *     cannot unconfirm. Granted narrowly: it is the only capability here that
 *     writes identity.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXECUTION_KEY = Deno.env.get("TRUST_TAI_EXECUTION_KEY");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------- helpers

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fail(message: string, status: number): Response {
  return json({ error: message }, status);
}

// ---------------------------------------------------------------- auth

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
    throw Object.assign(
      new Error(`Execution agent ${paperclipAgentId} is not registered.`),
      { status: 403 },
    );
  }
  if (!data.enabled) {
    throw Object.assign(
      new Error(`Execution agent ${paperclipAgentId} is disabled.`),
      { status: 403 },
    );
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

// ---------------------------------------------------------------- handlers

/**
 * GET /comms/relationships
 * Returns all relationships for the agent's org with thread summary state.
 * Requires: comms.read
 */
async function handleRelationships(req: Request): Promise<Response> {
  assertExecutionKey(req);
  const agent = await validateAgent(executionAgentId(req), "comms.read");

  const { data: relationships, error } = await supabase
.from("comms_relationships")
.select(
      "id, full_name, company_name, email, stage, source, last_touch_at, next_action, response_due_at, follow_up_due_at, created_at, updated_at",
    )
.eq("organization_id", agent.organization_id)
.order("updated_at", { ascending: false })
.limit(100);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  // Attach latest thread state per relationship
  const ids = ((relationships ?? []) as { id: string }[]).map((r) => r.id);
  let threadsByRelationship: Record<string, { state: string; last_message_at: string | null; subject: string | null }> = {};

  if (ids.length > 0) {
    const { data: threads } = await supabase
.from("comms_threads")
.select("relationship_id, state, last_message_at, subject")
.in("relationship_id", ids)
.eq("organization_id", agent.organization_id)
.order("updated_at", { ascending: false });
    if (threads) {
      for (const t of threads as Array<{ relationship_id: string; state: string; last_message_at: string | null; subject: string | null }>) {
        // Keep only the most recent thread per relationship
        if (!threadsByRelationship[t.relationship_id]) {
          threadsByRelationship[t.relationship_id] = {
            state: t.state,
            last_message_at: t.last_message_at,
            subject: t.subject,
          };
        }
      }
    }
  }

  const result = (relationships ?? []).map((r: Record<string, unknown>) => ({
...r,
    thread: threadsByRelationship[r["id"] as string] ?? null,
  }));

  return json({ relationships: result, count: result.length });
}

/**
 * GET /comms/threads/:id
 * Returns a single thread with its messages and relationship context.
 * Requires: comms.read
 */
async function handleThread(req: Request, threadId: string): Promise<Response> {
  assertExecutionKey(req);
  const agent = await validateAgent(executionAgentId(req), "comms.read");

  const { data: thread, error: threadError } = await supabase
.from("comms_threads")
.select("*")
.eq("id", threadId)
.eq("organization_id", agent.organization_id)
.maybeSingle();
  if (threadError) throw Object.assign(new Error(threadError.message), { status: 500 });
  if (!thread) return fail("Thread not found.", 404);

  const t = thread as Record<string, unknown>;

  const { data: messages, error: msgError } = await supabase
.from("comms_messages")
.select(
      "id, direction, from_email, from_name, to_emails, subject, snippet, body_text, occurred_at",
    )
.eq("thread_id", threadId)
.eq("organization_id", agent.organization_id)
.order("occurred_at", { ascending: true });
  if (msgError) throw Object.assign(new Error(msgError.message), { status: 500 });

  // Relationship context (observed/decided memory for drafting context)
  const { data: relationship } = await supabase
.from("comms_relationships")
.select(
      "id, full_name, company_name, email, stage, met_where, next_action, observed, decided",
    )
.eq("id", t["relationship_id"] as string)
.eq("organization_id", agent.organization_id)
.maybeSingle();

  return json({
    thread,
    messages: messages ?? [],
    relationship: relationship ?? null,
  });
}

/**
 * GET /comms/voice
 * Returns the current Voice DNA profile for the org.
 * Requires: comms.read_voice
 */
async function handleVoice(req: Request): Promise<Response> {
  assertExecutionKey(req);
  const agent = await validateAgent(executionAgentId(req), "comms.read_voice");

  const { data: voice, error } = await supabase
.from("comms_voice_profiles")
.select("id, content_markdown, version, created_at")
.eq("organization_id", agent.organization_id)
.order("version", { ascending: false })
.limit(1)
.maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  if (!voice) {
    // Return a signal that no custom voice exists yet; agent should use default.
    return json({ voice: null, default: true });
  }

  return json({ voice, default: false });
}

/**
 * POST /comms/draft
 * Write a draft back through the capability boundary.
 * Requires: comms.draft
 *
 * Body: {
 *   relationship_id: string,
 *   intent: string,
 *   register: string,
 *   subject?: string,
 *   body: string,
 *   rationale?: object,
 *   evidence?: array,
 *   voice_version?: number
 * }
 *
 * Governance: review_state is always forced to "needs_human_review".
 * The agent cannot approve its own drafts.
 */
async function handleDraft(req: Request): Promise<Response> {
  assertExecutionKey(req);
  const agent = await validateAgent(executionAgentId(req), "comms.draft");

  const body = (await req.json()) as Record<string, unknown>;
  const relationshipId = typeof body.relationship_id === "string" ? body.relationship_id.trim(): "";
  const threadId = typeof body.thread_id === "string" && body.thread_id.trim() ? body.thread_id.trim(): null;
  const intent = typeof body.intent === "string" ? body.intent.trim(): "";
  const register = typeof body.register === "string" ? body.register.trim(): "follow_up";
  const subject = typeof body.subject === "string" ? body.subject.trim(): null;
  const draftBody = typeof body.body === "string" ? body.body.trim(): "";
  const rationale = (body.rationale && typeof body.rationale === "object" && !Array.isArray(body.rationale))
    ? body.rationale as Record<string, unknown>
: {};
  const evidence = Array.isArray(body.evidence) ? body.evidence: [];
  const voiceVersion = typeof body.voice_version === "number" ? body.voice_version: 1;

  if (!relationshipId || !intent || !draftBody) {
    return fail("relationship_id, intent, and body are required.", 400);
  }

  // Verify relationship belongs to this org
  const { data: relationship, error: relError } = await supabase
.from("comms_relationships")
.select("id, organization_id")
.eq("id", relationshipId)
.eq("organization_id", agent.organization_id)
.maybeSingle();
  if (relError) throw Object.assign(new Error(relError.message), { status: 500 });
  if (!relationship) return fail("Relationship not found in this organization.", 404);

  // If a thread is referenced, it must belong to the same org AND relationship.
  if (threadId) {
    const { data: thread } = await supabase
.from("comms_threads")
.select("id")
.eq("id", threadId)
.eq("organization_id", agent.organization_id)
.eq("relationship_id", relationshipId)
.maybeSingle();
    if (!thread) return fail("Thread not found for this relationship.", 404);
  }

  // Governance: always needs_human_review, agent cannot self-approve
  const { data: draft, error } = await supabase
.from("comms_drafts")
.insert({
      organization_id: agent.organization_id,
      relationship_id: relationshipId,
...(threadId ? { thread_id: threadId }: {}),
      intent,
      register,
      subject,
      body: draftBody,
      voice_version: voiceVersion,
      review_state: "needs_human_review",
      rationale: {
...rationale,
        source: "comms_agent",
        agent_id: agent.paperclip_agent_id,
        written_at: new Date().toISOString(),
      },
      evidence,
      created_by: null, // agent, not a user
    })
.select("id, relationship_id, intent, register, subject, body, review_state, created_at")
.single();
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  return json({ draft, created: true });
}

/**
 * POST /comms/message
 * Inject a message into a thread (manual injection contract).
 * Requires: comms.inject_message
 *
 * Body: {
 *   relationship_id: string,
 *   direction: "inbound" | "outbound",
 *   channel?: string (default email),
 *   subject?: string,
 *   body_text: string,
 *   from_name?: string,
 *   from_email?: string,
 *   occurred_at?: string,
 *   thread_id?: string (find-or-create when omitted)
 * }
 *
 * Governance: This records a message that ALREADY happened, it does NOT send.
 * direction="outbound" means "Tai already sent this; log it".
 */
async function handleInjectMessage(req: Request): Promise<Response> {
  assertExecutionKey(req);
  const agent = await validateAgent(executionAgentId(req), "comms.inject_message");

  const body = (await req.json()) as Record<string, unknown>;
  const relationshipId = typeof body.relationship_id === "string" ? body.relationship_id.trim(): "";
  const channel = typeof body.channel === "string" && body.channel.trim() ? body.channel.trim(): "email";
  const direction = body.direction === "outbound" ? "outbound": "inbound";
  const subject = typeof body.subject === "string" && body.subject.trim() ? body.subject.trim(): null;
  const bodyText = typeof body.body_text === "string" ? body.body_text.trim(): "";
  const fromName = typeof body.from_name === "string" && body.from_name.trim() ? body.from_name.trim(): null;
  const fromEmail = typeof body.from_email === "string" && body.from_email.trim() ? body.from_email.trim(): null;
  const snippet = typeof body.snippet === "string" && body.snippet.trim() ? body.snippet.trim(): bodyText.slice(0, 200);
  const occurredAt =
    typeof body.occurred_at === "string" ? body.occurred_at: new Date().toISOString();
  const inputThreadId = typeof body.thread_id === "string" && body.thread_id.trim() ? body.thread_id.trim(): null;
  const provider = typeof body.provider === "string" && body.provider.trim() ? body.provider.trim(): "manual";
  const providerThreadId = typeof body.provider_thread_id === "string" && body.provider_thread_id.trim() ? body.provider_thread_id.trim(): null;
  const providerMessageId = typeof body.provider_message_id === "string" && body.provider_message_id.trim()
    ? body.provider_message_id.trim()
: `manual-${Date.now()}-${relationshipId.slice(0, 8)}`;

  if (!relationshipId || !bodyText) {
    return fail("relationship_id and body_text are required.", 400);
  }

  // Verify relationship belongs to this org
  const { data: relationship, error: relError } = await supabase
.from("comms_relationships")
.select("id, organization_id, full_name, email")
.eq("id", relationshipId)
.eq("organization_id", agent.organization_id)
.maybeSingle();
  if (relError) throw Object.assign(new Error(relError.message), { status: 500 });
  if (!relationship) return fail("Relationship not found in this organization.", 404);

  const rel = relationship as Record<string, unknown>;

  // Find or create the thread
  let threadId = inputThreadId;
  if (threadId) {
    const { data: thread } = await supabase
.from("comms_threads")
.select("id")
.eq("id", threadId)
.eq("organization_id", agent.organization_id)
.eq("relationship_id", relationshipId)
.maybeSingle();
    if (!thread) return fail("Thread not found for this relationship.", 404);
  } else {
    const { data: existingThread } = await supabase
.from("comms_threads")
.select("id")
.eq("relationship_id", relationshipId)
.eq("organization_id", agent.organization_id)
.order("updated_at", { ascending: false })
.limit(1)
.maybeSingle();
    threadId = (existingThread as { id?: string } | null)?.id ?? null;

    if (!threadId) {
      const { data: created, error: createError } = await supabase
.from("comms_threads")
.insert({
          organization_id: agent.organization_id,
          relationship_id: relationshipId,
          channel,
          state: direction === "inbound" ? "needs_reply": "open",
          subject: subject ?? "Manually injected conversation",
          last_message_at: occurredAt,
          response_due_at: direction === "inbound"
            ? new Date(Date.parse(occurredAt) + 2 * 86_400_000).toISOString()
: null,
        })
.select("id")
.single();
      if (createError) throw Object.assign(new Error(createError.message), { status: 500 });
      threadId = (created as { id: string }).id;
    }
  }

  // Insert the message row (idempotent upsert on org+provider+provider_message_id)
  const { data: message, error } = await supabase
.from("comms_messages")
.upsert(
      {
        organization_id: agent.organization_id,
        relationship_id: relationshipId,
        thread_id: threadId,
        provider,
        provider_message_id: providerMessageId,
        provider_thread_id: providerThreadId,
        direction,
        from_email: fromEmail ?? (direction === "outbound" ? null: (rel["email"] as string | null)),
        from_name: fromName ?? (direction === "outbound" ? "Tai": (rel["full_name"] as string | null)),
        to_emails: direction === "outbound" ? [rel["email"] ?? "tai@trusttai.com"]: ["tai@trusttai.com"],
        cc_emails: [],
        subject,
        snippet,
        body_text: bodyText,
        occurred_at: occurredAt,
        provenance: {
          source: provider === "gmail" ? "gmail_agent_sync": "manual_injection",
          injected_by: "comms_agent",
          agent_id: agent.paperclip_agent_id,
          logged_at: new Date().toISOString(),
        },
      },
      { onConflict: "organization_id,provider,provider_message_id", ignoreDuplicates: true },
    )
.select("id, thread_id, direction, subject, occurred_at")
.maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  // Duplicate (already synced), idempotent no-op. Timing is NOT re-stamped:
  // `last_touch_at` must only move when something actually happened, and a
  // re-delivered webhook is not a new touch.
  if (!message) {
    return json({
      thread_id: threadId,
      relationship_name: rel["full_name"],
      created: false,
      duplicate: true,
    });
  }

  // Update thread state + relationship timing
  const nowIso = new Date().toISOString();
  const threadPatch: Record<string, unknown> = {
    last_message_at: occurredAt,
    updated_at: nowIso,
  };
  if (direction === "inbound") {
    threadPatch["state"] = "needs_reply";
    threadPatch["response_due_at"] = new Date(Date.parse(occurredAt) + 2 * 86_400_000).toISOString();
  } else {
    threadPatch["state"] = "open";
    threadPatch["response_due_at"] = null;
  }
  await supabase
.from("comms_threads")
.update(threadPatch)
.eq("id", threadId)
.eq("organization_id", agent.organization_id);

  const relPatch: Record<string, string | null> = {
    last_touch_at: occurredAt,
    updated_at: nowIso,
  };
  if (direction === "inbound") {
    relPatch["response_due_at"] = new Date(Date.parse(occurredAt) + 2 * 86_400_000).toISOString();
  } else {
    relPatch["response_due_at"] = null;
  }
  await supabase
.from("comms_relationships")
.update(relPatch)
.eq("id", relationshipId)
.eq("organization_id", agent.organization_id);

  return json({
    message,
    thread_id: threadId,
    relationship_name: rel["full_name"],
    created: true,
    duplicate: false,
  });
}

/**
 * POST /comms/confirm-route
 * Record a HUMAN-CONFIRMED channel route (currently LinkedIn) onto a contact, so
 * an inbound reply on that channel can resolve onto a person instead of queueing.
 * Requires: comms.confirm_route
 *
 * Body: {
 *   channel: "linkedin",          // only linkedin today; the shape generalises
 *   profile_url: string,          // the exact URL the reply resolver will match on
 *   full_name: string,
 *   provider: string,             // transport that observed it, e.g. "zenmode"
 *   external_id?: string,
 *   title?: string,
 *   company_name?: string,
 *   prospect_id?: string,
 *   basis: string                 // WHY this is confirmed, in a human's words
 * }
 *
 * Governance — this is the one capability that asserts identity, so it is the
 * strictest:
 *   - It never guesses. If profile_url and full_name point at more than one
 *     contact, it refuses with 409 rather than picking. A false negative is
 *     acceptable; a false identity is not.
 *   - It records `basis` verbatim. A confirmed route with no stated basis is
 *     rejected, because "confirmed" with no reason is indistinguishable from
 *     a guess six months later.
 *   - It is idempotent: re-confirming an identical route is a no-op.
 *   - It cannot unconfirm. Withdrawing a route is a human action in the app.
 */
async function handleConfirmRoute(req: Request): Promise<Response> {
  assertExecutionKey(req);
  const agent = await validateAgent(executionAgentId(req), "comms.confirm_route");

  const body = (await req.json()) as Record<string, unknown>;
  const str = (k: string): string =>
    typeof body[k] === "string" ? (body[k] as string).trim() : "";

  const channel = str("channel") || "linkedin";
  const profileUrl = str("profile_url");
  const fullName = str("full_name");
  const provider = str("provider");
  const basis = str("basis");
  const externalId = str("external_id") || null;
  const title = str("title") || null;
  const companyName = str("company_name") || null;
  const prospectId = str("prospect_id") || null;

  if (channel !== "linkedin") {
    return fail(`Unsupported channel "${channel}". Only linkedin is confirmable today.`, 400);
  }
  if (!profileUrl || !fullName || !provider || !basis) {
    return fail("profile_url, full_name, provider, and basis are all required.", 400);
  }

  // Candidate set: the resolver reads BOTH metadata locations, so we must too.
  // `peopleMetaOf` in src/data/supabase/contacts.ts nests people-owned fields
  // under `metadata.people` for discovery-pipeline rows and keeps them at the
  // metadata root for app-written rows.
  const seen = new Map<string, Record<string, unknown>>();
  for (const column of ["metadata->>linkedin_url", "metadata->people->>linkedin_url"]) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, full_name, metadata")
      .eq("organization_id", agent.organization_id)
      .eq(column, profileUrl)
      .limit(10);
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      seen.set(row["id"] as string, row);
    }
  }

  // No URL match: fall back to an exact, case-insensitive full-name match.
  if (seen.size === 0) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, full_name, metadata")
      .eq("organization_id", agent.organization_id)
      .ilike("full_name", fullName)
      .limit(10);
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      seen.set(row["id"] as string, row);
    }
  }

  if (seen.size > 1) {
    return fail(
      `Ambiguous: ${seen.size} contacts match "${fullName}" / ${profileUrl}. ` +
        "Refusing to guess an identity. Resolve by hand in Comms.",
      409,
    );
  }

  const nowIso = new Date().toISOString();
  const routePatch: Record<string, unknown> = {
    linkedin_url: profileUrl,
    linkedin_confirmed: true,
    linkedin_checked_at: nowIso,
    linkedin_route_confidence: "confirmed",
    linkedin_provider: provider,
    confidence: "human_confirmed",
    note: basis,
    last_edited_at: nowIso,
  };
  if (externalId) routePatch["linkedin_external_id"] = externalId;
  if (companyName) routePatch["company_name"] = companyName;
  if (prospectId) routePatch["prospect_id"] = prospectId;

  const existing = [...seen.values()][0] ?? null;

  if (existing) {
    const metadata = (existing["metadata"] ?? {}) as Record<string, unknown>;
    const nested = metadata["people"];
    const current = (nested && typeof nested === "object" && !Array.isArray(nested)
      ? nested
      : metadata) as Record<string, unknown>;

    // Idempotent: an identical confirmed route is a no-op, not a re-stamp.
    if (current["linkedin_url"] === profileUrl && current["linkedin_confirmed"] === true) {
      return json({
        contact_id: existing["id"],
        full_name: existing["full_name"],
        confirmed: true,
        created: false,
        unchanged: true,
      });
    }

    // Write where the next read will look. Mirrors `mergePeopleMeta`.
    const merged = (nested && typeof nested === "object" && !Array.isArray(nested))
      ? { ...metadata, people: { ...(nested as Record<string, unknown>), ...routePatch } }
      : { ...metadata, ...routePatch };

    const { error } = await supabase
      .from("contacts")
      .update({ metadata: merged })
      .eq("id", existing["id"] as string)
      .eq("organization_id", agent.organization_id);
    if (error) throw Object.assign(new Error(error.message), { status: 500 });

    return json({
      contact_id: existing["id"],
      full_name: existing["full_name"],
      confirmed: true,
      created: false,
      unchanged: false,
    });
  }

  const { data: created, error: createError } = await supabase
    .from("contacts")
    .insert({
      organization_id: agent.organization_id,
      full_name: fullName,
      title,
      metadata: {
        ...routePatch,
        provenance: {
          appId: "comms",
          actor: { type: "agent", id: agent.paperclip_agent_id },
          observedAt: nowIso,
          confidence: "observed",
          externalRef: profileUrl,
        },
      },
      created_by: null, // agent, not a user
    })
    .select("id, full_name")
    .single();
  if (createError) throw Object.assign(new Error(createError.message), { status: 500 });

  return json({
    contact_id: (created as { id: string }).id,
    full_name: (created as { full_name: string }).full_name,
    confirmed: true,
    created: true,
    unchanged: false,
  });
}

// ---------------------------------------------------------------- router

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  // Match /comms/relationships
  if (url.pathname.match(/\/comms\/relationships\/?$/) && method === "GET") {
    return handleRelationships(req).catch(toErrorResponse);
  }

  // Match /comms/threads/:id
  const threadMatch = url.pathname.match(/\/comms\/threads\/([^/]+)\/?$/);
  if (threadMatch && method === "GET") {
    return handleThread(req, threadMatch[1]).catch(toErrorResponse);
  }

  // Match /comms/voice
  if (url.pathname.match(/\/comms\/voice\/?$/) && method === "GET") {
    return handleVoice(req).catch(toErrorResponse);
  }

  // Match /comms/draft
  if (url.pathname.match(/\/comms\/draft\/?$/) && method === "POST") {
    return handleDraft(req).catch(toErrorResponse);
  }

  // Match /comms/message
  if (url.pathname.match(/\/comms\/message\/?$/) && method === "POST") {
    return handleInjectMessage(req).catch(toErrorResponse);
  }

  // Match /comms/confirm-route
  if (url.pathname.match(/\/comms\/confirm-route\/?$/) && method === "POST") {
    return handleConfirmRoute(req).catch(toErrorResponse);
  }

  return fail(
    "Not found. Use /comms/relationships, /comms/threads/:id, /comms/voice, /comms/draft, /comms/message, or /comms/confirm-route.",
    404,
  );
});

function toErrorResponse(error: unknown): Response {
  const status =
    error instanceof Error &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
      ? (error as { status: number }).status
: 500;
  return fail(error instanceof Error ? error.message: "Capability call failed.", status);
}
