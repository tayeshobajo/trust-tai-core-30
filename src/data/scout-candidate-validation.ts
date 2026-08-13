/**
 * Scout — discovery candidate validation.
 *
 * Pure functions, deliberately dependency-free so they can be unit tested and
 * shared between the server discovery boundary and the UI.
 *
 * A sourced company is only real if it has a name, a resolvable website, and at
 * least one source URL that was actually read. Anything else is dropped rather
 * than shown, because an unverifiable company is worse than no company.
 */

export const DISCOVERY_SOURCE = "scout_ai_discovery";
export const SCOUT_DISCOVERY_EVALUATOR_VERSION = "trust-tai-scout-discovery-v1";

export interface RawDiscoveryCandidate {
  company_name?: unknown;
  website?: unknown;
  location?: string | null;
  industry?: string | null;
  summary?: string;
  discovery_reason?: string;
  observed_evidence?: unknown;
  source_urls?: string[];
  unknowns?: string[];
  icp_fit?: {
    light?: "green" | "yellow" | "red";
    score?: number;
    confidence?: "high" | "moderate" | "low" | "unknown";
    reasoning?: string;
    criteria?: unknown[];
  };
}

export interface AcceptedCandidate {
  domain: string;
  candidate: RawDiscoveryCandidate & { company_name: string };
}

/** The one identity key for a company: its normalized root domain. */
export function rootDomain(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  let raw = value.trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".") || host.endsWith(".") || host.startsWith(".")) return null;
    return host;
  } catch {
    return null;
  }
}

/**
 * Keep only verifiable companies, first occurrence wins per domain.
 * `rejected` counts records dropped for missing evidence, not duplicates.
 */
export function acceptCandidates(candidates: RawDiscoveryCandidate[]): {
  accepted: AcceptedCandidate[];
  rejected: number;
  duplicates: number;
} {
  const seen = new Set<string>();
  const accepted: AcceptedCandidate[] = [];
  let rejected = 0;
  let duplicates = 0;

  for (const candidate of candidates ?? []) {
    const domain = rootDomain(candidate?.website);
    const name =
      typeof candidate?.company_name === "string" ? candidate.company_name.trim() : "";
    const sources = Array.isArray(candidate?.source_urls)
      ? candidate.source_urls.filter((url) => typeof url === "string" && url.trim().length > 0)
      : [];

    if (!domain || !name || sources.length === 0) {
      rejected += 1;
      continue;
    }
    if (seen.has(domain)) {
      duplicates += 1;
      continue;
    }
    seen.add(domain);
    accepted.push({ domain, candidate: { ...candidate, company_name: name, source_urls: sources } });
  }

  return { accepted, rejected, duplicates };
}

/**
 * Translate a provider evaluation into the app's own `ScoutFitEvaluation`
 * shape, so a discovered company reads on the board exactly like a researched
 * one — same light, same criteria, same "why".
 *
 * Deliberately conservative: a company with fewer than three distinct evidence
 * points can never present as green, no matter what the provider claimed.
 */
export function discoveryEvaluation(
  candidate: RawDiscoveryCandidate,
  options: { icpVersion: number | null; at: string },
): Record<string, unknown> {
  const fit = candidate.icp_fit ?? {};
  const score = Math.max(0, Math.min(100, Number(fit.score ?? 0)));
  const observed = Array.isArray(candidate.observed_evidence) ? candidate.observed_evidence : [];
  const criteria = (Array.isArray(fit.criteria) ? fit.criteria : []).map((entry, index) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    const status = String(row["status"] ?? "unknown");
    return {
      key: String(row["name"] ?? `criterion_${index}`).toLowerCase().replace(/\s+/g, "_"),
      label: String(row["name"] ?? "Criterion"),
      score: Number(row["score_contribution"] ?? 0),
      maxScore: Number(row["weight"] ?? 0),
      state:
        status === "met"
          ? "met"
          : status === "partial"
            ? "partial"
            : status === "missed" || status === "disqualifier"
              ? "mismatch"
              : "missing",
      reason: String(row["evidence"] ?? "Nothing public was found for this criterion."),
      sourceUrls: Array.isArray(row["source_urls"]) ? (row["source_urls"] as string[]) : [],
    };
  });

  const evidenceCount = observed.length;
  const claimed = fit.light ?? "yellow";
  const light = claimed === "green" && evidenceCount < 3 ? "yellow" : claimed;

  return {
    score,
    light,
    evidenceCount,
    strongestSignal:
      String(candidate.discovery_reason ?? "").trim() ||
      String(fit.reasoning ?? "").trim() ||
      "Sourced from the public web.",
    criteria,
    icpVersion: options.icpVersion,
    evaluatorVersion: SCOUT_DISCOVERY_EVALUATOR_VERSION,
    evaluatedAt: options.at,
    explanation: String(fit.reasoning ?? "").trim() || "No reasoning was returned for this company.",
    scoreable: true,
    pagesResearched: Array.isArray(candidate.source_urls) ? candidate.source_urls.length : 0,
    researchDepthNote:
      light === "green" && claimed === "green"
        ? undefined
        : evidenceCount < 3
          ? "Evidence is thin — a human read is needed before this can be trusted as a strong fit."
          : undefined,
    confidence: fit.confidence ?? "unknown",
  };
}
