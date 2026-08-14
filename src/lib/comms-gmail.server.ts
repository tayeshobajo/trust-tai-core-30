/**
 * Gmail, read-only (server only).
 *
 * What this is allowed to do: read message metadata for threads with people
 * who are already relationships in Comms, and record who spoke last.
 *
 * What it is not allowed to do, by construction:
 *  - send anything (only `gmail.readonly` is ever requested),
 *  - read mail with anyone Comms does not already track,
 *  - let a token reach the browser (refresh tokens are sealed at rest and
 *    opened only here),
 *  - act outside the caller's own access (every Supabase read and write is
 *    made with the caller's token, so RLS still applies).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { openSecret, sealSecret } from "@/lib/comms-crypto.server";
import { readThread } from "@/data/comms-thread-state";
import {
  GMAIL_READ_SCOPES,
  type NormalizedMessage,
} from "@/domain/comms-integrations";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Bounded first read. We never backfill a whole mailbox. */
const DEFAULT_BACKFILL_DAYS = 30;
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
    process.env["TRUST_TAI_SUPABASE_URL"] ||
    process.env["VITE_SUPABASE_URL"] ||
    "https://okydosoacqdnursmmenf.supabase.co";
  const key =
    process.env["TRUST_TAI_SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    "sb_publishable_uARvNwZli88tfhOHBwFTsQ_JUpQo-UL";
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
  messagesStored: number;
  relationshipsTouched: number;
  skippedUnknownPeople: number;
  lastSyncAt: string;
}

interface RelationshipRow {
  id: string;
  email: string | null;
  full_name: string;
}

/**
 * One incremental pass. Reads recent messages, keeps only the ones with people
 * already tracked in Comms, and stores them idempotently on
 * `(organization, provider, provider_message_id)`.
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
  const mailbox = (connection.account_email ?? "").toLowerCase();

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

  const days = Math.min(Math.max(input.backfillDays ?? DEFAULT_BACKFILL_DAYS, 1), 90);
  const list = await gmailGet<{ messages?: { id: string }[] }>(
    `/messages?maxResults=${MAX_MESSAGES_PER_PASS}&q=${encodeURIComponent(`newer_than:${days}d -in:spam -in:trash`)}`,
    accessToken,
  );
  const ids = (list.messages ?? []).map((entry) => entry.id).filter(Boolean);

  const { data: relationshipRows, error: relationshipError } = await client
    .from("comms_relationships")
    .select("id, email, full_name")
    .eq("organization_id", input.organizationId);
  if (relationshipError) throw new Error(relationshipError.message);
  const byEmail = new Map<string, RelationshipRow>();
  ((relationshipRows ?? []) as RelationshipRow[]).forEach((row) => {
    if (row.email) byEmail.set(row.email.toLowerCase(), row);
  });

  let messagesRead = 0;
  let messagesStored = 0;
  let skippedUnknownPeople = 0;
  const perRelationship = new Map<string, NormalizedMessage[]>();
  const threadSubjects = new Map<string, string | undefined>();

  for (const id of ids) {
    const raw = await gmailGet<GmailMessage>(
      `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`,
      accessToken,
    );
    messagesRead += 1;
    const message = normalize(raw, mailbox);
    if (!message) continue;

    const counterparts = [message.fromEmail, ...message.toEmails, ...message.ccEmails].filter(
      (entry): entry is string => Boolean(entry) && entry !== mailbox,
    );
    const match = counterparts.map((email) => byEmail.get(email)).find(Boolean);
    if (!match) {
      skippedUnknownPeople += 1;
      continue;
    }

    const bucket = perRelationship.get(match.id) ?? [];
    bucket.push(message);
    perRelationship.set(match.id, bucket);
    threadSubjects.set(message.providerThreadId, message.subject);
  }

  const nowIso = new Date().toISOString();

  for (const [relationshipId, messages] of perRelationship) {
    const threadIds = new Set(messages.map((message) => message.providerThreadId));

    for (const providerThreadId of threadIds) {
      const threadMessages = messages
        .filter((message) => message.providerThreadId === providerThreadId)
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
      const reading = readThread(threadMessages);

      const { data: existingThread } = await client
        .from("comms_threads")
        .select("id")
        .eq("organization_id", input.organizationId)
        .eq("provider", "gmail")
        .eq("provider_thread_id", providerThreadId)
        .maybeSingle();

      const threadPayload = {
        organization_id: input.organizationId,
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
        organization_id: input.organizationId,
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

      const { error: upsertError, count } = await client
        .from("comms_messages")
        .upsert(rows, {
          onConflict: "organization_id,provider,provider_message_id",
          ignoreDuplicates: false,
          count: "exact",
        });
      if (upsertError) throw new Error(upsertError.message);
      messagesStored += count ?? rows.length;

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
    lastSyncAt: nowIso,
  };
}

/** Which Google account granted access. Read once, at connect time. */
export async function readAccountEmail(accessToken: string): Promise<string> {
  const profile = await gmailGet<{ emailAddress?: string }>("/profile", accessToken);
  const email = profile.emailAddress?.trim().toLowerCase();
  if (!email) throw new Error("Google did not name the mailbox.");
  return email;
}
