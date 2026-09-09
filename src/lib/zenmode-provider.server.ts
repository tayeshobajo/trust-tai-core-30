/**
 * ZenMode reachability + analytics provider — server only.
 *
 * Trust Tai never talks to LinkedIn. Under the ZenMode era it talks to
 * ZenMode, the approved transport, over its hosted API
 * (https://www.zen-mode.io/api/v1, Bearer auth). Credentials and the LinkedIn
 * session stay inside ZenMode; this side holds only `ZENMODE_BASE_URL` +
 * `ZENMODE_API_KEY` and nothing else.
 *
 * Architecture law (mirrors linki-provider.server.ts):
 *   - ZenMode is a hand, not the brain. It discovers ICP leads, executes
 *     outreach, and reports replies. Trust Tai owns ICP, identity, judgment,
 *     and the canonical record.
 *   - Server-to-server only. The browser never sees ZenMode, never sees the
 *     key. This module is `.server.ts` and imports nothing browser-facing.
 *   - Fail closed: an unavailable/misconfigured ZenMode means "no data",
 *     never invented leads and never a scrape fallback.
 *   - Reads are CANDIDATES / provenance. Nothing here writes to contacts or
 *     auto-creates canonical identity.
 *
 * Everything is inert unless `ZENMODE_READ_ENABLED === "true"` (default off),
 * exactly like the Linki feature gates.
 */

export const ZENMODE_PROVIDER_ID = "zenmode";

export const ZENMODE_DEFAULT_BASE_URL = "https://www.zen-mode.io/api/v1";

type Env = Record<string, string | undefined>;

export interface ZenModeStatus {
  configured: boolean;
  enabled: boolean;
  baseUrl: string | null;
}

/** A ZenMode lead, normalized to the fields Trust Tai relies on. Extras are
 * preserved verbatim under `raw` so nothing observed is silently dropped. */
export interface ZenModeLead {
  leadId: string;
  campaignId: string | null;
  name: string | null;
  linkedinUrl: string | null;
  companyName: string | null;
  websiteUrl: string | null;
  title: string | null;
  status: string | null;
  raw: Record<string, unknown>;
}

export interface ZenModeConfig {
  baseUrl: string;
  apiKey: string;
}

/** Never logged, never returned to the browser. */
export function zenModeConfig(env: Env = process.env): ZenModeConfig | null {
  const baseUrl = (env["ZENMODE_BASE_URL"] ?? ZENMODE_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = env["ZENMODE_API_KEY"]?.trim();
  const enabled = env["ZENMODE_READ_ENABLED"] === "true";
  if (!enabled || !apiKey) return null;
  return { baseUrl, apiKey };
}

export function zenModeStatus(env: Env = process.env): ZenModeStatus {
  const config = zenModeConfig(env);
  return {
    configured: config !== null,
    enabled: env["ZENMODE_READ_ENABLED"] === "true",
    baseUrl: config?.baseUrl ?? null,
  };
}

/**
 * Shared transport to ZenMode: Bearer auth, JSON, per-call timeout. Returns
 * the parsed JSON body. Fail-closed status mapping: 401/403 mean the key is
 * wrong (thrown, never a silent empty), other non-2xx throw with the remote
 * error when it gave one.
 */
async function zenModeGet(
  path: string,
  config: ZenModeConfig,
  timeoutMs = 30_000,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    let payload: { error?: unknown } | null = null;
    try {
      payload = (await response.clone().json()) as { error?: unknown };
    } catch {
      payload = null;
    }
    const remoteError =
      typeof payload?.error === "string" && payload.error.trim() ? payload.error.trim() : null;

    if (response.status === 401 || response.status === 403) {
      throw new Error("ZenMode rejected the API key (ZENMODE_API_KEY mismatch).");
    }
    if (!response.ok) {
      throw new Error(remoteError ?? `ZenMode ${path} failed (${response.status}).`);
    }
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

/** Coerce a value to a trimmed non-empty string, else null. */
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Normalize one raw ZenMode lead record. ZenMode's field naming is not
 * guaranteed stable, so several documented aliases are accepted; the raw
 * record is always kept. A lead without an id is dropped (nothing to anchor
 * provenance on).
 */
export function normalizeZenModeLead(entry: unknown): ZenModeLead | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const leadId = str(record["lead_id"]) ?? str(record["id"]);
  if (!leadId) return null;
  return {
    leadId,
    campaignId: str(record["campaign_id"]) ?? str(record["campaignId"]),
    name: str(record["name"]) ?? str(record["full_name"]) ?? str(record["fullName"]),
    linkedinUrl: str(record["linkedin_url"]) ?? str(record["linkedinUrl"]),
    companyName: str(record["company_name"]) ?? str(record["company"]) ?? str(record["companyName"]),
    websiteUrl: str(record["website_url"]) ?? str(record["website"]) ?? str(record["websiteUrl"]),
    title: str(record["title"]) ?? str(record["headline"]) ?? str(record["role"]),
    status: str(record["status"]),
    raw: record,
  };
}

/** Pull an array of items out of ZenMode's envelope (either a bare array or
 * `{ data: [...] }` / `{ leads: [...] }`). */
function itemsOf(payload: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of keys) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return [];
}

/**
 * GET /leads — list campaign leads. `status` filters map straight onto the
 * query string. Read-only; returns [] when ZenMode is not configured/enabled.
 */
export async function zenModeListLeads(
  input: { status?: string; campaignId?: string; limit?: number } = {},
  env: Env = process.env,
): Promise<ZenModeLead[]> {
  const config = zenModeConfig(env);
  if (!config) return [];

  const query = new URLSearchParams();
  if (input.status) query.set("status", input.status);
  if (input.campaignId) query.set("campaign_id", input.campaignId);
  if (input.limit) query.set("limit", String(input.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";

  const payload = await zenModeGet(`/leads${suffix}`, config);
  return itemsOf(payload, "leads", "data").flatMap((entry) => {
    const lead = normalizeZenModeLead(entry);
    return lead ? [lead] : [];
  });
}

/** GET /leads/{id}/activity — the activity trail for one lead. Verbatim. */
export async function zenModeLeadActivity(
  leadId: string,
  env: Env = process.env,
): Promise<Record<string, unknown>[]> {
  const config = zenModeConfig(env);
  if (!config) return [];
  const payload = await zenModeGet(`/leads/${encodeURIComponent(leadId)}/activity`, config);
  return itemsOf(payload, "activity", "activities", "data").flatMap((entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? [entry as Record<string, unknown>]
      : [],
  );
}

/** GET /analytics — campaign analytics, returned verbatim. */
export async function zenModeAnalytics(
  env: Env = process.env,
): Promise<Record<string, unknown> | null> {
  const config = zenModeConfig(env);
  if (!config) return null;
  const payload = await zenModeGet(`/analytics`, config);
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

/** GET /status — desktop/session status, returned verbatim. */
export async function zenModeAccountStatus(
  env: Env = process.env,
): Promise<Record<string, unknown> | null> {
  const config = zenModeConfig(env);
  if (!config) return null;
  const payload = await zenModeGet(`/status`, config);
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}
