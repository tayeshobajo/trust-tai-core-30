/**
 * Company identity — managed `company-identity` Edge Function client.
 *
 * The function reads the company's own public website only: an explicitly
 * declared `<meta name="theme-color">`, an Organization-style JSON-LD logo or a
 * declared icon link. No third-party logo service is used and no colour is
 * invented.
 *
 * Enrichment is deliberately non-blocking: every failure resolves to `null` so
 * a research run still saves. Scout never fabricates identity.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import { normalizeThemeColor } from "@/lib/company-identity";
import type { Row } from "./schema";

/** Exactly what is persisted under `metadata.identity`. */
export interface StoredCompanyIdentity extends Row {
  theme_color?: string;
  logo_url?: string;
  logo_source?: string;
  fetched_at?: string;
}

interface IdentityPayload {
  theme_color?: unknown;
  logo_url?: unknown;
  logo_source?: unknown;
  icon_candidates?: unknown;
  website_url?: unknown;
  hostname?: unknown;
  fetched_at?: unknown;
  error?: unknown;
}

function httpsUrl(value: unknown): string | null {
  return typeof value === "string" && /^https:\/\//i.test(value.trim()) ? value.trim() : null;
}

function logoSource(value: unknown): string | null {
  return value === "json_ld" || value === "link_icon" ? value : null;
}

/** Keep only real, validated identity values. Returns null when nothing is real. */
export function toStoredIdentity(payload: IdentityPayload | null): StoredCompanyIdentity | null {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.error === "string" && payload.error.trim()) return null;

  const themeColor = normalizeThemeColor(payload.theme_color);
  const logoUrl = httpsUrl(payload.logo_url);
  if (!themeColor && !logoUrl) return null;

  const source = logoSource(payload.logo_source);
  const fetchedAt =
    typeof payload.fetched_at === "string" && payload.fetched_at.trim()
      ? payload.fetched_at.trim()
      : new Date().toISOString();

  return {
    ...(themeColor ? { theme_color: themeColor } : {}),
    ...(logoUrl ? { logo_url: logoUrl } : {}),
    ...(logoUrl && source ? { logo_source: source } : {}),
    fetched_at: fetchedAt,
  };
}

/**
 * Ask the Edge Function for a company's public identity.
 * Never throws — a failed or empty read simply yields `null`.
 */
export async function fetchCompanyIdentity(
  websiteUrl: string,
): Promise<StoredCompanyIdentity | null> {
  try {
    const { data, error } = await supabase.functions.invoke<IdentityPayload>("company-identity", {
      body: { website_url: websiteUrl },
    });
    if (error) return null;
    return toStoredIdentity(data ?? null);
  } catch {
    return null;
  }
}
