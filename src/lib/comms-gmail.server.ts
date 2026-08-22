/**
 * Gmail, read-only (server only).
 *
 * What this is allowed to do: read message metadata for threads Tai has
 * explicitly labeled `Trust Tai/Comms`, and store only the ones with people
 * who are already relationships in Comms.
 *
 * How it reads: label-gated first, identity-matched second. The label id is
 * resolved from Gmail's own label list and constrains every message listing,
 * so unlabeled mail — promotions, newsletters, alerts, even mail with a
 * person Comms knows — never enters the candidate set. The tracked
 * relationship list is then the identity layer that decides what is stored.
 * Labeled mail with someone Comms does not track is counted and left
 * unstored; it is surfaced for review through the mailbox import instead.
 *
 * What it is not allowed to do, by construction:
 *  - send anything (only `gmail.readonly` is ever requested),
 *  - add, rename, or remove Gmail labels (read-only scope; no mutation call
 *    exists here),
 *  - read unlabeled mail, or fall back to whole-mailbox reading when the
 *    label is missing,
 *  - store mail with anyone Comms does not already track, or create a
 *    relationship on its own,
 *  - let a token reach the browser (refresh tokens are sealed at rest and
 *    opened only here),
 *  - act outside the caller's own access (every Supabase read and write is
 *    made with the caller's token, so RLS still applies).
 */

import {
  trustTaiSupabaseKey,
  trustTaiSupabaseUrl,
} from "@/lib/trust-tai-backend.server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { openSecret, sealSecret } from "@/lib/comms-crypto.server";
import { readThread } from "@/data/comms-thread-state";
import {
  GMAIL_READ_SCOPES,
  type NormalizedMessage,
} from "@/domain/comms-integrations";
import { SUITE_EVENTS } from "@/domain/events";
import {
  planDraftVerifications,
  readDraftVerification,
  type ObservedMessageLike,
  type SentDraftLike,
} from "@/domain/comms-verification";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Bounded first read. We never backfill a whole mailbox. */
const DEFAULT_BACKFILL_DAYS = 30;
/**
 * The scheduled pass overlaps its own cadence (every 6 hours) several times
 * over, so nothing is missed and idempotency absorbs the repeats.
 */
const SCHEDULED_BACKFILL_DAYS = 2;
const MAX_MESSAGES_PER_PASS = 60;

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
}

