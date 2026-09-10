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

import { ownedExecutionBoundary } from "@/domain/execution-ownership";
import type { ConfidenceLevel } from "@/domain/confidence";
import type {
  HorizonBand,
  ResearchClaim,
  ResearchCompetitor,
  SourceRef,
  StrategyItem,
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
  const cap: ConfidenceLevel =
    sources.length >= 2 ? "high" : sources.length === 1 ? "moderate" : "low";
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
export function normalizeResearch(
  raw: unknown,
  provenance: ResearchProvenance,
): NormalizedResearch {
  const row = (raw && typeof raw === "object" ? raw : {}) as Raw;

  const result: NormalizedResearch = {
    companyModel: normalizeClaims(row["company_model"] ?? row["companyModel"], provenance),
    buyers: normalizeClaims(row["buyers"], provenance),
    strengths: normalizeClaims(row["strengths"], provenance),
    digitalPresence: normalizeClaims(row["digital_presence"] ?? row["digitalPresence"], provenance),
    competitors: normalizeCompetitors(row["competitors"], provenance),
    marketDirection: normalizeClaims(row["market_direction"] ?? row["marketDirection"], provenance),
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

/* ---------------------------------------------------------------- strategy */

/**
 * A proposed strategy. Every item lands as Inferred and Proposed, whatever the
 * model claims: only a person in Trust Tai OS can make something Decided.
 */
export interface NormalizedStrategy {
  pointA: StrategyItem[];
  anchorProof: StrategyItem[];
  horizon: HorizonBand[];
  pointB: StrategyItem | null;
  pointC: StrategyItem | null;
  centralTruth: StrategyItem | null;
  gaps: StrategyItem[];
  leveragePoint: StrategyItem | null;
}

function slug(value: string, index: number, prefix: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${prefix}-${index}-${base || "item"}`;
}

function item(
  value: unknown,
  provenance: ResearchProvenance,
  prefix: string,
  index = 0,
): StrategyItem | null {
  if (!value) return null;
  const row = (typeof value === "string" ? { statement: value } : value) as Raw;
  const statement = str(row["statement"]);
  if (!statement) return null;
  const sources = normalizeSources(row["sources"], provenance);
  return {
    key: slug(statement, index, prefix),
    statement,
    because: str(row["because"]) || "Proposed from the research pass.",
    tier: "inferred",
    confidence: confidence(row["confidence"], sources),
    sources,
    approval: "proposed",
  };
}

function items(value: unknown, provenance: ResearchProvenance, prefix: string): StrategyItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => item(entry, provenance, prefix, index))
    .filter((entry): entry is StrategyItem => entry !== null);
}

export function normalizeStrategy(
  raw: unknown,
  provenance: ResearchProvenance,
): NormalizedStrategy {
  const row = (raw && typeof raw === "object" ? raw : {}) as Raw;

  const bands: HorizonBand[] = Array.isArray(row["horizon"])
    ? (row["horizon"] as Raw[])
        .map((entry): HorizonBand | null => {
          const years = Number(entry["years"]);
          const statement = str(entry["statement"]);
          if (!statement) return null;
          const sources = normalizeSources(entry["sources"], provenance);
          return {
            years: (years === 10 ? 10 : years === 5 ? 5 : 2) as 2 | 5 | 10,
            statement,
            // A horizon band is a statement about the future, so it can never
            // be Observed however well sourced it is. The sources back the
            // direction; they do not make it already true.
            tier: "inferred",
            confidence: confidence(entry["confidence"], sources),
            sources,
          };
        })
        .filter((band): band is HorizonBand => band !== null)
        .sort((a, b) => a.years - b.years)
    : [];

  return {
    pointA: items(row["point_a"] ?? row["pointA"], provenance, "point-a"),
    // Anchor proof is one to three things, never a list of everything good.
    anchorProof: items(row["anchor_proof"] ?? row["anchorProof"], provenance, "anchor").slice(0, 3),
    horizon: bands,
    pointB: item(row["point_b"] ?? row["pointB"], provenance, "point-b"),
    pointC: item(row["point_c"] ?? row["pointC"], provenance, "point-c"),
    centralTruth: item(row["central_truth"] ?? row["centralTruth"], provenance, "central-truth"),
    gaps: items(row["gaps"], provenance, "gap"),
    leveragePoint: item(row["leverage_point"] ?? row["leveragePoint"], provenance, "leverage"),
  };
}

/* -------------------------------------------------------------- milestones */

export interface NormalizedMilestone {
  name: string;
  whatWeBuild: string;
  intendedUser: string;
  supportingMarketDirection: string;
  clientAdvantage: string;
  currentGap: string;
  evidence: SourceRef[];
  immediateValue: string;
  longTermValue: string;
  dependencies: string[];
  executionBoundary: string;
  confidence: ConfidenceLevel;
}

export function normalizeMilestones(
  raw: unknown,
  provenance: ResearchProvenance,
): NormalizedMilestone[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalizedMilestone[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Raw;
    const name = str(row["name"]);
    if (!name) continue;
    const evidence = normalizeSources(row["evidence"] ?? row["sources"], provenance);
    out.push({
      name,
      whatWeBuild: str(row["what_we_build"] ?? row["whatWeBuild"]),
      intendedUser: str(row["intended_user"] ?? row["intendedUser"]),
      supportingMarketDirection: str(
        row["supporting_market_direction"] ?? row["supportingMarketDirection"],
      ),
      clientAdvantage: str(row["client_advantage"] ?? row["clientAdvantage"]),
      currentGap: str(row["current_gap"] ?? row["currentGap"]),
      evidence,
      immediateValue: str(row["immediate_value"] ?? row["immediateValue"]),
      longTermValue: str(row["long_term_value"] ?? row["longTermValue"]),
      dependencies: Array.isArray(row["dependencies"])
        ? row["dependencies"].map((dep) => str(dep)).filter((dep) => dep.length > 0)
        : [],
      executionBoundary: ownedExecutionBoundary({
        name,
        whatWeBuild: str(row["what_we_build"] ?? row["whatWeBuild"]),
        executionBoundary: str(row["execution_boundary"] ?? row["executionBoundary"]),
      }).boundary,
      confidence: confidence(row["confidence"], evidence),
    });
  }
  return out;
}
