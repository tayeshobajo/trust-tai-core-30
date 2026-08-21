/**
 * GA4 and Search Console ingestion (server only).
 *
 * One credential path, chosen because this is an internal operating system and
 * nobody should have to sit through an OAuth screen for a nightly job: a
 * Google service account, signed here into a short lived access token. If the
 * credential values are absent the job reports "not configured" and writes
 * nothing. An absent provider must never read as a day of zero traffic.
 *
 * Values needed, as ordinary deployment secrets:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL        the service account address
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  its PEM private key
 *   GA4_PROPERTY_ID                     numeric GA4 property id
 *   SEARCH_CONSOLE_SITE_URL             the verified property, for example
 *                                       sc-domain:trusttai.com
 */

import {
  GA4_DIMENSIONS,
  GA4_METRICS,
  SEARCH_DIMENSIONS,
  backfillRange,
  ga4PageRows,
  searchConsoleRows,
  type SearchApiRow,
} from "@/data/website/providers";

type Client = { from: (table: string) => any };

const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export interface ProviderRunResult {
  provider: "ga4" | "search_console";
  configured: boolean;
  rowsWritten: number;
  range?: { start: string; end: string };
  error?: string;
}

/* ------------------------------------------------------------- credentials */

function serviceAccount(): { email: string; privateKey: string } | null {
  const rawKey = process.env["GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"]?.trim();
  let email = process.env["GOOGLE_SERVICE_ACCOUNT_EMAIL"]?.trim() ?? "";
  if (!rawKey) return null;

  // The credential value may be the PEM alone or the whole service account
  // JSON file pasted in one piece. Both are accepted, and the JSON carries its
  // own client_email when none was supplied separately.
  let pem = rawKey;
  if (rawKey.startsWith("{")) {
    try {
      const parsed = JSON.parse(rawKey) as { private_key?: string; client_email?: string };
      pem = (parsed.private_key ?? "").trim();
      if (!email) email = (parsed.client_email ?? "").trim();
    } catch {
      return null;
    }
  }
  if (!email || !pem) return null;
  return { email, privateKey: pem.replace(/\\n/g, "\n") };
}


const base64url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Signs a service account assertion and exchanges it for an access token. */
export async function googleAccessToken(scope: string): Promise<string | null> {
  const account = serviceAccount();
  if (!account) return null;

  const now = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const header = base64url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64url(
    encoder.encode(
      JSON.stringify({
        iss: account.email,
        scope,
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  );

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(account.privateKey) as unknown as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(`${header}.${claims}`)),
  );
  const assertion = `${header}.${claims}.${base64url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`Token exchange failed (${response.status}).`);
  const body = (await response.json()) as { access_token?: string };
  return body.access_token ?? null;
}

/* --------------------------------------------------------------------- GA4 */

/** Pulls daily page metrics and writes provider neutral rows. */
export async function syncGa4(
  client: Client,
  organizationId: string,
  days = 7,
): Promise<ProviderRunResult> {
  const property = process.env["GA4_PROPERTY_ID"]?.trim();
  if (!property || !serviceAccount()) {
    return { provider: "ga4", configured: false, rowsWritten: 0 };
  }

  const range = backfillRange(days);
  const token = await googleAccessToken(GA4_SCOPE);
  if (!token) return { provider: "ga4", configured: false, rowsWritten: 0 };

  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: range.start, endDate: range.end }],
        dimensions: GA4_DIMENSIONS.map((name) => ({ name })),
        metrics: GA4_METRICS.map((name) => ({ name })),
        limit: 100_000,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`GA4 read failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
  }

  const rows = ga4PageRows(await response.json(), organizationId);
  await replaceRange(client, "website_page_metrics_daily", organizationId, "ga4", range, rows);
  return { provider: "ga4", configured: true, rowsWritten: rows.length, range };
}

/**
 * The daily tables are keyed by a partial expression index, which Postgres
 * cannot match to an ON CONFLICT target. A day window is therefore rewritten
 * wholesale: delete what the window already holds for this provider, then
 * insert what the provider just reported. Idempotent, and never a partial mix
 * of two runs.
 */
async function replaceRange(
  client: Client,
  table: string,
  organizationId: string,
  provider: string,
  range: { start: string; end: string },
  rows: Record<string, unknown>[],
): Promise<void> {
  const { error: deleteError } = await client
    .from(table)
    .delete()
    .eq("organization_id", organizationId)
    .eq("provider", provider)
    .gte("metric_date", range.start)
    .lte("metric_date", range.end);
  if (deleteError) throw new Error(deleteError.message);

  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await client.from(table).insert(rows.slice(index, index + 500));
    if (error) throw new Error(error.message);
  }
}


/* ---------------------------------------------------------- Search Console */

/** Pulls daily query and page rows and writes provider neutral rows. */
export async function syncSearchConsole(
  client: Client,
  organizationId: string,
  days = 7,
): Promise<ProviderRunResult> {
  const site = process.env["SEARCH_CONSOLE_SITE_URL"]?.trim();
  if (!site || !serviceAccount()) {
    return { provider: "search_console", configured: false, rowsWritten: 0 };
  }

  const range = backfillRange(days);
  const token = await googleAccessToken(GSC_SCOPE);
  if (!token) return { provider: "search_console", configured: false, rowsWritten: 0 };

  const response = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        startDate: range.start,
        endDate: range.end,
        dimensions: [...SEARCH_DIMENSIONS],
        rowLimit: 25_000,
        type: "web",
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Search Console read failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
    );
  }

  const body = (await response.json()) as { rows?: SearchApiRow[] };
  const rows = searchConsoleRows(body.rows ?? [], organizationId);
  if (rows.length > 0) {
    const { error } = await client.from("website_search_metrics_daily").upsert(rows, {
      onConflict: "organization_id,provider,metric_date,query,path,device,country",
    });
    if (error) throw new Error(error.message);
  }
  return { provider: "search_console", configured: true, rowsWritten: rows.length, range };
}