export function gmailConfig(): GmailConfig | null {
  const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function gmailAvailable(): boolean {
  return gmailConfig() !== null;
}

/** The exact callback registered in Google Cloud, derived from this request. */
export function gmailRedirectUri(request: Request): string {
  const configured = process.env["GOOGLE_OAUTH_REDIRECT_URI"];
  if (configured) return configured;
  const url = new URL(request.url);
  return `${url.origin}/api/public/comms/gmail/connect`;
}

export function authorizeUrl(input: { redirectUri: string; state: string }): string {
  const config = gmailConfig();
  if (!config) throw new Error("Gmail is not configured on the server.");
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: [...GMAIL_READ_SCOPES, "openid", "email"].join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: input.state,
  });
  return `${GOOGLE_AUTH}?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const payload = (await response.json()) as TokenResponse;
  if (!response.ok || payload.error) {
    throw new Error(payload.error_description || payload.error || "Google refused that request.");
  }
  return payload;
}

export async function exchangeCode(input: {
  code: string;
  redirectUri: string;
}): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
  const config = gmailConfig();
  if (!config) throw new Error("Gmail is not configured on the server.");
  const payload = await tokenRequest({
    code: input.code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });
  if (!payload.access_token || !payload.refresh_token) {
    throw new Error(
      "Google returned no refresh token. Remove Trust Tai from your Google account permissions and connect again.",
    );
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
  };
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const config = gmailConfig();
  if (!config) throw new Error("Gmail is not configured on the server.");
  const payload = await tokenRequest({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
  if (!payload.access_token) throw new Error("Google did not return an access token.");
  return payload.access_token;
}

/* -------------------------------------------------------------- Gmail read */

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailMessage {
  id?: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
}

async function gmailGet<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gmail returned ${response.status}. ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

function header(message: GmailMessage, name: string): string | undefined {
  const found = (message.payload?.headers ?? []).find(
    (entry) => (entry.name ?? "").toLowerCase() === name.toLowerCase(),
  );
  return found?.value?.trim() || undefined;
}

/** `Tai Smith <tai@x.com>` becomes name and address. Address is lowercased. */
export function parseAddress(raw: string | undefined): { name?: string; email?: string } {
  if (!raw) return {};
  const match = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1]?.trim();
    return {
      ...(name ? { name } : {}),
      email: match[2]!.trim().toLowerCase(),
    };
  }
  const bare = raw.trim().toLowerCase();
  return bare.includes("@") ? { email: bare } : {};
}

function addressList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => parseAddress(entry).email)
    .filter((entry): entry is string => Boolean(entry));
}

function normalize(message: GmailMessage, mailbox: string): NormalizedMessage | null {
  if (!message.id || !message.threadId) return null;
  const from = parseAddress(header(message, "From"));
  const to = addressList(header(message, "To"));
  const cc = addressList(header(message, "Cc"));
  const occurredAt = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : new Date().toISOString();
  return {
    providerMessageId: message.id,
    providerThreadId: message.threadId,
    direction: from.email === mailbox ? "outbound" : "inbound",
    ...(from.email ? { fromEmail: from.email } : {}),
    ...(from.name ? { fromName: from.name } : {}),
    toEmails: to,
    ccEmails: cc,
    ...(header(message, "Subject") ? { subject: header(message, "Subject")! } : {}),
    ...(message.snippet ? { snippet: message.snippet } : {}),
    occurredAt,
  };
}

/* ------------------------------------------------------------- Supabase IO */

function supabaseFor(token: string): SupabaseClient {
  const url =
    trustTaiSupabaseUrl();
  const key =
    trustTaiSupabaseKey();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function requireMember(
  client: SupabaseClient,
  organizationId: string,
): Promise<string> {
  const { data: user, error } = await client.auth.getUser();
  if (error || !user?.user) throw new Error("Sign in to manage connections.");
  const { data: membership, error: membershipError } = await client
    .from("organization_memberships")
    .select("organization_id, user_id, status")
    .eq("organization_id", organizationId)
    .eq("user_id", user.user.id)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership) throw new Error("That workspace is not yours.");
  return user.user.id;
}

/** Store the connection row plus the sealed refresh token. */
export async function saveConnection(input: {
  token: string;
  organizationId: string;
  accountEmail: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: string;
}): Promise<{ integrationId: string }> {
  const client = supabaseFor(input.token);
  const userId = await requireMember(client, input.organizationId);

  const { data: existing } = await client
    .from("comms_integrations")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("provider", "gmail")
    .eq("account_email", input.accountEmail)
    .maybeSingle();

  const row = {
    organization_id: input.organizationId,
    provider: "gmail",
    status: "connected",
    account_email: input.accountEmail,
    scopes: GMAIL_READ_SCOPES,
    last_error: null,
    connected_by: userId,
    updated_at: new Date().toISOString(),
  };

  let integrationId = (existing as { id?: string } | null)?.id;
  if (integrationId) {
    const { error } = await client.from("comms_integrations").update(row).eq("id", integrationId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await client
      .from("comms_integrations")
      .insert({ ...row, cursor: {} })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    integrationId = (data as { id: string }).id;
  }

  const sealed = await sealSecret(input.refreshToken);
  const { error: secretError } = await client.rpc("comms_put_integration_secret", {
    p_integration_id: integrationId,
    p_ciphertext: sealed,
  });
  if (secretError) throw new Error(secretError.message);

  return { integrationId: integrationId! };
}

export async function disconnect(input: {
  token: string;
  organizationId: string;
}): Promise<void> {
  const client = supabaseFor(input.token);
  await requireMember(client, input.organizationId);
  const { error } = await client
    .from("comms_integrations")
    .delete()
    .eq("organization_id", input.organizationId)
    .eq("provider", "gmail");
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------- sync */

export interface SyncResult {
  accountEmail?: string;
  messagesRead: number;
  /** Newly stored this pass — a resync of the same window reports 0. */
  messagesStored: number;
  relationshipsTouched: number;
  skippedUnknownPeople: number;
  /** Inbound messages that entered the suite event stream this pass. */
  eventsEmitted: number;
  /** Sent drafts the mailbox proved this pass. */
  draftsVerified: number;
  lastSyncAt: string;
}

export interface RelationshipRow {
  id: string;
  email: string | null;
  full_name: string;
}

interface ConnectionRef {
  id: string;
  accountEmail: string | null;
}

function clampDays(value: number): number {
  return Math.min(Math.max(value, 1), 90);
}

/* ---------------------------------------------------- label-gated reading */

/**
 * The ingestion boundary, named once. Tai labels a thread in Gmail; Comms
 * reads only what carries this label. Everything unlabeled never enters the
 * candidate set.
 */
export const COMMS_GMAIL_LABEL = "Trust Tai/Comms";

/** The clear, non-destructive status when the boundary is not there. */
export const COMMS_LABEL_MISSING_MESSAGE =
  `The Gmail label "${COMMS_GMAIL_LABEL}" was not found in this mailbox. ` +
  `Create that label in Gmail and apply it to the threads Comms should follow. ` +
  `Comms never falls back to reading unlabeled mail.`;

interface GmailLabel {
  id?: string;
  name?: string;
}

/**
 * The API-native way to respect a nested label name: read the mailbox's own
 * label list and match the full path (`Trust Tai/Comms`), never a free-text
 * `label:` search, which splits on the space and slash. Gmail label names
 * are case-insensitively unique, so the folded fallback can match at most
 * one label.
 */
export function findCommsLabelId(labels: GmailLabel[]): string | null {
  const exact = labels.find((label) => label.name === COMMS_GMAIL_LABEL);
  const found =
    exact ??
    labels.find(
      (label) => (label.name ?? "").toLowerCase() === COMMS_GMAIL_LABEL.toLowerCase(),
    );
  return found?.id ?? null;
}

async function resolveCommsLabelId(accessToken: string): Promise<string | null> {
  const list = await gmailGet<{ labels?: GmailLabel[] }>("/labels", accessToken);
  return findCommsLabelId(list.labels ?? []);
}

/**
 * One labeled page of message ids. `labelIds` is the Gmail-native filter:
 * the label gates first, the overlap window second. No address appears in
 * the query at all — identity is decided after listing, by
 * `findTrackedCounterpart`. Exported so the boundary is provable without a
 * network.
 */
export function buildLabelListPath(input: {
  labelId: string;
  days: number;
  maxResults: number;
  pageToken?: string;
}): string {
  const query = `newer_than:${input.days}d -in:spam -in:trash`;
  const base =
    `/messages?maxResults=${input.maxResults}` +
    `&labelIds=${encodeURIComponent(input.labelId)}` +
    `&q=${encodeURIComponent(query)}`;
  return input.pageToken ? `${base}&pageToken=${encodeURIComponent(input.pageToken)}` : base;
}

/**
 * Which tracked relationship, if any, a message belongs to. Unknown people
 * match nothing: they are counted and dropped, never stored, never turned
 * into relationships.
 */
export function findTrackedCounterpart(
  message: Pick<NormalizedMessage, "fromEmail" | "toEmails" | "ccEmails">,
  mailbox: string,
  byEmail: ReadonlyMap<string, RelationshipRow>,
): RelationshipRow | undefined {
  const counterparts = [message.fromEmail, ...message.toEmails, ...message.ccEmails].filter(
    (entry): entry is string => Boolean(entry) && entry !== mailbox,
  );
  return counterparts.map((email) => byEmail.get(email)).find(Boolean);
}

/**
 * The one suite event an inbound message produces. The key names the exact
 * Gmail message, so a resync of the same message is a no-op even before the
 * database's unique index is asked.
 */
function messageEventKey(organizationId: string, providerMessageId: string): string {
  return `gmail:message_received:${organizationId}:${providerMessageId}`;
}

/**
 * Write `relationship.message_received` for newly observed inbound mail,
 * through the same `activities` envelope every other room uses. Best-effort
 * by design: history matters, never more than the sync itself. Fails closed —
 * if the idempotency column is not there, nothing is guessed and nothing is
 * written twice.
 */
async function emitInboundEvents(
  client: SupabaseClient,
  organizationId: string,
  pending: { relationship: RelationshipRow; message: NormalizedMessage }[],
): Promise<number> {
  if (pending.length === 0) return 0;
  const definition = SUITE_EVENTS.RELATIONSHIP_MESSAGE_RECEIVED;
  const keys = pending.map((entry) =>
    messageEventKey(organizationId, entry.message.providerMessageId),
  );

  const { data: existingRows, error: readError } = await client
    .from("activities")
    .select("source_event_key")
    .eq("organization_id", organizationId)
    .eq("app_key", definition.emittedBy)
    .in("source_event_key", keys);
  if (readError) {
    console.warn(`[comms-gmail] event dedupe read failed, skipping emission: ${readError.message}`);
    return 0;
  }
  const seen = new Set(
    ((existingRows ?? []) as { source_event_key: string | null }[])
      .map((row) => row.source_event_key)
      .filter((key): key is string => Boolean(key)),
  );

  let emitted = 0;
  for (const { relationship, message } of pending) {
    const key = messageEventKey(organizationId, message.providerMessageId);
    if (seen.has(key)) continue;
    const summary = `They wrote: ${message.subject?.trim() || message.snippet?.trim() || "a new email"}`;
    const { error } = await client.from("activities").insert({
      organization_id: organizationId,
      app_key: definition.emittedBy,
      event_type: definition.name,
      actor_user_id: null,
      entity_type: "relationship",
      entity_id: relationship.id,
      summary,
      occurred_at: message.occurredAt,
      source_event_key: key,
      payload: {
        label: relationship.full_name,
        event: definition.name,
        provider: "gmail",
        direction: "inbound",
        provider_message_id: message.providerMessageId,
        source_event_key: key,
        provenance: {
          appId: definition.emittedBy,
          actor: { type: "system", id: "comms-gmail-sync", label: "Gmail sync" },
          observedAt: new Date().toISOString(),
          externalRef: key,
          confidence: "observed",
          dedupe_key: key,
        },
      },
    });
    if (error) {
      // 23505: the unique index says this happening is already recorded.
      if (error.code === "23505") continue;
      console.warn(`[comms-gmail] event write failed for ${key}: ${error.message}`);
      continue;
    }
    emitted += 1;
  }
  return emitted;
}

/**
 * Reconcile human-sent drafts against what the mailbox actually observed.
 * Reads stored outbound mail for the relationship (bounded to the drafts'
 * send windows), applies the deterministic matcher, and stamps each proven
 * draft. The conditional update means a concurrent pass cannot double-stamp.
 */
async function verifySentDrafts(
  client: SupabaseClient,
  organizationId: string,
  relationship: RelationshipRow,
): Promise<number> {
  const { data: draftRows, error: draftError } = await client
    .from("comms_drafts")
    .select("id, subject, body, rationale, updated_at")
    .eq("organization_id", organizationId)
    .eq("relationship_id", relationship.id)
    .eq("review_state", "sent");
  if (draftError) {
    console.warn(`[comms-gmail] draft read failed: ${draftError.message}`);
    return 0;
  }

  const unverified = ((draftRows ?? []) as {
    id: string;
    subject: string | null;
    body: string;
    rationale: Record<string, unknown> | null;
    updated_at: string;
  }[]).filter((row) => !readDraftVerification(row.rationale));
  if (unverified.length === 0) return 0;

  const earliest = unverified
    .map((row) => new Date(row.updated_at).getTime())
    .reduce((left, right) => Math.min(left, right), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(earliest)) return 0;
  const windowStart = new Date(earliest - 2 * 60 * 60 * 1000).toISOString();

  const { data: messageRows, error: messageError } = await client
    .from("comms_messages")
    .select("provider_message_id, direction, occurred_at, subject, snippet, to_emails, cc_emails")
    .eq("organization_id", organizationId)
    .eq("relationship_id", relationship.id)
    .eq("provider", "gmail")
    .eq("direction", "outbound")
    .gte("occurred_at", windowStart)
    .order("occurred_at", { ascending: true })
    .limit(100);
  if (messageError) {
    console.warn(`[comms-gmail] message read failed: ${messageError.message}`);
    return 0;
  }

  const drafts: SentDraftLike[] = unverified.map((row) => ({
    id: row.id,
    ...(row.subject ? { subject: row.subject } : {}),
    body: row.body,
    markedSentAt: row.updated_at,
    ...(relationship.email ? { recipientEmail: relationship.email } : {}),
  }));
  const messages: ObservedMessageLike[] = (
    (messageRows ?? []) as {
      provider_message_id: string;
      direction: string;
      occurred_at: string;
      subject: string | null;
      snippet: string | null;
      to_emails: unknown;
      cc_emails: unknown;
    }[]
  ).map((row) => ({
    providerMessageId: row.provider_message_id,
    direction: row.direction === "outbound" ? "outbound" : "inbound",
    occurredAt: row.occurred_at,
    ...(row.subject ? { subject: row.subject } : {}),
    ...(row.snippet ? { snippet: row.snippet } : {}),
    toEmails: Array.isArray(row.to_emails) ? row.to_emails.map(String) : [],
    ccEmails: Array.isArray(row.cc_emails) ? row.cc_emails.map(String) : [],
  }));

  const plan = planDraftVerifications(drafts, messages);
  let verified = 0;
  for (const entry of plan) {
    const draft = unverified.find((row) => row.id === entry.draftId);
    if (!draft) continue;
    const rationale = {
      ...(draft.rationale ?? {}),
      verification: {
        state: "mailbox_verified",
        provider_message_id: entry.providerMessageId,
        verified_at: new Date().toISOString(),
        matched_by: entry.matchedBy,
      },
    };
    const { error, count } = await client
      .from("comms_drafts")
      .update({ rationale, updated_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", entry.draftId)
      .eq("review_state", "sent")
      .is("rationale->verification", null);
    if (error) {
      console.warn(`[comms-gmail] draft verification write failed: ${error.message}`);
      continue;
    }
    if ((count ?? 0) > 0) verified += 1;
  }
  return verified;
}

/**
 * One incremental pass, shared by the member-invoked read and the scheduled
 * service pass. Label-gated: only threads carrying the `Trust Tai/Comms`
 * label are listed, so unlabeled mail — noise or otherwise — never enters
 * the candidate set or consumes the bounded per-pass cap. Identity is then
 * decided against the tracked relationships: only messages with people
 * already in Comms are stored — idempotently on
 * `(organization, provider, provider_message_id)`. Labeled mail with unknown
 * people is counted and left unstored; the mailbox import surfaces those
 * people for a human Add-to-Comms decision. New inbound mail enters the
 * suite event stream once; sent drafts are reconciled against the mailbox.
 * Every Supabase call goes through the caller-supplied client, so the
 * member path keeps RLS and the scheduled path stays service-role.
 */
async function runSyncPass(input: {
  client: SupabaseClient;
  organizationId: string;
  connection: ConnectionRef;
  accessToken: string;
  backfillDays: number;
}): Promise<SyncResult> {
  const { client, organizationId, connection, accessToken } = input;
  const mailbox = (connection.accountEmail ?? "").toLowerCase();
  const days = clampDays(input.backfillDays);

  // Relationships first: they are the identity layer that decides what may
  // be stored, and an empty tracked set stays a clean no-op.
  const { data: relationshipRows, error: relationshipError } = await client
    .from("comms_relationships")
    .select("id, email, full_name")
    .eq("organization_id", organizationId);
  if (relationshipError) throw new Error(relationshipError.message);
  const byEmail = new Map<string, RelationshipRow>();
  ((relationshipRows ?? []) as RelationshipRow[]).forEach((row) => {
    if (row.email) byEmail.set(row.email.toLowerCase(), row);
  });

  // No tracked people means no Gmail work at all — not even label resolution:
  // a clean no-op that still records the pass on the connection row.
  const ids: string[] = [];
  if (byEmail.size > 0) {
    // The label is the ingestion boundary. If it is not there, fail safe
    // with a clear status — never fall back to whole-mailbox reading.
    const labelId = await resolveCommsLabelId(accessToken);
    if (!labelId) throw new Error(COMMS_LABEL_MISSING_MESSAGE);

    // Labeled mail only, bounded per pass. Pagination continues only while
    // the cap has room; the label keeps noise out, so the cap goes to the
    // threads Tai actually marked for Comms.
    const seenIds = new Set<string>();
    let pageToken: string | undefined;
    do {
      const remaining = MAX_MESSAGES_PER_PASS - ids.length;
      if (remaining <= 0) break;
      const list = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(
        buildLabelListPath({
          labelId,
          days,
          maxResults: remaining,
          ...(pageToken ? { pageToken } : {}),
        }),
        accessToken,
      );
      for (const entry of list.messages ?? []) {
        if (entry.id && !seenIds.has(entry.id)) {
          seenIds.add(entry.id);
          ids.push(entry.id);
        }
      }
      pageToken = list.nextPageToken || undefined;
    } while (pageToken && ids.length < MAX_MESSAGES_PER_PASS);
  }

  let messagesRead = 0;
  let skippedUnknownPeople = 0;
  const perRelationship = new Map<string, { relationship: RelationshipRow; messages: NormalizedMessage[] }>();
  const threadSubjects = new Map<string, string | undefined>();

  for (const id of ids) {
    const raw = await gmailGet<GmailMessage>(
      `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`,
      accessToken,
    );
    messagesRead += 1;
    const message = normalize(raw, mailbox);
    if (!message) continue;

    // The label is the boundary; identity still decides. Labeled mail with
    // someone Comms does not track is counted and left unstored — the
    // mailbox import surfaces that person for a human decision instead.
    const match = findTrackedCounterpart(message, mailbox, byEmail);
    if (!match) {
      skippedUnknownPeople += 1;
      continue;
    }

    const bucket = perRelationship.get(match.id) ?? { relationship: match, messages: [] };
    bucket.messages.push(message);
    perRelationship.set(match.id, bucket);
    threadSubjects.set(message.providerThreadId, message.subject);
  }

  // Which of these the vault has already stored: only genuinely new messages
  // count as stored and only new inbound mail raises an event.
  const candidateIds = [...perRelationship.values()].flatMap((bucket) =>
    bucket.messages.map((message) => message.providerMessageId),
  );
  const existingMessageIds = new Set<string>();
  if (candidateIds.length > 0) {
    const { data: storedRows, error: storedError } = await client
      .from("comms_messages")
      .select("provider_message_id")
      .eq("organization_id", organizationId)
      .eq("provider", "gmail")
      .in("provider_message_id", candidateIds);
    if (storedError) throw new Error(storedError.message);
    ((storedRows ?? []) as { provider_message_id: string }[]).forEach((row) =>
      existingMessageIds.add(row.provider_message_id),
    );
  }

  const nowIso = new Date().toISOString();
  let messagesStored = 0;
  const newInbound: { relationship: RelationshipRow; message: NormalizedMessage }[] = [];

  for (const [relationshipId, bucket] of perRelationship) {
    const { relationship, messages } = bucket;
    const threadIds = new Set(messages.map((message) => message.providerThreadId));

    for (const providerThreadId of threadIds) {
      const threadMessages = messages
        .filter((message) => message.providerThreadId === providerThreadId)
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
      const reading = readThread(threadMessages);

      const { data: existingThread } = await client
        .from("comms_threads")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("provider", "gmail")
        .eq("provider_thread_id", providerThreadId)
        .maybeSingle();

      const threadPayload = {
        organization_id: organizationId,
        relationship_id: relationshipId,
        channel: "email",
        provider: "gmail",
        provider_thread_id: providerThreadId,
        subject: threadSubjects.get(providerThreadId) ?? null,
        state: reading.state,
        last_message_at: reading.lastMessageAt ?? null,
        response_due_at: reading.responseDueAt ?? null,
        updated_at: nowIso,
      };

      let threadId = (existingThread as { id?: string } | null)?.id;
      if (threadId) {
        const { error } = await client.from("comms_threads").update(threadPayload).eq("id", threadId);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await client
          .from("comms_threads")
          .insert(threadPayload)
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        threadId = (data as { id: string }).id;
      }

      const rows = threadMessages.map((message) => ({
        organization_id: organizationId,
        relationship_id: relationshipId,
        thread_id: threadId,
        provider: "gmail",
        provider_message_id: message.providerMessageId,
        provider_thread_id: message.providerThreadId,
        direction: message.direction,
        from_email: message.fromEmail ?? null,
        from_name: message.fromName ?? null,
        to_emails: message.toEmails,
        cc_emails: message.ccEmails,
        subject: message.subject ?? null,
        snippet: message.snippet ?? null,
        occurred_at: message.occurredAt,
        provenance: { source: "gmail", fetched_at: nowIso, mailbox },
      }));

      const { error: upsertError } = await client
        .from("comms_messages")
        .upsert(rows, {
          onConflict: "organization_id,provider,provider_message_id",
          ignoreDuplicates: false,
        });
      if (upsertError) throw new Error(upsertError.message);

      for (const message of threadMessages) {
        if (existingMessageIds.has(message.providerMessageId)) continue;
        messagesStored += 1;
        if (message.direction === "inbound") newInbound.push({ relationship, message });
      }

      await client
        .from("comms_relationships")
        .update({
          last_touch_at: reading.lastMessageAt ?? null,
          response_due_at: reading.responseDueAt ?? null,
          updated_at: nowIso,
        })
        .eq("id", relationshipId);
    }
  }

  const eventsEmitted = await emitInboundEvents(client, organizationId, newInbound);

  let draftsVerified = 0;
  for (const bucket of perRelationship.values()) {
    draftsVerified += await verifySentDrafts(client, organizationId, bucket.relationship);
  }

  const cursor = { last_pass_at: nowIso, backfill_days: days };
  const { error: cursorError } = await client
    .from("comms_integrations")
    .update({
      cursor,
      status: "connected",
      last_error: null,
      last_sync_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", connection.id);
  if (cursorError) throw new Error(cursorError.message);

  return {
    ...(mailbox ? { accountEmail: mailbox } : {}),
    messagesRead,
    messagesStored,
    relationshipsTouched: perRelationship.size,
    skippedUnknownPeople,
    eventsEmitted,
    draftsVerified,
    lastSyncAt: nowIso,
  };
}

/**
 * The member-invoked pass. Every read and write is made with the caller's
 * token, so RLS and the organization boundary still hold.
 */
export async function syncGmail(input: {
  token: string;
  organizationId: string;
  backfillDays?: number;
}): Promise<SyncResult> {
  const client = supabaseFor(input.token);
  await requireMember(client, input.organizationId);

  const { data: connectionRow, error: connectionError } = await client
    .from("comms_integrations")
    .select("id, account_email, cursor")
    .eq("organization_id", input.organizationId)
    .eq("provider", "gmail")
    .maybeSingle();
  if (connectionError) throw new Error(connectionError.message);
  if (!connectionRow) throw new Error("No mailbox is connected yet.");

  const connection = connectionRow as { id: string; account_email: string | null; cursor: unknown };

  const { data: sealed, error: sealedError } = await client.rpc(
    "comms_get_integration_secret",
    { p_integration_id: connection.id },
  );
  if (sealedError) throw new Error(sealedError.message);
  if (!sealed || typeof sealed !== "string") {
    throw new Error("That mailbox needs to be connected again.");
  }

  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(await openSecret(sealed));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google refused the stored access.";
    await client
      .from("comms_integrations")
      .update({ status: "revoked", last_error: message, updated_at: new Date().toISOString() })
      .eq("id", connection.id);
    throw new Error(message);
  }

  return runSyncPass({
    client,
    organizationId: input.organizationId,
    connection: { id: connection.id, accountEmail: connection.account_email },
    accessToken,
    backfillDays: input.backfillDays ?? DEFAULT_BACKFILL_DAYS,
  });
}

/* -------------------------------------------------------- scheduled sync */

/** Service-role client. The sealed-token RPC it calls is granted to it alone. */
function serviceClient(): SupabaseClient {
  const key =
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] || process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) throw new Error("Missing TRUST_TAI_SUPABASE_SERVICE_KEY.");
  // New-format keys are opaque, not JWTs: send apikey, never a bearer of itself.
  const opaque = key.startsWith("sb_");
  return createClient(trustTaiSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(opaque
      ? {
          global: {
            fetch: (request: RequestInfo | URL, init?: RequestInit) => {
              const headers = new Headers(
                typeof Request !== "undefined" && request instanceof Request
                  ? request.headers
                  : undefined,
              );
              new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
              if (headers.get("Authorization") === `Bearer ${key}`) {
                headers.delete("Authorization");
              }
              headers.set("apikey", key);
              return fetch(request, { ...init, headers });
            },
          },
        }
      : {}),
  });
}

export interface ScheduledMailboxResult {
  organizationId: string;
  accountEmail?: string;
  ok: boolean;
  error?: string;
  result?: SyncResult;
}

export interface ScheduledSyncReport {
  mailboxes: number;
  synced: number;
  failed: number;
  results: ScheduledMailboxResult[];
}

/**
 * The scheduled pass over every connected mailbox, run as the service role.
 * Conservative by contract: a short overlapping window, bounded per pass, and
 * a mailbox that fails is marked "Needs attention" with its last successful
 * sync left untouched — failure never erases what was true before.
 */
export async function syncAllConnectedMailboxes(input?: {
  backfillDays?: number;
}): Promise<ScheduledSyncReport> {
  if (!gmailAvailable()) throw new Error("Gmail is not configured on the server.");
  const client = serviceClient();

  const { data: rows, error } = await client
    .from("comms_integrations")
    .select("id, organization_id, account_email")
    .eq("provider", "gmail")
    .eq("status", "connected");
  if (error) throw new Error(error.message);

  const days = clampDays(input?.backfillDays ?? SCHEDULED_BACKFILL_DAYS);
  const results: ScheduledMailboxResult[] = [];

  for (const row of (rows ?? []) as {
    id: string;
    organization_id: string;
    account_email: string | null;
  }[]) {
    const base: ScheduledMailboxResult = {
      organizationId: row.organization_id,
      ...(row.account_email ? { accountEmail: row.account_email } : {}),
      ok: false,
    };
    try {
      const { data: sealed, error: sealedError } = await client.rpc(
        "comms_get_integration_secret_system",
        { p_integration_id: row.id },
      );
      if (sealedError) throw new Error(sealedError.message);
      if (!sealed || typeof sealed !== "string") {
        throw new Error("That mailbox needs to be connected again.");
      }

      let accessToken: string;
      try {
        accessToken = await refreshAccessToken(await openSecret(sealed));
      } catch (refreshError) {
        const message =
          refreshError instanceof Error ? refreshError.message : "Google refused the stored access.";
        await client
          .from("comms_integrations")
          .update({ status: "revoked", last_error: message, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        throw new Error(message);
      }

      const result = await runSyncPass({
        client,
        organizationId: row.organization_id,
        connection: { id: row.id, accountEmail: row.account_email },
        accessToken,
        backfillDays: days,
      });
      results.push({ ...base, ok: true, result });
    } catch (mailboxError) {
      const message = mailboxError instanceof Error ? mailboxError.message : "That read failed.";
      // Revoked is already recorded above; every other failure lands here.
      const { data: current } = await client
        .from("comms_integrations")
        .select("status")
        .eq("id", row.id)
        .maybeSingle();
      if ((current as { status?: string } | null)?.status !== "revoked") {
        await client
          .from("comms_integrations")
          .update({ status: "error", last_error: message, updated_at: new Date().toISOString() })
          .eq("id", row.id);
      }
      results.push({ ...base, error: message });
    }
  }

  return {
    mailboxes: results.length,
    synced: results.filter((entry) => entry.ok).length,
    failed: results.filter((entry) => !entry.ok).length,
    results,
  };
}

/** Which Google account granted access. Read once, at connect time. */
export async function readAccountEmail(accessToken: string): Promise<string> {
  const profile = await gmailGet<{ emailAddress?: string }>("/profile", accessToken);
  const email = profile.emailAddress?.trim().toLowerCase();
  if (!email) throw new Error("Google did not name the mailbox.");
  return email;
}

/* ------------------------------------------------------- import candidates */

export interface MailboxCandidate {
  email: string;
  name?: string;
  messageCount: number;
  lastMessageAt: string;
  lastSubject?: string;
  alreadyTracked: boolean;
}

/**
 * People on threads labeled `Trust Tai/Comms`, read from message metadata
 * only — the "Labeled in Gmail, not yet in Comms" review surface.
 *
 * This stores nothing. It exists so a member can turn one real correspondent
 * into a Comms relationship without typing it out. Addresses already tracked
 * are marked, never hidden, so the list stays honest. The same label
 * boundary as sync applies: unlabeled mail is never read, and a missing
 * label is a clear error, not a whole-mailbox fallback.
 */
export async function listMailboxCandidates(input: {
  token: string;
  organizationId: string;
  backfillDays?: number;
  limit?: number;
}): Promise<{ accountEmail?: string; candidates: MailboxCandidate[] }> {
  const client = supabaseFor(input.token);
  await requireMember(client, input.organizationId);

  const { data: connectionRow, error: connectionError } = await client
    .from("comms_integrations")
    .select("id, account_email")
    .eq("organization_id", input.organizationId)
    .eq("provider", "gmail")
    .maybeSingle();
  if (connectionError) throw new Error(connectionError.message);
  if (!connectionRow) throw new Error("No mailbox is connected yet.");
  const connection = connectionRow as { id: string; account_email: string | null };
  const mailbox = (connection.account_email ?? "").toLowerCase();

  const { data: sealed, error: sealedError } = await client.rpc(
    "comms_get_integration_secret",
    { p_integration_id: connection.id },
  );
  if (sealedError) throw new Error(sealedError.message);
  if (!sealed || typeof sealed !== "string") {
    throw new Error("That mailbox needs to be connected again.");
  }
  const accessToken = await refreshAccessToken(await openSecret(sealed));

  // The same boundary as sync: only labeled threads are read.
  const labelId = await resolveCommsLabelId(accessToken);
  if (!labelId) throw new Error(COMMS_LABEL_MISSING_MESSAGE);

  const days = Math.min(Math.max(input.backfillDays ?? DEFAULT_BACKFILL_DAYS, 1), 90);
  const list = await gmailGet<{ messages?: { id: string }[] }>(
    buildLabelListPath({ labelId, days, maxResults: MAX_MESSAGES_PER_PASS }),
    accessToken,
  );
  const ids = (list.messages ?? []).map((entry) => entry.id).filter(Boolean);

  const { data: relationshipRows } = await client
    .from("comms_relationships")
    .select("email")
    .eq("organization_id", input.organizationId);
  const tracked = new Set(
    ((relationshipRows ?? []) as { email: string | null }[])
      .map((row) => row.email?.toLowerCase())
      .filter((entry): entry is string => Boolean(entry)),
  );

  const found = new Map<string, MailboxCandidate>();
  for (const id of ids) {
    const raw = await gmailGet<GmailMessage>(
      `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      accessToken,
    );
    const message = normalize(raw, mailbox);
    if (!message) continue;

    const people: { email: string; name?: string }[] = [];
    if (message.fromEmail && message.fromEmail !== mailbox) {
      people.push({
        email: message.fromEmail,
        ...(message.fromName ? { name: message.fromName } : {}),
      });
    }
    if (message.direction === "outbound") {
      message.toEmails
        .filter((email) => email !== mailbox)
        .forEach((email) => people.push({ email }));
    }

    for (const person of people) {
      if (/no-?reply|do-?not-?reply|notifications?@|mailer|support@|@google\.com$/i.test(person.email)) {
        continue;
      }
      const existing = found.get(person.email);
      if (existing) {
        existing.messageCount += 1;
        if (message.occurredAt > existing.lastMessageAt) {
          existing.lastMessageAt = message.occurredAt;
          if (message.subject) existing.lastSubject = message.subject;
        }
        if (!existing.name && person.name) existing.name = person.name;
      } else {
        found.set(person.email, {
          email: person.email,
          ...(person.name ? { name: person.name } : {}),
          messageCount: 1,
          lastMessageAt: message.occurredAt,
          ...(message.subject ? { lastSubject: message.subject } : {}),
          alreadyTracked: tracked.has(person.email),
        });
      }
    }
  }

  const candidates = [...found.values()]
    .sort(
      (left, right) =>
        right.messageCount - left.messageCount ||
        right.lastMessageAt.localeCompare(left.lastMessageAt),
    )
    .slice(0, Math.min(Math.max(input.limit ?? 12, 1), 25));

  return { ...(mailbox ? { accountEmail: mailbox } : {}), candidates };
}
