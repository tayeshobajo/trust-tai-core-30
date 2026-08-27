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
 *
 * Matching doctrine (P1.10 fix, 2026-08-26): the NAME is the only search
 * token. Company/title/location/domain polluted the keyword string and made
 * LinkedIn return wrong-person candidates. They are now RANKING EVIDENCE
 * ONLY, consumed by rankCandidates() after the name search returns.
 */

export const LINKI_PROVIDER_ID = "linki";

export interface LinkiCandidate {
  linkedinUrl: string;
  fullName: string;
  headline: string | null;
  location: string | null;
  degree: string | null;
  company: string | null;
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
 * Normalize a person's name for LinkedIn search:
 *   - NFKC first (compatibility composition: full-width → ASCII, ligatures →
 *     plain letters, etc.)
 *   - every Unicode dash/hyphen variant → ASCII hyphen (NFKC maps U+2011 to
 *     U+2010, another non-ASCII hyphen — so all variants are collapsed AFTER
 *     normalization; LinkedIn search treats them differently from "-")
 *   - collapse all whitespace runs to single spaces
 * This is the P1.10 fix: keyword pollution (company/title/location glued to
 * the name) returned wrong-person results. The name is the ONLY search token.
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The keyword string sent to Linki: NAME ONLY, normalized. Company, title,
 * location, and domain are never search tokens — they are ranking evidence in
 * rankCandidates() below.
 */
export function buildLookupKeywords(input: LinkiLookupInput): string {
  return normalizeName(input.fullName ?? "");
}

/**
 * Ranked candidate for display. `why` is the human-readable evidence trail
 * ("Why this may be the person"). `nameSimilarity` is kept for tests and
 * ordering transparency, never persisted anywhere.
 */
export interface RankedLinkiCandidate extends LinkiCandidate {
  score: number;
  why: string[];
  nameSimilarity: number;
}

/** Tokens used for evidence overlap: lowercase, alphanumeric words, ≥3 chars. */
function tokenize(value: string | null | undefined): string[] {
  if (!value) return [];
  return (value.toLowerCase().match(/[a-z0-9][a-z0-9&'’.-]*/g) ?? []).filter((t) => t.length >= 3);
}

/** Strip corporate suffix noise so "Acme Insurance Group" overlaps "Acme". */
const CORPORATE_SUFFIXES = new Set([
  "inc", "llc", "ltd", "limited", "co", "corp", "corporation", "company",
  "group", "holdings", "partners", "solutions", "services", "the",
]);

function companyTokens(value: string | null | undefined): string[] {
  return tokenize(value).filter((t) => !CORPORATE_SUFFIXES.has(t));
}

/**
 * Name similarity in [0,1]: 1 when the token sets are identical (order
 * ignored), scaled by overlap otherwise. Hyphens are separators — LinkedIn
 * normalizes "Anne-Marie" and "Anne Marie" the same way in profile URLs.
 */
function nameSimilarity(a: string, b: string): number {
  const split = (v: string) =>
    normalizeName(v).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  const ta = split(a);
  const tb = split(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  const shared = ta.filter((t) => setB.has(t)).length;
  return shared / Math.max(ta.length, tb.length);
}

/**
 * Human identity gate for multi-part names: the visible first and last name
 * must agree before company/title evidence can help. This blocks false
 * positives like "Jonathan Muller" for "Jonathan Mull" and fabricated names
 * that share only one token.
 */
function hasStrongHumanNameMatch(a: string, b: string): boolean {
  const split = (v: string) =>
    normalizeName(v).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  const ta = split(a);
  const tb = split(b);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta.length === 1 || tb.length === 1) return ta[0] === tb[0];
  return ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1];
}

/** Evidence overlap between a candidate's card text and one reference field. */
function overlap(haystackTokens: string[], reference: string[]): string[] {
  const ref = new Set(reference);
  return [...new Set(haystackTokens.filter((t) => ref.has(t)))];
}

export const NO_CONFIDENT_MATCH_REASON = "No confident LinkedIn match found";

/**
 * Rank raw candidates against the person we are looking for.
 *
 * Evidence (all optional, all additive):
 *   +2.0 per matched company token (company name / candidate company field)
 *   +1.5 per matched role-title token (title vs headline)
 *   +0.75 per matched location token
 *   +0.5 per matched domain root (acme.com → "acme") anywhere on the card
 *   + name similarity × 1.0 (identity anchor — a very different name can
 *     never rank top on evidence alone)
 *
 * FAIL CLOSED: a candidate must (a) fuzzy-match the name (similarity ≥ 0.5)
 * AND (b) score ≥ 1.5 to be offered — strictly above the 1.0 a perfect name
 * match alone earns, so at least one real piece of evidence (company, role,
 * location, or domain) is required. Otherwise the result is an empty list
 * with the explicit no-match reason. Nothing is ever auto-picked, and ranking
 * is display-order only — a human still confirms identity.
 */
export function rankCandidates(
  person: LinkiLookupInput,
  candidates: LinkiCandidate[],
): { ranked: RankedLinkiCandidate[]; noMatchReason: string | null } {
  const companyRef = companyTokens(person.companyName);
  const titleRef = tokenize(person.roleTitle);
  const locationRef = tokenize(person.location);
  const domainRoot = person.companyDomain
    ? (person.companyDomain.toLowerCase().replace(/^www\./, "").split(".")[0] ?? "")
    : "";

  const ranked: RankedLinkiCandidate[] = [];
  for (const candidate of candidates) {
    const similarity = nameSimilarity(person.fullName, candidate.fullName);
    if (similarity < 0.5 || !hasStrongHumanNameMatch(person.fullName, candidate.fullName)) {
      continue; // wrong-person shield: first/last human name must still agree
    }

    const cardCompany = companyTokens(candidate.company);
    const cardHeadline = tokenize(candidate.headline);
    const cardLocation = tokenize(candidate.location);
    const cardAll = [...cardHeadline, ...cardCompany, ...cardLocation];

    const why: string[] = [];
    let score = similarity; // identity anchor

    const companyHits = overlap(cardCompany.length ? cardCompany : cardHeadline, companyRef);
    if (companyHits.length > 0) {
      score += companyHits.length * 2;
      why.push(`Company match: ${companyHits.join(", ")}`);
    }
    const titleHits = overlap(cardHeadline, titleRef);
    if (titleHits.length > 0) {
      score += titleHits.length * 1.5;
      why.push(`Role match: ${titleHits.join(", ")}`);
    }
    const locationHits = overlap(cardLocation, locationRef);
    if (locationHits.length > 0) {
      score += locationHits.length * 0.75;
      why.push(`Location match: ${locationHits.join(", ")}`);
    }
    if (domainRoot.length >= 3 && cardAll.includes(domainRoot)) {
      score += 0.5;
      why.push(`Website match: ${domainRoot}`);
    }

    if (score < 1.5) continue; // below threshold → name alone is never enough

    ranked.push({ ...candidate, score: Math.round(score * 100) / 100, why, nameSimilarity: similarity });
  }

  ranked.sort((a, b) => b.score - a.score);
  if (ranked.length === 0) {
    return { ranked: [], noMatchReason: NO_CONFIDENT_MATCH_REASON };
  }
  return { ranked, noMatchReason: null };
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
        company: typeof record["company"] === "string" && record["company"].trim() ? record["company"].trim() : null,
      }];
    });
  } finally {
    clearTimeout(timer);
  }
}
