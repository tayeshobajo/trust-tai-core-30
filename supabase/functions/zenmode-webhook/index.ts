/**
 * zenmode-webhook — Supabase Edge Function
 *
 * HMAC-verified receiver for ZenMode (the LinkedIn discovery + outreach
 * transport that succeeds Linki for reply observation). This is a faithful
 * Deno port of the server-side ingest seam:
 *   - src/lib/zenmode-reply-ingest.server.ts  (signature + mapping)
 *   - src/lib/linki-reply-ingest.server.ts    (the one lawful ingest path)
 * Edge functions cannot import from src/, so the landing + resolution logic is
 * ported inline here; those modules remain the source of truth and are unit
 * tested. Keep the two in sync.
 *
 * Security contract:
 *   - Header X-ZenMode-Signature = hex HMAC-SHA256 of the RAW request body,
 *     signed with the ZenMode-issued webhook secret (ZENMODE_WEBHOOK_SECRET).
 *     A missing/bad signature is 401 — nothing downstream runs.
 *   - Header X-ZenMode-Event selects the handler.
 *
 * Events:
 *   - lead.replied         → land in public.linkedin_replies (source='zenmode',
 *                            channel=linkedin) and resolve onto the ONE
 *                            human-confirmed contact, or queue for a person.
 *                            NEVER auto-creates a contact.
 *   - task.completed/failed → audit only (public.activities), no side effects.
 *
 * Idempotency: ZenMode can deliver a webhook twice. Replies dedupe on
 * lead_id+replied_at via the unique (source, external_message_ref) constraint;
 * task audits dedupe on task_id via source_event_key. Redelivery is a no-op.
 *
 * Feature-gated OFF: ZENMODE_REPLY_INGESTION_ENABLED must be "true" or the
 * function accepts and acknowledges the webhook without writing (default off).
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("ZENMODE_WEBHOOK_SECRET");
const ORGANIZATION_ID = Deno.env.get("ZENMODE_ORGANIZATION_ID");
const REPLY_INGESTION_ENABLED = Deno.env.get("ZENMODE_REPLY_INGESTION_ENABLED") === "true";

const SUMMARY_MAX_CHARS = 140;

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

/* ------------------------------------------------------------- signature */

const encoder = new TextEncoder();

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time equality over two equal-length hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!WEBHOOK_SECRET || !header) return false;
  const provided = header.trim().toLowerCase().replace(/^sha256=/, "");
  if (!/^[0-9a-f]+$/.test(provided)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  return timingSafeEqualHex(provided, hex(signature));
}

/* --------------------------------------------------------- reply helpers */

function truncateForSummary(body: string, max = SUMMARY_MAX_CHARS): string {
  const clean = body.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Same rule as normalizeLinkedinUrl in linki-reply-ingest.server.ts. */
function normalizeLinkedinUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let candidate = url.trim().toLowerCase();
  if (!candidate) return null;
  if (!/^https?:\/\//.test(candidate)) candidate = `https://${candidate}`;
  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname.endsWith("linkedin.com")) return null;
    const match = parsed.pathname.match(/^\/in\/([^/]+)/);
    if (!match) return null;
    return `https://www.linkedin.com/in/${match[1]}`;
  } catch {
    return null;
  }
}

/** Same nested-metadata rule peopleMetaOf applies. */
function peopleMetaOf(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const nested = metadata["people"];
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : metadata;
}

interface ResolutionOutcome {
  contactId: string | null;
  relationshipId: string | null;
  queueReason?: string;
}

/** Port of resolveSender: resolve onto the one confirmed LinkedIn route. */
async function resolveSender(
  client: SupabaseClient,
  organizationId: string,
  senderLinkedinUrl: string | undefined,
): Promise<ResolutionOutcome> {
  const senderUrl = normalizeLinkedinUrl(senderLinkedinUrl);
  if (!senderUrl) {
    return {
      contactId: null,
      relationshipId: null,
      queueReason: senderLinkedinUrl
        ? "The observed sender URL is not a usable LinkedIn profile URL."
        : "The observed reply carried no sender profile URL.",
    };
  }

  const byId = new Map<string, { id: string; metadata?: Record<string, unknown> | null }>();
  for (const column of ["metadata->>linkedin_url", "metadata->people->>linkedin_url"]) {
    const { data, error } = await client
      .from("contacts")
      .select("id, metadata")
      .eq("organization_id", organizationId)
      .eq(column, senderUrl)
      .limit(10);
    if (error) throw new Error(`Reply resolution could not read contacts: ${error.message}`);
    for (const row of (data ?? []) as { id: string; metadata?: Record<string, unknown> | null }[]) {
      byId.set(row.id, row);
    }
  }

  const matches = [...byId.values()].filter((row) => {
    const meta = peopleMetaOf(row.metadata);
    const confirmed = meta["linkedin_confirmed"] === true || meta["linkedin_confirmed"] === "true";
    const stored = normalizeLinkedinUrl(
      typeof meta["linkedin_url"] === "string" ? (meta["linkedin_url"] as string) : null,
    );
    return confirmed && stored === senderUrl;
  });

  if (matches.length === 0) {
    return {
      contactId: null,
      relationshipId: null,
      queueReason:
        "No confirmed LinkedIn route on record matches the observed sender. A person decides who this is.",
    };
  }
  if (matches.length > 1) {
    return {
      contactId: null,
      relationshipId: null,
      queueReason:
        "More than one contact carries this confirmed LinkedIn route. A person must disambiguate.",
    };
  }

  const contactId = matches[0]!.id;
  const { data: relationships, error: relError } = await client
    .from("comms_relationships")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (relError) throw new Error(`Reply resolution could not read relationships: ${relError.message}`);
  const relationship = ((relationships ?? []) as { id: string }[])[0];
  return { contactId, relationshipId: relationship?.id ?? null };
}

