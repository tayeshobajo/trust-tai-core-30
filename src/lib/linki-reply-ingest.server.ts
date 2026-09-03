/**
 * LinkedIn reply ingestion, server only (P3 seam).
 *
 * Linki observes a raw LinkedIn reply and hands Core one
 * `LinkedInReplyObserved` payload. This seam is the ONLY place that payload
 * becomes relationship memory, and it does so under three laws:
 *
 *  1. ONE PERSON, ONE MEMORY, MANY CHANNELS. The sender resolves onto the one
 *     canonical contact (and the one Comms relationship) through the
 *     `linkedin_url` provenance a human confirmed at P1.10. Nothing here ever
 *     creates a contact, a person, or a relationship. An unresolved sender
 *     queues for a human; a false negative is acceptable, a false identity is
 *     not.
 *  2. LINKI IS TRANSPORT. Its identifiers (thread/message refs, sender
 *     profile URL, account ref) ride along as provenance on the touch and the
 *     landing row, never as identity.
 *  3. AUTOMATION ENDS WHERE RELATIONSHIP BEGINS. An ingested reply appends to
 *     the same relationship thread model email uses (channel='linkedin') and
 *     emits the same `relationship.message_received` event Comms already
 *     reads. Nothing here drafts, sends, sequences, or schedules anything.
 *
 * Everything is feature-gated OFF behind `LINKI_REPLY_INGESTION_ENABLED`
 * (default false). No cron, no polling, no route wiring, the caller of this
 * seam decides when a payload exists; the seam decides what it lawfully
 * becomes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { SUITE_EVENTS } from "@/domain/events";
import type { ThreadChannel } from "@/domain/comms";

/** How much of the observed body is kept on the touch summary line. */
export const SUMMARY_MAX_CHARS = 140;

export type LinkiReplyIngestStatus = "pending_resolution" | "resolved" | "rejected";

/** The observed-reply contract, as Linki (transport) delivers it. */
export interface LinkedInReplyObserved {
  organizationId: string;
  source: "linki";
  /** Linki's identifier for the conversation the reply belongs to. */
  externalThreadRef: string;
  /** Linki's identifier for the reply itself. Dedupe key. */
  externalMessageRef: string;
  /** Sender's public profile URL, as carried on the wire. Provenance only. */
  senderLinkedinUrl?: string | undefined;
  /** Sender's LinkedIn member identifier, when Linki captured one. */
  senderExternalId?: string | undefined;
  /** Sender's display name, as observed. Provenance only. */
  senderName?: string | undefined;
  /** The reply text, verbatim. */
  body: string;
  /** The LinkedIn account (in Linki) that observed the reply. */
  accountRef?: string | undefined;
  /** When the reply was observed on the wire. */
  observedAt: string;
  /** Optional raw receipt for audit (full text, extras). */
  payload?: Record<string, unknown> | undefined;
}

export interface LinkiReplyIngestResult {
  status: "ingested" | "duplicate" | "queued" | "disabled";
  /** Landing-row id in linkedin_replies (present unless disabled). */
  replyId?: string | undefined;
  /** Present only when the sender resolved onto exactly one contact. */
  contactId?: string | undefined;
  relationshipId?: string | undefined;
  touchId?: string | undefined;
  /** Present when the sender queued for a human. */
  queueReason?: string | undefined;
}

export interface LinkiReplyIngestEnv {
  LINKI_REPLY_INGESTION_ENABLED?: string | undefined;
}

type Row = Record<string, unknown>;

const INGEST_EVENT_PREFIX = "linki:reply_observed";

function enabled(env: LinkiReplyIngestEnv): boolean {
  return env["LINKI_REPLY_INGESTION_ENABLED"] === "true";
}

