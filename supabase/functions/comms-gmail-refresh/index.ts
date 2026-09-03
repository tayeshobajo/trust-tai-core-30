/**
 * comms-gmail-refresh. Supabase Edge Function
 *
 * Server-side bridge: decrypts the stored OAuth refresh token (AES-GCM,
 * sealed by the app under COMMS_TOKEN_ENC_KEY) and exchanges it for a
 * fresh Gmail access token.
 *
 * Called by the Comms Agent (service role) and by the app server.
 * Never called from the browser, the access token never leaves the
 * server boundary.
 *
 * Auth: Bearer must be the Supabase service role key. Any other token
 * is rejected immediately.
 *
 * Body: { "organizationId": "<uuid>" }
 * Returns: { "accessToken": "<string>", "expiresAt": "<ISO>" }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ENC_PREFIX = "v1";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

// ----------------------------------------------------------------- crypto

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function aesKey(keyMaterial: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(keyMaterial),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
}

async function openSecret(sealed: string, keyMaterial: string): Promise<string> {
  const parts = sealed.split(".");
  if (parts.length !== 3 || parts[0] !== ENC_PREFIX) {
    throw new Error("Stored credential format is not recognised.");
  }
  const iv = fromBase64(parts[1]!);
  const payload = fromBase64(parts[2]!);
  const opened = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    await aesKey(keyMaterial),
    payload,
  );
  return new TextDecoder().decode(opened);
}

// ----------------------------------------------------------------- handler

Deno.serve(async (req: Request) => {
  // Only POST
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  // Must be service role, checked by comparing the bearer to the env key
  // Accepts either the legacy service-role JWT (COMMS_AGENT_AUTH_KEY) or the
  // platform-injected SUPABASE_SERVICE_ROLE_KEY (new sb_secret_ format).
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const legacyServiceKey = Deno.env.get("COMMS_AGENT_AUTH_KEY");
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const authorized =
    (serviceRoleKey && bearer === serviceRoleKey) ||
    (legacyServiceKey && bearer === legacyServiceKey);
  if (!authorized) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Parse body
  let body: { organizationId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const organizationId = body.organizationId?.trim();
  if (!organizationId) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  // Required env
  const encKey = Deno.env.get("COMMS_TOKEN_ENC_KEY");
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  if (!encKey || !clientId || !clientSecret || !supabaseUrl || !serviceRoleKey) {
    return Response.json(
      { error: "Server is missing required environment variables." },
      { status: 500 },
    );
  }

  // Read integration row + sealed refresh token via service role
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: integration, error: integrationError } = await supabase
.from("comms_integrations")
.select("id, status, account_email")
.eq("organization_id", organizationId)
.eq("provider", "gmail")
.maybeSingle();

  if (integrationError) {
    return Response.json({ error: integrationError.message }, { status: 500 });
  }
  if (!integration) {
    return Response.json({ error: "No Gmail connection found for this organization." }, { status: 404 });
  }

  const row = integration as { id: string; status: string; account_email: string | null };

  if (row.status === "revoked") {
    return Response.json(
      { error: "Gmail token revoked. Tai needs to reconnect at /comms/integrations." },
      { status: 403 },
    );
  }

  // Read sealed token via the system RPC (service-role-only path).
  // The member-facing RPC checks auth.uid() membership, null for service
  // role. This variant is granted to service_role only.
  const rpcUrl = new URL(`${supabaseUrl}/rest/v1/rpc/comms_get_integration_secret_system`);
  const rpcRes = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey!,
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_integration_id: row.id }),
  });
  if (!rpcRes.ok) {
    const detail = await rpcRes.text();
    return Response.json(
      { error: `Secret lookup failed: ${detail.slice(0, 200)}` },
      { status: 500 },
    );
  }
  const sealed = await rpcRes.text();
  if (!sealed || sealed === "null" || sealed === "\"\"") {
    return Response.json(
      { error: "No token stored. Reconnect Gmail at /comms/integrations." },
      { status: 404 },
    );
  }
  // PostgREST returns JSON strings quoted, strip the quotes
  const sealedValue = sealed.startsWith('"') ? JSON.parse(sealed): sealed;

  // Decrypt
  let refreshToken: string;
  try {
    refreshToken = await openSecret(sealedValue, encKey);
  } catch (err) {
    const message = err instanceof Error ? err.message: "Decryption failed.";
    // Mark as revoked so the UI surfaces it clearly
    await supabase
.from("comms_integrations")
.update({ status: "revoked", last_error: message, updated_at: new Date().toISOString() })
.eq("id", row.id);
    return Response.json({ error: `Token decryption failed: ${message}` }, { status: 500 });
  }

  // Exchange with Google
  const tokenRes = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }).toString(),
  });

  const tokenPayload = (await tokenRes.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || tokenPayload.error || !tokenPayload.access_token) {
    const message = tokenPayload.error_description ?? tokenPayload.error ?? "Google refused the token.";
    // If Google says the token is revoked, surface it
    if (tokenPayload.error === "invalid_grant") {
      await supabase
.from("comms_integrations")
.update({ status: "revoked", last_error: message, updated_at: new Date().toISOString() })
.eq("id", row.id);
    }
    return Response.json({ error: message }, { status: 502 });
  }

  const expiresAt = new Date(
    Date.now() + (tokenPayload.expires_in ?? 3600) * 1000,
  ).toISOString();

  // Update last_sync_at on the integration row (non-fatal)
  await supabase
.from("comms_integrations")
.update({ last_sync_at: new Date().toISOString(), status: "connected", last_error: null, updated_at: new Date().toISOString() })
.eq("id", row.id);

  return Response.json({
    accessToken: tokenPayload.access_token,
    expiresAt,
    accountEmail: row.account_email,
  });
});
