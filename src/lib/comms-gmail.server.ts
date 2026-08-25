/**
 * Gmail, label-gated read plus human-approved send (server only).
 *
 * Multi-mailbox law: mailboxes own transport identity; relationships own
 * memory. A workspace may connect several Gmail accounts — each is one row
 * in `comms_integrations`, keyed by account email, each independently
 * gated on the exact `Trust Tai/Comms` label in its own mailbox. All of
 * them feed the same relationships: the counterpart's email is the identity
 * that decides what is stored, never which mailbox observed it.
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
 * How it sends: it doesn't, from this module. Consent asks for
 * `gmail.readonly` plus `gmail.send`, and the granted set is persisted
 * exactly as Google reports it. Sending lives in the separate send path
 * (`comms-gmail-send.server.ts`) and runs only when a person clicks Send on
 * an approved draft.
 *
 * What it is not allowed to do, by construction:
 *  - send anything on its own (no send call exists here),
 *  - add, rename, or remove Gmail labels (`gmail.modify` is never
 *    requested; no mutation call exists here),
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
  attachmentMetaToJson,
  GMAIL_CONNECTION_SCOPES,
  grantedGmailScopes,
  summarizeMailboxCoverage,
  type AttachmentMeta,
  type MailboxCoverage,
  type NormalizedMessage,
} from "@/domain/comms-integrations";
import { extractEmailBody } from "@/domain/comms-email-body";
import { SUITE_EVENTS } from "@/domain/events";
import {
  planDraftVerifications,
  readDraftVerification,
  type ObservedMessageLike,
  type SentDraftLike,
} from "@/domain/comms-verification";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

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

/**
 * The one production callback. This is the exact Authorized redirect URI
 * Google Cloud must list; production never derives it from the request
 * origin, so a request arriving via any production host lands on the same
 * registered address.
 */
export const GMAIL_PRODUCTION_REDIRECT_URI =
  "https://cmd.trusttai.com/api/public/comms/gmail/connect";

/** The copy shown when Google answers redirect_uri_mismatch. */
export const REDIRECT_URI_MISMATCH_MESSAGE =
  "Google rejected the callback address (redirect_uri_mismatch). In Google Cloud Console " +
  "→ APIs & Services → Credentials → the OAuth 2.0 client, add exactly this Authorized " +
  `redirect URI: ${GMAIL_PRODUCTION_REDIRECT_URI} — then connect again.`;

/** localhost and Lovable preview/dev hosts may derive the callback locally. */
function isPreviewOrigin(origin: string): boolean {
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  const host = origin.replace(/^https?:\/\//, "");
  return host.startsWith("id-preview--") || host.endsWith("-dev.lovable.app");
}

/**
 * The callback used for consent and exchange. `GOOGLE_OAUTH_REDIRECT_URI`
 * wins when explicitly configured; preview/dev origins keep their
 * request-derived callback so local work stays possible; everything else is
 * production and gets the registered production callback, deterministically.
 */
export function gmailRedirectUri(request: Request): string {
  const configured = process.env["GOOGLE_OAUTH_REDIRECT_URI"];
  if (configured) return configured;
  const origin = new URL(request.url).origin;
  if (isPreviewOrigin(origin)) return `${origin}/api/public/comms/gmail/connect`;
  return GMAIL_PRODUCTION_REDIRECT_URI;
}

/**
 * Google's consent URL. Requests label-gated reading plus send, with
 * `prompt=consent` and `include_granted_scopes=true` so reconnecting a
 * read-only connection cleanly upgrades the grant without dropping what
 * was already allowed. `gmail.modify` is never in the request.
 */
export function authorizeUrl(input: { redirectUri: string; state: string }): string {
  const config = gmailConfig();
  if (!config) throw new Error("Gmail is not configured on the server.");
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: [...GMAIL_CONNECTION_SCOPES, "openid", "email"].join(" "),
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
  /** Space-delimited set Google actually granted on this consent. */
  scope?: string;
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
    // A callback mismatch is actionable only in Google Cloud; name the exact
    // URI that must be registered instead of relaying Google's bare code.
    if (payload.error === "redirect_uri_mismatch") {
      throw new Error(REDIRECT_URI_MISMATCH_MESSAGE);
    }
    throw new Error(payload.error_description || payload.error || "Google refused that request.");
  }
  return payload;
}

