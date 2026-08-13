/**
 * Research payload normalisation.
 *
 * Everything the provider returns passes through here before it is stored or
 * shown. The rules are strict on purpose:
 *
 *  - A claim is Observed only when it carries at least one real http(s) source
 *    with a checked_at. Anything else is downgraded to Inferred.
 *  - Confidence can be lowered by missing evidence, never raised.
 *  - An empty section is written as an Unknown, not quietly dropped.
 *  - Nothing invents a figure, a timeline, a budget, or a client preference.
 */

import type { ConfidenceLevel } from "@/domain/confidence";
import type {
  ResearchClaim,
  ResearchCompetitor,
  SourceRef,
} from "@/domain/roadmap-intel";

type Raw = Record<string, unknown>;

export interface ResearchProvenance {
  provider: string;
  model: string;
  checkedAt: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value);
}

/** No source URL means no source. A label on its own proves nothing. */
export function normalizeSources(value: unknown, provenance: ResearchProvenance): SourceRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Raw;
    const url = str(row["url"]);
    if (!isHttpUrl(url) || seen.has(url)) continue;
    seen.add(url);
    const checked = str(row["checked_at"]) || str(row["checkedAt"]) || provenance.checkedAt;
    out.push({
      label: str(row["label"]) || str(row["title"]) || new URL(url).hostname,
      url,
      checkedAt: checked,
      provider: provenance.provider,
      model: provenance.model,
    });
  }
  return out;
}

const LEVELS: ConfidenceLevel[] = ["unknown", "low", "moderate", "high"];

function confidence(value: unknown, sources: SourceRef[]): ConfidenceLevel {
  const raw = str(value).toLowerCase();
  const stated: ConfidenceLevel = LEVELS.includes(raw as ConfidenceLevel)
    ? (raw as ConfidenceLevel)
    : "low";
  // Evidence is the ceiling: no source, no confidence above low.
  const cap: ConfidenceLevel = sources.length >= 2 ? "high" : sources.length === 1 ? "moderate" : "low";
  return LEVELS.indexOf(stated) > LEVELS.indexOf(cap) ? cap : stated;
}

export function normalizeClaims(value: unknown, provenance: ResearchProvenance): ResearchClaim[] {
  if (!Array.isArray(value)) return [];
  const out: ResearchClaim[] = [];
  for (const entry of value) {
    if (!entry) continue;
    const row = (typeof entry === "string" ? { statement: entry } : entry) as Raw;
    const statement = str(row["statement"]) || str(row["text"]);
    if (!statement) continue;
    const sources = normalizeSources(row["sources"], provenance);
    out.push({
      statement,
      // Observed requires a receipt. Everything else is a deduction.
      tier: sources.length > 0 ? "observed" : "inferred",
      confidence: confidence(row["confidence"], sources),
      sources,
    });
  }
  return out;
}

export function normalizeCompetitors(
  value: unknown,
  provenance: ResearchProvenance,
): ResearchCompetitor[] {
  if (!Array.isArray(value)) return [];
  const out: ResearchCompetitor[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Raw;
    const name = str(row["name"]);
    if (!name) continue;
    const sources = normalizeSources(row["sources"], provenance);
    const website = str(row["website"]);
    out.push({
      name,
      ...(isHttpUrl(website) ? { website } : {}),
      positioning: str(row["positioning"]) || "Positioning not established",
      tier: sources.length > 0 ? "observed" : "inferred",
      confidence: confidence(row["confidence"], sources),
      sources,
    });
  }
  return out;
}

export interface NormalizedResearch {
  companyModel: ResearchClaim[];
  buyers: ResearchClaim[];
  strengths: ResearchClaim[];
  digitalPresence: ResearchClaim[];
  competitors: ResearchCompetitor[];
  marketDirection: ResearchClaim[];
  sources: SourceRef[];
  unknowns: string[];
}

const SECTION_LABEL: Record<string, string> = {
  companyModel: "How the business makes money",
  buyers: "Who actually buys",
  strengths: "What leadership has already built",
  digitalPresence: "Public digital presence",
  competitors: "Competitors and market direction",
  marketDirection: "Where the category is heading",
};

/** One research pass, cleaned. Gaps are named rather than smoothed over. */
export function normalizeResearch(raw: unknown, provenance: ResearchProvenance): NormalizedResearch {
  const row = (raw && typeof raw === "object" ? raw : {}) as Raw;

  const result: NormalizedResearch = {
    companyModel: normalizeClaims(row["company_model"] ?? row["companyModel"], provenance),
    buyers: normalizeClaims(row["buyers"], provenance),
    strengths: normalizeClaims(row["strengths"], provenance),
    digitalPresence: normalizeClaims(
      row["digital_presence"] ?? row["digitalPresence"],
      provenance,
    ),
    competitors: normalizeCompetitors(row["competitors"], provenance),
    marketDirection: normalizeClaims(
      row["market_direction"] ?? row["marketDirection"],
      provenance,
    ),
    sources: normalizeSources(row["sources"], provenance),
    unknowns: Array.isArray(row["unknowns"])
      ? row["unknowns"].map((entry) => str(entry)).filter((entry) => entry.length > 0)
      : [],
  };

  // Every claim's source rolls up, so the pass can be audited in one place.
  const rolled = new Map<string, SourceRef>();
  for (const ref of [
    ...result.sources,
    ...result.companyModel.flatMap((claim) => claim.sources),
    ...result.buyers.flatMap((claim) => claim.sources),
    ...result.strengths.flatMap((claim) => claim.sources),
    ...result.digitalPresence.flatMap((claim) => claim.sources),
    ...result.marketDirection.flatMap((claim) => claim.sources),
    ...result.competitors.flatMap((entry) => entry.sources),
  ]) {
    if (!rolled.has(ref.url)) rolled.set(ref.url, ref);
  }
  result.sources = [...rolled.values()];

  for (const [key, label] of Object.entries(SECTION_LABEL)) {
    const section = result[key as keyof NormalizedResearch];
    if (Array.isArray(section) && section.length === 0) {
      result.unknowns.push(`${label}: nothing established from public sources.`);
    }
  }

  return result;
}
