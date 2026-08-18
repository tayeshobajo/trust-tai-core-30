/**
 * Scout, app-specific contracts.
 *
 * Shared entities stay in `entities.ts`. Everything here is fit evidence that
 * only Scout needs: it is never copied into the core model.
 *
 * Observed facts, inferences, and recommendations are kept apart on purpose.
 */

import type { Provenance } from "./activity";
import type { ID, Prospect } from "./entities";
import type { ScoutFitEvaluation } from "./scout-fit";
import type { ResearchRun } from "./prospect-modules";
import type { ScoutIntel } from "./scout-intel";

import type { CompanyIdentity } from "@/lib/company-identity";
import type { CompanyProfile } from "@/data/scout-profile";


/** A single piece of evidence Scout observed about a company. */
export interface ScoutSignal {
  id: ID;
  statement: string;
  provenance: Provenance;
  /** Page the fact was read from, when the evidence is a real public URL. */
  sourceUrl?: string;
}

/** Scout's read of a company, always separated from what it actually observed. */
export interface ScoutFit {
  /** Short plain-language reason this company looks like a fit. Inferred. */
  whyItFits: string;
  /** The single next move Scout suggests. Recommendation, not a decision. */
  recommendation: string;
}

/**
 * Where a candidate's evidence came from. Preview discovery is a fixed demo
 * pool; live website research is real public-page reading by the backend.
 */
export type CandidateSourceKind = "preview_demo" | "live_website";

export interface CandidateSource {
  kind: CandidateSourceKind;
  label: string;
  /** e.g. "Public website only · 4 pages checked". */
  note?: string;
  pagesResearched?: string[];
  researchedAt?: string;
}

export const PREVIEW_SOURCE: CandidateSource = {
  kind: "preview_demo",
  label: "Preview demo source",
  note: "A fixed in-memory set. No external service was searched and no AI scoring was applied.",
};

/** A prospect plus the Scout-specific evidence behind it. */
export interface ProspectCandidate {
  prospect: Prospect;
  signals: ScoutSignal[];
  fit: ScoutFit;
  source: CandidateSource;
  /** Deterministic ICP fit evaluation. Traffic-light colour comes from here. */
  evaluation: ScoutFitEvaluation;
  /** When the evidence behind this candidate was last read. */
  lastCheckedAt: string;
  /** Company-owned identity (real theme colour / logo URL) when recorded. */
  identity?: CompanyIdentity;
  /** Raw observation key → value, for coverage and structured reads. */
  facts?: Record<string, unknown>;
  /** Industry / size / location as recorded by research. Never inferred here. */
  profile?: CompanyProfile;

  /** Append-only log of completed research passes, oldest first. */
  history?: ResearchRun[];
  /** Buying signals, digital opportunities and people, kept apart from fit. */
  intel?: ScoutIntel;
}


export interface ScoutSearchRequest {
  organizationId: ID;
  userId: ID;
  /** Plain-English description of who we are looking for. */
  query: string;
}

export interface ScoutSearchResult {
  request: ScoutSearchRequest;
  candidates: ProspectCandidate[];
  /** Where these candidates came from. */
  source: CandidateSource;
  generatedAt: string;
}

export interface ScoutResearchRequest {
  organizationId: ID;
  userId: ID;
  /** Raw pasted website or domain. Normalized before the backend call. */
  websiteUrl: string;
}

export interface ScoutResearchResult {
  request: ScoutResearchRequest;
  candidate: ProspectCandidate;
  source: CandidateSource;
  generatedAt: string;
}

export interface ScoutProvider {
  search(request: ScoutSearchRequest): Promise<ScoutSearchResult>;
  setStatus(
    id: ID,
    status: Prospect["status"],
    context: { organizationId: ID; userId: ID },
  ): Promise<Prospect | null>;
  list(organizationId: ID): Promise<ProspectCandidate[]>;
  research(request: ScoutResearchRequest): Promise<ScoutResearchResult>;
}

export const SCOUT_STARTER_PROMPTS = [
  "US professional-services firms with dated WordPress websites",
  "Growing nonprofits that need a website partner",
  "Companies similar to our best retained clients",
];
