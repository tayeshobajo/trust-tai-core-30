/**
 * Linki reachability provider — server only.
 *
 * Trust Tai never talks to LinkedIn. It talks to Linki, the approved
 * transport, over the local/private HTTP API (`POST /api/lookup`). Credentials
 * and the LinkedIn session stay inside Linki; this side holds only
 * `LINKI_BASE_URL` + `LINKI_API_KEY` (the internal-secret) and nothing else.
 *
 * Architecture law (integration brief §5, §10):
 *   - Linki is a hand, not the brain. It finds routes; Trust Tai owns ICP,
 *     identity, judgment, and the canonical contact record.
 *   - Server-to-server only. The browser never sees Linki, never sees the key.
 *   - Fail closed: unavailable Linki means "no route found", never a scrape
 *     fallback and never invented candidates.
 *   - Results are CANDIDATES. A candidate becomes canonical only through the
 *     human identity confirmation step (brief §12) — nothing here writes to
 *     contacts.
 */

export const LINKI_PROVIDER_ID = "linki";

export interface LinkiCandidate {
  linkedinUrl: string;
  fullName: string;
  headline: string | null;
  location: string | null;
  degree: string | null;
}

export interface LinkiLookupInput {
  fullName: string;
  companyName?: string;
  companyDomain?: string;
  roleTitle?: string;
  location?: string;
}

export interface LinkiStatus {
  configured: boolean;
  enabled: boolean;
  baseUrl: string | null;
}

type Env = Record<string, string | undefined>;

/** Never logged, never returned to the browser. */
function linkiConfig(env: Env): { baseUrl: string; apiKey: string } | null {
  const baseUrl = (env["LINKI_BASE_URL"] ?? "http://127.0.0.1:3456").replace(/\/+$/, "");
  const apiKey = env["LINKI_API_KEY"]?.trim();
  const enabled = env["LINKI_ENABLED"] !== "false";
  if (!enabled || !apiKey) return null;
  return { baseUrl, apiKey };
}

export function linkiStatus(env: Env = process.env): LinkiStatus {
  const config = linkiConfig(env);
  return {
    configured: config !== null,
    enabled: env["LINKI_ENABLED"] !== "false",
    baseUrl: config?.baseUrl ?? null,
  };
}

/**
 * Build the keyword string a human would type. Company is the strongest
 * disambiguator after the name; domain is noise at search time.
 */
export function buildLookupKeywords(input: LinkiLookupInput): string {
  return [input.fullName, input.companyName, input.roleTitle]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find candidate LinkedIn routes for one person. Read-only: one Linki lookup,
 * no writes anywhere. Throws only on transport failure so the caller can say
 * "route search failed" instead of silently pretending there are no routes.
 */
export async function linkiFindPerson(
  input: LinkiLookupInput,
  env: Env = process.env,
): Promise<LinkiCandidate[]> {
  const config = linkiConfig(env);
  if (!config) return [];

  const keywords = buildLookupKeywords(input);
  if (keywords.length < 2) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${config.baseUrl}/api/lookup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": config.apiKey,
      },
      body: JSON.stringify({ keywords }),
      signal: controller.signal,
    });

    if (response.status === 503) {
      throw new Error("Linki reports the LinkedIn session needs re-authentication.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("Linki rejected the internal secret (LINKI_API_KEY mismatch).");
    }
    if (!response.ok) {
      throw new Error(`Linki lookup failed (${response.status}).`);
    }

    const payload = (await response.json()) as { candidates?: unknown };
    const raw = Array.isArray(payload.candidates) ? payload.candidates : [];
    return raw.flatMap((entry): LinkiCandidate[] => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const url = typeof record["linkedin_url"] === "string" ? record["linkedin_url"] : null;
      const name = typeof record["full_name"] === "string" ? record["full_name"].trim() : null;
      // Same guarantee the Linki route makes: a candidate has a URL and a name.
      if (!url || !/^https:\/\/www\.linkedin\.com\/in\/[^/]+\/?$/.test(url) || !name) return [];
      return [{
        linkedinUrl: url,
        fullName: name,
        headline: typeof record["headline"] === "string" && record["headline"].trim() ? record["headline"].trim() : null,
        location: typeof record["location"] === "string" && record["location"].trim() ? record["location"].trim() : null,
        degree: typeof record["degree"] === "string" && record["degree"].trim() ? record["degree"].trim() : null,
      }];
    });
  } finally {
    clearTimeout(timer);
  }
}