/* ------------------------------------------------------------- handlers */

interface LeadRepliedPayload {
  lead_id?: unknown;
  campaign_id?: unknown;
  name?: unknown;
  linkedin_url?: unknown;
  replied_at?: unknown;
  reply_text?: unknown;
  reply_subject?: unknown;
}

async function handleLeadReplied(payload: LeadRepliedPayload): Promise<Response> {
  if (!ORGANIZATION_ID) {
    return fail("ZENMODE_ORGANIZATION_ID is not configured.", 500);
  }
  const leadId = typeof payload.lead_id === "string" ? payload.lead_id.trim() : "";
  const repliedAt = typeof payload.replied_at === "string" ? payload.replied_at.trim() : "";
  if (!leadId || !repliedAt) {
    return fail("A ZenMode reply needs lead_id and replied_at.", 400);
  }

  const dedupeRef = `${leadId}:${repliedAt}`;
  const senderLinkedinUrl =
    typeof payload.linkedin_url === "string" ? payload.linkedin_url.trim() || undefined : undefined;
  const senderName =
    typeof payload.name === "string" ? payload.name.trim() || undefined : undefined;
  const replyText = typeof payload.reply_text === "string" ? payload.reply_text.trim() : "";
  const replySubject = typeof payload.reply_subject === "string" ? payload.reply_subject.trim() : "";
  const body = replyText || replySubject || "(reply received; ZenMode provided no text)";
  const campaignId = typeof payload.campaign_id === "string" ? payload.campaign_id : null;

  // 1) Land the observation. Unique (source, external_message_ref) absorbs
  //    redelivery as a no-op BEFORE anything else runs.
  const { data: landed, error: insertError } = await supabase
    .from("linkedin_replies")
    .insert({
      organization_id: ORGANIZATION_ID,
      source: "zenmode",
      external_thread_ref: leadId,
      external_message_ref: dedupeRef,
      sender_linkedin_url: senderLinkedinUrl ?? null,
      sender_name: senderName ?? null,
      body,
      observed_at: repliedAt,
      payload: {
        transport: "zenmode",
        lead_id: leadId,
        campaign_id: campaignId,
        replied_at: repliedAt,
        reply_text: replyText || null,
        reply_subject: replySubject || null,
      },
    })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") return json({ status: "duplicate" });
    return fail("The observed reply could not be recorded.", 500);
  }
  const replyId = (landed as { id: string }).id;

  // 2) Resolve onto the canonical contact — or queue for a human.
  const resolution = await resolveSender(supabase, ORGANIZATION_ID, senderLinkedinUrl);

  if (!resolution.contactId) {
    await supabase
      .from("linkedin_replies")
      .update({ status: "pending_resolution", resolution_note: resolution.queueReason ?? null })
      .eq("id", replyId);
    return json({ status: "queued", reply_id: replyId, reason: resolution.queueReason });
  }

  if (!resolution.relationshipId) {
    await supabase
      .from("linkedin_replies")
      .update({
        status: "pending_resolution",
        resolved_contact_id: resolution.contactId,
        resolution_note:
          "The sender resolved to a contact, but no Comms relationship exists yet. A person decides whether to open one.",
      })
      .eq("id", replyId);
    return json({ status: "queued", reply_id: replyId, contact_id: resolution.contactId });
  }

  // 3) Append to the SAME relationship thread email uses, channel='linkedin'.
  const { data: touch, error: touchError } = await supabase
    .from("comms_touches")
    .insert({
      organization_id: ORGANIZATION_ID,
      relationship_id: resolution.relationshipId,
      channel: "linkedin",
      direction: "inbound",
      occurred_at: repliedAt,
      summary: truncateForSummary(body),
      body,
      provenance: {
        app_key: "comms",
        actor: { type: "system", id: "zenmode-reply-ingest", label: "ZenMode reply observation" },
        logged_at: repliedAt,
        source: "zenmode",
        channel: "linkedin",
        external_thread_ref: leadId,
        external_message_ref: dedupeRef,
        campaign_id: campaignId,
      },
      logged_by: null,
    })
    .select("id")
    .single();
  if (touchError) return fail("The observed reply could not join the relationship thread.", 500);
  const touchId = (touch as { id: string }).id;

  const responseDueAt = new Date(Date.parse(repliedAt) + 2 * 86_400_000).toISOString();
  await supabase
    .from("comms_relationships")
    .update({
      last_touch_at: repliedAt,
      response_due_at: responseDueAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", resolution.relationshipId)
    .eq("organization_id", ORGANIZATION_ID);

  await supabase
    .from("linkedin_replies")
    .update({
      status: "resolved",
      resolved_contact_id: resolution.contactId,
      relationship_id: resolution.relationshipId,
      resolution_note: "Resolved by confirmed LinkedIn route provenance (P1.10).",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", replyId);

  // 4) The same judgment hook email replies feed. Observation only.
  const key = `zenmode:reply_observed:${ORGANIZATION_ID}:${dedupeRef}`;
  const { error: eventError } = await supabase.from("activities").insert({
    organization_id: ORGANIZATION_ID,
    app_key: "comms",
    event_type: "relationship.message_received",
    actor_user_id: null,
    entity_type: "relationship",
    entity_id: resolution.relationshipId,
    summary: `They wrote on LinkedIn: ${truncateForSummary(body, 100)}`,
    occurred_at: repliedAt,
    source_event_key: key,
    payload: {
      label: senderName || "LinkedIn reply",
      event: "relationship.message_received",
      source: "zenmode",
      channel: "linkedin",
      direction: "inbound",
      external_thread_ref: leadId,
      external_message_ref: dedupeRef,
      source_event_key: key,
    },
  });
  if (eventError && eventError.code !== "23505") {
    console.warn(`[zenmode-webhook] event write failed for ${key}: ${eventError.message}`);
  }

  return json({
    status: "ingested",
    reply_id: replyId,
    contact_id: resolution.contactId,
    relationship_id: resolution.relationshipId,
    touch_id: touchId,
  });
}

async function handleTaskAudit(event: string, payload: Record<string, unknown>): Promise<Response> {
  if (!ORGANIZATION_ID) return fail("ZENMODE_ORGANIZATION_ID is not configured.", 500);
  const taskId = typeof payload["task_id"] === "string" ? payload["task_id"].trim() : "";
  if (!taskId) return fail("A ZenMode task event needs task_id.", 400);

  // Idempotent on task_id: redelivery collides on source_event_key.
  const key = `zenmode:${event}:${ORGANIZATION_ID}:${taskId}`;
  const { error } = await supabase.from("activities").insert({
    organization_id: ORGANIZATION_ID,
    app_key: "comms",
    event_type: `zenmode.${event}`,
    actor_user_id: null,
    entity_type: "zenmode_task",
    entity_id: null,
    summary: `ZenMode ${event} for task ${taskId}.`,
    occurred_at: new Date().toISOString(),
    source_event_key: key,
    payload: { transport: "zenmode", event, task_id: taskId, ...payload, source_event_key: key },
  });
  if (error && error.code !== "23505") {
    return fail(`ZenMode task audit failed: ${error.message}`, 500);
  }
  return json({ status: error?.code === "23505" ? "duplicate" : "audited", task_id: taskId });
}

/* -------------------------------------------------------------- router */

Deno.serve(async (req: Request) => {
  if (req.method.toUpperCase() !== "POST") {
    return fail("Only POST is accepted.", 405);
  }

  const rawBody = await req.text();
  const ok = await verifySignature(rawBody, req.headers.get("X-ZenMode-Signature"));
  if (!ok) return fail("Invalid ZenMode signature.", 401);

  const event = req.headers.get("X-ZenMode-Event")?.trim() ?? "";
  let payload: Record<string, unknown>;
  try {
    payload = (rawBody ? JSON.parse(rawBody) : {}) as Record<string, unknown>;
  } catch {
    return fail("Malformed JSON body.", 400);
  }

  if (!REPLY_INGESTION_ENABLED) {
    // Verified but disabled: acknowledge without writing (default-off law).
    return json({ status: "disabled", event });
  }

  try {
    if (event === "lead.replied") return await handleLeadReplied(payload as LeadRepliedPayload);
    if (event === "task.completed" || event === "task.failed") {
      return await handleTaskAudit(event, payload);
    }
    return fail(`Unsupported ZenMode event: ${event || "(none)"}.`, 400);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "ZenMode webhook failed.", 500);
  }
});