/** Display-safe truncation that never cuts mid-word when avoidable. */
export function truncateForSummary(body: string, max = SUMMARY_MAX_CHARS): string {
  const clean = body.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Normalize a LinkedIn profile URL for matching: lowercase host, strip
 * tracking params and trailing slash, so the confirmed route and the observed
 * sender URL compare as the same string. Returns null for non-URL junk.
 */
export function normalizeLinkedinUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let candidate = url.trim().toLowerCase();
  if (!candidate) return null;
  if (!/^https?:\/\//.test(candidate)) candidate = `https://${candidate}`;
  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname.endsWith("linkedin.com")) return null;
    // /in/<vanity>/ is the identity path; strip everything else.
    const match = parsed.pathname.match(/^\/in\/([^/]+)/);
    if (!match) return null;
    return `https://www.linkedin.com/in/${match[1]}`;
  } catch {
    return null;
  }
}

function provenanceFor(input: LinkedInReplyObserved, at: string): Row {
  return {
    app_key: "comms",
    actor: { type: "system", id: "linki-reply-ingest", label: "Linki reply observation" },
    logged_at: at,
    source: "linki",
    channel: "linkedin",
    external_thread_ref: input.externalThreadRef,
    external_message_ref: input.externalMessageRef,
    ...(input.senderExternalId ? { sender_external_id: input.senderExternalId } : {}),
    ...(input.accountRef ? { account_ref: input.accountRef } : {}),
  };
}

function eventKey(organizationId: string, externalMessageRef: string): string {
  return `${INGEST_EVENT_PREFIX}:${organizationId}:${externalMessageRef}`;
}

/* ------------------------------------------------------------ resolution */

export interface ResolutionOutcome {
  contactId: string | null;
  relationshipId: string | null;
  /** Human-readable reason a sender did NOT auto-resolve. */
  queueReason?: string;
}

/**
 * Resolve the sender onto the one canonical contact.
 *
 * The ONLY key is the confirmed `linkedin_url` provenance written at P1.10
 * confirm time: `contacts.metadata.linkedin_url` where
 * `linkedin_confirmed = true` (root metadata or nested under `people`, the
 * same two locations `peopleMetaOf` reads). Exact URL string equality after
 * normalization.
 *
 * - No confirmed contact matches → pending_resolution (human decides).
 * - MORE THAN ONE contact matches → pending_resolution too: a duplicate
 *   provenance in the workspace is ambiguity, not a majority vote.
 * - No sender URL at all → pending_resolution immediately.
 *
 * The relationship is then found through `comms_relationships.contact_id`,
 * newest first. A resolved contact with no relationship still resolves, the
 * reply lands on the contact ledger and the queue carries the gap; nothing
 * here invents a relationship.
 */
