/**
 * Scout — app-specific contracts.
 *
 * Shared entities stay in `entities.ts`. Everything here is fit evidence that
 * only Scout needs: it is never copied into the core model.
 *
 * Observed facts, inferences, and recommendations are kept apart on purpose.
 */

import type { Provenance } from "./activity";
import type { ID, Prospect } from "./entities";

/** A single piece of evidence Scout observed about a company. */
export interface ScoutSignal {
  id: ID;
  statement: string;
  provenance: Provenance;
}

/** Scout's read of a company, always separated from what it actually observed. */
export interface ScoutFit {
  /** Short plain-language reason this company looks like a fit. Inferred. */
  whyItFits: string;
  /** The single next move Scout suggests. Recommendation, not a decision. */
  recommendation: string;
}

/** A prospect plus the Scout-specific evidence behind it. */
export interface ProspectCandidate {
  prospect: Prospect;
  signals: ScoutSignal[];
  fit: ScoutFit;
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
  /** Where these candidates came from. Currently always the demo set. */
  source: { kind: "preview_demo"; label: string; note: string };
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
}

export const SCOUT_STARTER_PROMPTS = [
  "US professional-services firms with dated WordPress websites",
  "Growing nonprofits that need a website partner",
  "Companies similar to our best retained clients",
];
