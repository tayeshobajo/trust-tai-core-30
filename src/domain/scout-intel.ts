/**
 * Scout — decision intelligence contracts.
 *
 * Six metrics, kept deliberately separate. A single blended number hides the
 * reason a company is at the top of the board; these do not. The board may
 * rank by a documented priority score, but every component stays visible and
 * explainable, and each one states what it was computed from.
 *
 * Three tiers never blend: observed facts carry a source URL, inferences are
 * labelled as Scout's read, and human decisions outrank both.
 */

import type { ISODateTime } from "./entities";

/** A public, dated reason a company might be buying now. Always cited. */
export interface BuyingSignal {
  /** e.g. "hiring", "funding", "rebrand", "expansion", "leadership_change". */
  type: string;
  statement: string;
  sourceUrl?: string;
  observedAt?: ISODateTime;
}

/** Areas of digital work Trust Tai can realistically deliver. */
export type OpportunityArea =
  | "ux"
  | "accessibility"
  | "performance"
  | "broken_functionality"
  | "conversion"
  | "technology_age"
  | "security"
  | "content_freshness"
  | "operational_friction";

export const OPPORTUNITY_AREA_LABEL: Record<OpportunityArea, string> = {
  ux: "Experience / UX",
  accessibility: "Accessibility",
  performance: "Performance",
  broken_functionality: "Broken functionality",
  conversion: "Conversion path",
  technology_age: "Technology age",
  security: "Security exposure",
  content_freshness: "Content freshness",
  operational_friction: "Operational friction",
};

export function isOpportunityArea(value: unknown): value is OpportunityArea {
  return typeof value === "string" && value in OPPORTUNITY_AREA_LABEL;
}

/**
 * An evidence-backed problem Trust Tai could solve. `evidence` states what was
 * actually seen; nothing here claims an audit that was never performed.
 */
export interface DigitalOpportunity {
  area: OpportunityArea;
  statement: string;
  evidence: string;
  sourceUrl?: string;
}

/** What discovery/enrichment read about a person, before it becomes a contact. */
export interface DiscoveredPerson {
  fullName: string;
  roleTitle?: string;
  linkedinUrl?: string;
  email?: string;
  sourceUrl?: string;
  /** How likely this person decides on a web/technology engagement. */
  decisionMakerLikelihood: "high" | "moderate" | "low" | "unknown";
}

/** Everything discovery/enrichment collected beyond the ICP fit read. */
export interface ScoutIntel {
  buyingSignals: BuyingSignal[];
  opportunities: DigitalOpportunity[];
  people: DiscoveredPerson[];
  /** Facts the run could not establish. Unknown, never negative. */
  unknowns: string[];
  collectedAt?: ISODateTime;
  /** Public pages / articles the intel was read from. */
  citations: string[];
}

export const EMPTY_INTEL: ScoutIntel = {
  buyingSignals: [],
  opportunities: [],
  people: [],
  unknowns: [],
  citations: [],
};

export type MetricKey =
  | "icp_match"
  | "evidence_confidence"
  | "research_coverage"
  | "reachability"
  | "opportunity_readiness"
  | "timing";

export const METRIC_LABEL: Record<MetricKey, string> = {
  icp_match: "ICP match",
  evidence_confidence: "Evidence confidence",
  research_coverage: "Research coverage",
  reachability: "Reachability",
  opportunity_readiness: "Opportunity readiness",
  timing: "Timing signal",
};

/** One metric: a value, why it is that value, and what it was read from. */
export interface DecisionMetric {
  key: MetricKey;
  label: string;
  /** 0–100, or null when it cannot honestly be computed yet. */
  value: number | null;
  because: string;
  /** Weight this metric carries in the board priority score. */
  weight: number;
}

export interface DecisionMetrics {
  metrics: DecisionMetric[];
  /**
   * 0–100 ranking score. Null for records that were never researched, so
   * preview/demo rows can never contaminate live ranking.
   */
  priority: number | null;
  /** Plain-language account of how the priority score was reached. */
  priorityExplanation: string;
}

/** Who to approach, and the honest reason why. */
export interface PersonRecommendation {
  personId: string;
  fullName: string;
  roleTitle?: string;
  /** 0–100 blend of buying relevance, evidence, and contact route. */
  weight: number;
  why: string;
  /** How this person can actually be reached right now. */
  route: "verified_email" | "unverified_email" | "linkedin" | "none";
  routeNote: string;
}

export interface PersonPlan {
  primary: PersonRecommendation | null;
  supporting: PersonRecommendation[];
  /** What stands between here and a real conversation. */
  gap: string | null;
}

/** One section of the account brief. Provenance-aware by construction. */
export interface BriefSection {
  id:
    | "company"
    | "why_this_account"
    | "opportunity"
    | "why_now"
    | "primary_contact"
    | "supporting_people"
    | "evidence"
    | "unknowns"
    | "angle";
  title: string;
  /** `fact` = read from a page, `inference` = Scout's read, `decision` = human. */
  tier: "fact" | "inference" | "decision";
  body: string;
  sources: string[];
}

export interface AccountBrief {
  companyName: string;
  sections: BriefSection[];
  /** True when the brief rests on real researched evidence. */
  grounded: boolean;
}

/** One thing Scout still needs before outreach, and how it would get it. */
export interface ResearchGap {
  key: string;
  label: string;
  /** What Scout would do about it, in plain language. */
  plan: string;
  /** Can Scout close this itself from public sources? */
  autonomous: boolean;
}

export interface GapPlan {
  gaps: ResearchGap[];
  /** True when at least one gap can be closed by public research. */
  actionable: boolean;
  summary: string;
}