export async function resolveSender(
  client: SupabaseClient,
  input: LinkedInReplyObserved,
): Promise<ResolutionOutcome> {
  const senderUrl = normalizeLinkedinUrl(input.senderLinkedinUrl);
  if (!senderUrl) {
    return {
      contactId: null,
      relationshipId: null,
      queueReason: input.senderLinkedinUrl
        ? "The observed sender URL is not a usable LinkedIn profile URL."
        : "The observed reply carried no sender profile URL.",
    };
  }

  // Two exact reads, the two metadata locations peopleMetaOf knows, merged
  // and re-verified in code, so URL spelling and confirmation state resolve
  // deterministically regardless of which location the confirm wrote.
  const reads: { id: string; metadata?: Row | null }[][] = [];
  for (const column of ["metadata->>linkedin_url", "metadata->people->>linkedin_url"]) {
    const { data, error } = await client
      .from("contacts")
      .select("id, metadata")
      .eq("organization_id", input.organizationId)
      .eq(column, senderUrl)
      .limit(10);
    if (error) {
      throw new Error(`Reply resolution could not read contacts: ${error.message}`);
    }
    reads.push((data ?? []) as { id: string; metadata?: Row | null }[]);
  }
  const byId = new Map<string, { id: string; metadata?: Row | null }>();
  for (const rows of reads) for (const row of rows) byId.set(row.id, row);
  const candidates = [...byId.values()];

  const matches = candidates.filter((row) => {
    const meta = peopleMetaOf(row.metadata);
    const confirmed = meta["linkedin_confirmed"] === true || meta["linkedin_confirmed"] === "true";
    const stored = normalizeLinkedinUrl(
      typeof meta["linkedin_url"] === "string" ? meta["linkedin_url"] : null,
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
    .eq("organization_id", input.organizationId)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (relError) {
    throw new Error(`Reply resolution could not read relationships: ${relError.message}`);
  }
  const relationship = ((relationships ?? []) as { id: string }[])[0];
  return { contactId, relationshipId: relationship?.id ?? null };
}

/** Same nested-metadata rule `peopleMetaOf` applies in contacts.ts. */
function peopleMetaOf(metadata: Row | null | undefined): Row {
  if (!metadata) return {};
  const nested = metadata["people"];
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Row)
    : metadata;
}

/* -------------------------------------------------------------- ingestion */

/**
 * The ingestion seam. Idempotent, fail-closed, and inert until the feature
 * flag says otherwise. Returns a structured result; never throws for
 * duplicate delivery or flag-off; throws only when a write it must make
 * fails (the caller retries the SAME payload, dedupe absorbs the replay).
 */
export async function ingestLinkedInReply(
  client: SupabaseClient,
  input: LinkedInReplyObserved,
  env: LinkiReplyIngestEnv = process.env,
): Promise<LinkiReplyIngestResult> {
  if (!enabled(env)) return { status: "disabled" };

  const body = input.body.trim();
  if (!body) throw new Error("An observed reply needs its text.");
  if (!input.externalThreadRef.trim() || !input.externalMessageRef.trim()) {
    throw new Error("An observed reply needs Linki's thread and message refs.");
  }

  // 1) Land the observation first. The unique (source, external_message_ref)
  //    constraint absorbs redelivery as a no-op BEFORE anything else runs.
  const landingError = new Error("The observed reply could not be recorded.");
  const { data: landed, error: insertError } = await client
    .from("linkedin_replies")
    .insert({
      organization_id: input.organizationId,
      source: input.source,
      external_thread_ref: input.externalThreadRef.trim(),
      external_message_ref: input.externalMessageRef.trim(),
      sender_linkedin_url: input.senderLinkedinUrl?.trim() || null,
      sender_external_id: input.senderExternalId?.trim() || null,
      sender_name: input.senderName?.trim() || null,
      body,
      account_ref: input.accountRef?.trim() || null,
      observed_at: input.observedAt,
      payload: input.payload ?? {},
    })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") return { status: "duplicate" };
    throw landingError;
  }
  const replyId = (landed as { id: string }).id;

  // 2) Resolve onto the canonical contact, or queue for a human.
  let resolution: ResolutionOutcome;
  try {
    resolution = await resolveSender(client, input);
  } catch (error) {
    // The observation is landed; the resolution failure is visible on the
    // queue row. Re-throw so the caller's retry hits the dedupe key and
    // resumes at this step rather than double-landing.
    throw error;
  }

  if (!resolution.contactId) {
    const { error: queueError } = await client
      .from("linkedin_replies")
      .update({ status: "pending_resolution", resolution_note: resolution.queueReason ?? null })
      .eq("id", replyId);
    if (queueError) {
      throw new Error(`The unresolved reply could not be queued: ${queueError.message}`);
    }
    return {
      status: "queued",
      replyId,
      queueReason: resolution.queueReason,
    };
  }

  // 3) Append to the SAME relationship thread model email uses.
  //    channel='linkedin', direction='inbound', transport provenance on the
  //    touch. If no relationship exists yet, the reply resolves the CONTACT
  //    (ledger) but parks as pending so a human decides the Comms side.
  if (!resolution.relationshipId) {
    const { error: parkError } = await client
      .from("linkedin_replies")
      .update({
        status: "pending_resolution",
        resolved_contact_id: resolution.contactId,
        resolution_note:
          "The sender resolved to a contact, but no Comms relationship exists yet. A person decides whether to open one.",
      })
      .eq("id", replyId);
    if (parkError) {
      throw new Error(`The resolved reply could not be parked: ${parkError.message}`);
    }
    return {
      status: "queued",
      replyId,
      contactId: resolution.contactId,
      queueReason:
        "Sender resolved to a contact, but no Comms relationship exists yet. A person decides whether to open one.",
    };
  }

  const { data: touch, error: touchError } = await client
    .from("comms_touches")
    .insert({
      organization_id: input.organizationId,
      relationship_id: resolution.relationshipId,
      channel: "linkedin" as ThreadChannel,
      direction: "inbound",
      occurred_at: input.observedAt,
      summary: truncateForSummary(body),
      body,
      provenance: provenanceFor(input, input.observedAt),
      logged_by: null,
    })
    .select("id")
    .single();
  if (touchError) {
    throw new Error(
      `The observed reply could not join the relationship thread: ${touchError.message}`,
    );
  }
  const touchId = (touch as { id: string }).id;

  // Inbound touches start the reply clock, exactly like email ingestion.
  const responseDueAt = new Date(Date.parse(input.observedAt) + 2 * 86_400_000).toISOString();
  const { error: relUpdateError } = await client
    .from("comms_relationships")
    .update({
      last_touch_at: input.observedAt,
      response_due_at: responseDueAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", resolution.relationshipId)
    .eq("organization_id", input.organizationId);
  if (relUpdateError) {
    // The touch is the truth; the denormalized clock is a convenience. Warn,
    // do not fail: a resync recomputes from touches.
    console.warn(
      `[linki-reply-ingest] relationship clock update failed (${resolution.relationshipId}): ${relUpdateError.message}`,
    );
  }

  // 4) Resolve the landing row.
  const { error: resolveError } = await client
    .from("linkedin_replies")
    .update({
      status: "resolved",
      resolved_contact_id: resolution.contactId,
      relationship_id: resolution.relationshipId,
      resolution_note: "Resolved by confirmed LinkedIn route provenance (P1.10).",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", replyId);
  if (resolveError) {
    throw new Error(`The resolved reply could not be stamped: ${resolveError.message}`);
  }

  // 5) The event stream: the SAME judgment hook email replies already feed.
  //    Observation only. Comms reads it; nothing acts on it automatically.
  const definition = SUITE_EVENTS.RELATIONSHIP_MESSAGE_RECEIVED;
  const key = eventKey(input.organizationId, input.externalMessageRef.trim());
  const { error: eventError } = await client.from("activities").insert({
    organization_id: input.organizationId,
    app_key: definition.emittedBy,
    event_type: definition.name,
    actor_user_id: null,
    entity_type: "relationship",
    entity_id: resolution.relationshipId,
    summary: `They wrote on LinkedIn: ${truncateForSummary(body, 100)}`,
    occurred_at: input.observedAt,
    source_event_key: key,
    payload: {
      label: input.senderName?.trim() || "LinkedIn reply",
      event: definition.name,
      source: "linki",
      channel: "linkedin",
      direction: "inbound",
      external_thread_ref: input.externalThreadRef.trim(),
      external_message_ref: input.externalMessageRef.trim(),
      source_event_key: key,
      provenance: {
        appId: definition.emittedBy,
        actor: { type: "system", id: "linki-reply-ingest", label: "Linki reply observation" },
        observedAt: new Date().toISOString(),
        externalRef: key,
        confidence: "observed",
        dedupe_key: key,
      },
    },
  });
  if (eventError && eventError.code !== "23505") {
    // Best-effort by design, same doctrine as the Gmail path: history
    // matters, never more than the ingested reply itself.
    console.warn(`[linki-reply-ingest] event write failed for ${key}: ${eventError.message}`);
  }

  return {
    status: "ingested",
    replyId,
    contactId: resolution.contactId,
    relationshipId: resolution.relationshipId,
    touchId,
  };
}