export async function exchangeCode(input: {
  code: string;
  redirectUri: string;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  /** The Gmail scopes Google actually granted, persisted to the connection row. */
  grantedScopes: string[];
}> {
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
    grantedScopes: grantedGmailScopes(payload.scope),
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
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

/**
 * One MIME part. `format=metadata` carries names, sizes, and handles;
 * `format=full` additionally carries per-part headers (Content-ID,
 * Content-Disposition) and inline body `data` for small parts.
 */
export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id?: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
}

export async function gmailGet<T>(path: string, accessToken: string): Promise<T> {
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

/**
 * Attachment metadata from a message's MIME tree, without the bytes. A part
 * with a filename is a file; containers (`multipart/*`) are walked; an
 * unnamed body part is the message itself, not a file. Gmail stays the source
 * of truth for the bytes — Comms keeps the handle and fetches on demand.
 */
export function extractAttachments(payload: GmailMessage["payload"]): AttachmentMeta[] {
  const found: AttachmentMeta[] = [];
  const walk = (part: GmailPart | undefined) => {
    if (!part) return;
    const filename = part.filename?.trim();
    if (filename && (part.body?.attachmentId || (part.body?.size ?? 0) > 0)) {
      found.push({
        filename,
        mimeType: part.mimeType?.trim() || "application/octet-stream",
        size: part.body?.size ?? 0,
        ...(part.body?.attachmentId ? { attachmentId: part.body.attachmentId } : {}),
      });
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return found;
}

function normalize(message: GmailMessage, mailbox: string): NormalizedMessage | null {
  if (!message.id || !message.threadId) return null;
  const from = parseAddress(header(message, "From"));
  const to = addressList(header(message, "To"));
  const cc = addressList(header(message, "Cc"));
  const occurredAt = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : new Date().toISOString();
  // Full-fidelity extraction: bodies, inline images, ordinary attachments.
  // On a metadata-format payload (mailbox-import discovery) the body fields
  // simply come back absent — discovery stays cheap by construction.
  const extracted = extractEmailBody(message.payload);
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
    ...(extracted.bodyText ? { bodyText: extracted.bodyText } : {}),
    ...(extracted.bodyHtml ? { bodyHtml: extracted.bodyHtml } : {}),
    occurredAt,
    ...(extracted.attachments.length > 0 ? { attachments: extracted.attachments } : {}),
    ...(extracted.inline.length > 0 ? { inlineResources: extracted.inline } : {}),
    ...(extracted.blockedRemoteImages > 0
      ? { blockedRemoteImages: extracted.blockedRemoteImages }
      : {}),
  };
}

/**
 * Which of the synced messages are genuinely new. Only new messages count
 * as stored and only new inbound mail raises an event — a resync enriches
 * an existing row's body and inline metadata without counting it and
 * without re-emitting `relationship.message_received`. Pure; tested.
 */
export function classifySyncedMessages(
  messages: Pick<NormalizedMessage, "providerMessageId" | "direction">[],
  existingIds: ReadonlySet<string>,
): { newCount: number; newInbound: NormalizedMessage[] } {
  const fresh = messages.filter((message) => !existingIds.has(message.providerMessageId));
  return {
    newCount: fresh.length,
    newInbound: fresh.filter((message) => message.direction === "inbound") as NormalizedMessage[],
  };
}

/**
 * One `comms_messages` row from a normalized message. The body columns are
 * the fidelity milestone's addition; attachments and inline resources share
 * the jsonb column (inline entries carry `inline`/`content_id`), and the
 * remote-image refusal count rides in provenance. Pure; tested.
 */
export function buildMessageRow(input: {
  organizationId: string;
  relationshipId: string;
  threadId: string;
  mailbox: string;
  nowIso: string;
  message: NormalizedMessage;
}): Record<string, unknown> {
  const { message } = input;
  const files = [...(message.attachments ?? []), ...(message.inlineResources ?? [])];
  return {
    organization_id: input.organizationId,
    relationship_id: input.relationshipId,
    thread_id: input.threadId,
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
    body_text: message.bodyText ?? null,
    body_html: message.bodyHtml ?? null,
    occurred_at: message.occurredAt,
    provenance: {
      source: "gmail",
      fetched_at: input.nowIso,
      mailbox: input.mailbox,
      ...(message.blockedRemoteImages
        ? { blocked_remote_images: message.blockedRemoteImages }
        : {}),
    },
    attachments: files.map(attachmentMetaToJson),
  };
}

/* ------------------------------------------------------------- Supabase IO */

export function supabaseFor(token: string): SupabaseClient {
  const url =
    trustTaiSupabaseUrl();
  const key =
    trustTaiSupabaseKey();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export async function requireMember(
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

/**
 * The row written to `comms_integrations`. `scopes` is the granted set
 * exactly as Google reported it — never rewritten to read-only, so the
 * send-capability check can tell whether send is actually available.
 */
export function connectionRowFor(
  input: { organizationId: string; accountEmail: string; scopes: string[] },
  userId: string,
) {
  return {
    organization_id: input.organizationId,
    provider: "gmail",
    status: "connected",
    account_email: input.accountEmail,
    scopes: [...input.scopes],
    last_error: null,
    connected_by: userId,
    updated_at: new Date().toISOString(),
  };
}

/** Store the connection row plus the sealed refresh token. */
export async function saveConnection(input: {
  token: string;
  organizationId: string;
  accountEmail: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: string;
  /** The scopes Google granted on this consent — persisted as-is. */
  scopes: string[];
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

  const row = connectionRowFor(
    {
      organizationId: input.organizationId,
      accountEmail: input.accountEmail,
      scopes: input.scopes,
    },
    userId,
  );

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

/**
 * Disconnect one mailbox — the specific connection row, never "the Gmail
 * connection": with several mailboxes connected, the others stay live.
 */
export async function disconnect(input: {
  token: string;
  organizationId: string;
  integrationId: string;
}): Promise<void> {
  const client = supabaseFor(input.token);
  await requireMember(client, input.organizationId);
  const { data, error } = await client
    .from("comms_integrations")
    .delete()
    .eq("id", input.integrationId)
    .eq("organization_id", input.organizationId)
    .eq("provider", "gmail")
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || (data as unknown[]).length === 0) {
    throw new Error("That mailbox is not connected.");
  }
}

/* -------------------------------------------------- connection resolution */

/**
 * Which of a workspace's Gmail connections a member action targets. With
 * one mailbox the answer is automatic; with several, an explicit
 * `integrationId` is required — an action never guesses between mailboxes.
 * Pure; tested.
 */
export type ConnectionPick<T> =
  | { kind: "found"; row: T }
  | { kind: "none" }
  | { kind: "ambiguous"; count: number };

export function pickGmailConnection<T extends { id: string }>(
  rows: T[],
  integrationId?: string,
): ConnectionPick<T> {
  if (integrationId) {
    const found = rows.find((row) => row.id === integrationId);
    return found ? { kind: "found", row: found } : { kind: "none" };
  }
  if (rows.length === 0) return { kind: "none" };
  if (rows.length === 1) return { kind: "found", row: rows[0]! };
  return { kind: "ambiguous", count: rows.length };
}

export interface GmailConnectionRow {
  id: string;
  account_email: string | null;
  scopes: unknown;
  status: string;
  cursor: unknown;
}

/** Every Gmail connection in the workspace, read under the caller's access. */
export async function loadGmailConnections(
  client: SupabaseClient,
  organizationId: string,
): Promise<GmailConnectionRow[]> {
  const { data, error } = await client
    .from("comms_integrations")
    .select("id, account_email, scopes, status, cursor")
    .eq("organization_id", organizationId)
    .eq("provider", "gmail")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as GmailConnectionRow[];
}

/** Resolve the one mailbox a member action targets, or fail with guidance. */
export function requireGmailConnection<T extends { id: string }>(
  rows: T[],
  integrationId?: string,
): T {
  const pick = pickGmailConnection(rows, integrationId);
  if (pick.kind === "found") return pick.row;
  if (pick.kind === "ambiguous") {
    throw new Error("More than one mailbox is connected — choose which one this is for.");
  }
  throw new Error(
    integrationId ? "That mailbox is not connected." : "No mailbox is connected yet.",
  );
}

/* ------------------------------------------------------------------- sync */

export interface SyncResult {
  accountEmail?: string;
  messagesRead: number;
  /** Newly stored this pass — a resync of the same window reports 0. */
  messagesStored: number;
  relationshipsTouched: number;
  skippedUnknownPeople: number;
  /** Distinct labeled correspondents not in Comms yet — the review queue size. */
  pendingPeople: number;
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

/**
 * Every participant address except the mailbox itself, normalized and deduped.
 * Used to count distinct labeled correspondents Comms does not track yet —
 * people, not messages, are the review queue. Exported so the counting rule
 * is provable without a network.
 */
export function counterpartAddresses(message: NormalizedMessage, mailbox: string): string[] {
  const all = [message.fromEmail, ...message.toEmails, ...message.ccEmails]
    .filter((email): email is string => Boolean(email))
    .map((email) => email.toLowerCase());
  return [...new Set(all)].filter((email) => email !== mailbox);
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
export async function verifySentDrafts(
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

  // The label is the ingestion boundary AND the approval, so a workspace with
  // no relationships yet is still read: the first labeled correspondent is
  // exactly how Comms starts. If the label is absent, fail safe with a clear
  // status — never fall back to whole-mailbox reading.
  const ids: string[] = [];
  {
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
  let peopleAdded = 0;
  const resolvedExceptions = new Set<string>();
  const freshExceptions: IntakeException[] = [];
  const perRelationship = new Map<string, { relationship: RelationshipRow; messages: NormalizedMessage[] }>();
  const threadSubjects = new Map<string, string | undefined>();

  for (const id of ids) {
    // Tracked sync reads the full message: the actual body, inline MIME
    // images, and ordinary files — never just Gmail's preview snippet.
    // Discovery (mailbox import) stays metadata-cheap; this pass is bounded
    // by the label and the per-pass cap.
    const raw = await gmailGet<GmailMessage>(`/messages/${id}?format=full`, accessToken);
    messagesRead += 1;
    const message = normalize(raw, mailbox);
    if (!message) continue;

    // The label is the approval. A labeled message with someone Comms
    // already tracks maps to that relationship; a labeled message with
    // someone new brings them in through the canonical create path. Only a
    // thread whose counterpart cannot be resolved safely — or a create that
    // failed — becomes a visible exception.
    let match = findTrackedCounterpart(message, mailbox, byEmail);
    if (!match) {
      const counterpart = resolveIntakeCounterpart(message, mailbox);
      if (counterpart.kind === "none") {
        skippedUnknownPeople += 1;
        continue;
      }
      if (counterpart.kind === "ambiguous") {
        skippedUnknownPeople += 1;
        freshExceptions.push({
          reason: "ambiguous_thread",
          providerMessageId: message.providerMessageId,
          providerThreadId: message.providerThreadId,
          emails: counterpart.emails,
          ...(message.subject ? { subject: message.subject } : {}),
          occurredAt: message.occurredAt,
          observedAt: new Date().toISOString(),
          retryable: false,
          detail: "More than one person is on this labeled thread, so Comms did not guess.",
        });
        continue;
      }
      try {
        const outcome = await ensureLabeledRelationship(client, {
          organizationId,
          email: counterpart.email,
          ...(counterpart.name ? { name: counterpart.name } : {}),
          mailbox,
          providerThreadId: message.providerThreadId,
          providerMessageId: message.providerMessageId,
          occurredAt: message.occurredAt,
        });
        if (outcome.created) peopleAdded += 1;
        match = {
          id: outcome.relationshipId,
          email: outcome.email,
          full_name: outcome.fullName,
        };
        byEmail.set(outcome.email, match);
        resolvedExceptions.add(message.providerMessageId);
      } catch (intakeError) {
        // Never a silent loss: the person stays visible, with a retry.
        skippedUnknownPeople += 1;
        freshExceptions.push({
          reason: "create_failed",
          providerMessageId: message.providerMessageId,
          providerThreadId: message.providerThreadId,
          emails: [counterpart.email],
          ...(message.subject ? { subject: message.subject } : {}),
          occurredAt: message.occurredAt,
          observedAt: new Date().toISOString(),
          retryable: true,
          detail:
            intakeError instanceof Error ? intakeError.message : "That relationship could not be created.",
        });
        continue;
      }
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

      // Upsert keyed on provider message id: a resync of an already-stored
      // message ENRICHES the same row with body and inline metadata instead
      // of duplicating it. Existing snippet-only rows gain their bodies on
      // the next pass.
      const rows = threadMessages.map((message) =>
        buildMessageRow({ organizationId, relationshipId, threadId, mailbox, nowIso, message }),
      );

      // Graceful degradation for schemas that predate the newer columns,
      // newest first: body_html, then body_text, then attachments. A pass
      // degrades what it stores; it never fails for a missing column.
      const ON_CONFLICT = {
        onConflict: "organization_id,provider,provider_message_id",
        ignoreDuplicates: false,
      } as const;
      let currentRows: Record<string, unknown>[] = rows;
      let { error: upsertError } = await client.from("comms_messages").upsert(currentRows, ON_CONFLICT);
      for (const column of ["body_html", "body_text", "attachments"] as const) {
        if (!upsertError || !new RegExp(column, "i").test(upsertError.message)) continue;
        currentRows = currentRows.map(({ [column]: _dropped, ...rest }) => rest);
        ({ error: upsertError } = await client.from("comms_messages").upsert(currentRows, ON_CONFLICT));
      }
      if (upsertError) throw new Error(upsertError.message);

      // Counting is separate from writing: only genuinely new messages count
      // as stored and only new inbound mail raises an event. Enrichment of
      // an existing message is neither.
      const classified = classifySyncedMessages(threadMessages, existingMessageIds);
      messagesStored += classified.newCount;
      for (const message of classified.newInbound) {
        newInbound.push({ relationship, message });
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

  // Exceptions carry across passes: an unresolved ambiguity stays visible,
  // a person who came in this pass leaves the queue, and a repeated sync of
  // the same message replaces rather than duplicates its entry.
  const { data: cursorRow } = await client
    .from("comms_integrations")
    .select("cursor")
    .eq("id", connection.id)
    .maybeSingle();
  const priorCursor =
    (cursorRow as { cursor?: unknown } | null)?.cursor &&
    typeof (cursorRow as { cursor?: unknown }).cursor === "object"
      ? ((cursorRow as { cursor: Record<string, unknown> }).cursor)
      : {};
  const exceptions = mergeIntakeExceptions(
    readIntakeExceptions(priorCursor),
    freshExceptions,
    resolvedExceptions,
  );

  // The persisted ingestion summary the status surface reads back. Counts
  // only — never content — so the card can report the last pass truthfully
  // without touching the mailbox again.
  const cursor = {
    last_pass_at: nowIso,
    backfill_days: days,
    last_run: {
      at: nowIso,
      messages_read: messagesRead,
      messages_stored: messagesStored,
      relationships_touched: perRelationship.size,
      skipped_unknown_people: skippedUnknownPeople,
      people_added: peopleAdded,
      pending_people: exceptions.length,
      events_emitted: eventsEmitted,
      drafts_verified: draftsVerified,
    },
    intake_exceptions: exceptions.map(intakeExceptionToJson),
  };
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
    peopleAdded,
    pendingPeople: exceptions.length,
    eventsEmitted,
    draftsVerified,
    lastSyncAt: nowIso,
  };
}


/**
 * The member-invoked pass over ONE mailbox. Every read and write is made
 * with the caller's token, so RLS and the organization boundary still hold.
 * With several mailboxes connected, `integrationId` names the one to read;
 * with exactly one, it may be omitted.
 */
export async function syncGmail(input: {
  token: string;
  organizationId: string;
  integrationId?: string;
  backfillDays?: number;
}): Promise<SyncResult> {
  const client = supabaseFor(input.token);
  await requireMember(client, input.organizationId);

  const connection = requireGmailConnection(
    await loadGmailConnections(client, input.organizationId),
    input.integrationId,
  );

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
 * People on threads labeled `Trust Tai/Comms` in ONE mailbox, read from
 * message metadata only — the "Labeled in Gmail, not yet in Comms" review
 * surface. Candidate discovery is per mailbox: each connected account is
 * gated on its own label and its own labeled window, and unlabeled mail
 * from any mailbox is never read or merged in.
 *
 * This stores nothing. It exists so a member can turn one real correspondent
 * into a Comms relationship without typing it out. Addresses already tracked
 * are marked, never hidden, so the list stays honest. The same label
 * boundary as sync applies: unlabeled mail is never read, and a missing
 * label is a clear error, not a whole-mailbox fallback.
 *
 * The window stays bounded — at most MAX_MESSAGES_PER_PASS labeled messages,
 * at most 90 days back — but every correspondent discovered inside that
 * window is returned. There is no display cap: the review surface pages the
 * full discovered set, so counts and ranges are always truthful about what
 * the window actually contained.
 */
export async function listMailboxCandidates(input: {
  token: string;
  organizationId: string;
  integrationId?: string;
  backfillDays?: number;
}): Promise<{
  integrationId: string;
  accountEmail?: string;
  candidates: MailboxCandidate[];
  coverage: MailboxCoverage;
}> {
  const client = supabaseFor(input.token);
  await requireMember(client, input.organizationId);

  const connection = requireGmailConnection(
    await loadGmailConnections(client, input.organizationId),
    input.integrationId,
  );
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

  // Coverage and the list describe the same thing: everyone discovered in
  // the bounded labeled window. No display cap — the UI pages this set.
  const coverage = summarizeMailboxCoverage([...found.values()], days);

  const candidates = [...found.values()].sort(
    (left, right) =>
      right.messageCount - left.messageCount ||
      right.lastMessageAt.localeCompare(left.lastMessageAt),
  );

  return {
    integrationId: connection.id,
    ...(mailbox ? { accountEmail: mailbox } : {}),
    candidates,
    coverage,
  };
}
