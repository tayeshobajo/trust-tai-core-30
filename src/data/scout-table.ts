/**
 * Scout listing, pure search, filter and pagination.
 *
 * Deliberately free of React and of Supabase: the board can be reasoned about
 * and tested on its own. Pagination is bounded client-side slicing over the
 * candidates already loaded for the organization; no unrelated page is ever
 * rendered into the table.
 */

import type { ProspectCandidate } from "@/domain/scout";
import type { FitLight } from "@/domain/scout-fit";

export type ScoutScoreBand = "all" | "high" | "medium" | "low";

export interface ScoutTableFilters {
  search: string;
  industry: string;
  location: string;
  size: string;
  score: ScoutScoreBand;
  fit: "all" | FitLight;
}

export const EMPTY_FILTERS: ScoutTableFilters = {
  search: "",
  industry: "all",
  location: "all",
  size: "all",
  score: "all",
  fit: "all",
};

export const SCORE_BANDS: { key: ScoutScoreBand; label: string }[] = [
  { key: "all", label: "Any score" },
  { key: "high", label: "80 and above" },
  { key: "medium", label: "60 – 79" },
  { key: "low", label: "Below 60" },
];

export const ROWS_PER_PAGE_OPTIONS = [10, 25, 50] as const;

function haystack(candidate: ProspectCandidate): string {
  const profile = candidate.profile ?? {};
  return [
    candidate.prospect.name,
    candidate.prospect.domain,
    profile.industry,
    profile.location,
    profile.size,
    candidate.fit.whyItFits,
    candidate.evaluation.strongestSignal,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function inBand(score: number, scoreable: boolean, band: ScoutScoreBand): boolean {
  if (band === "all") return true;
  if (!scoreable) return false;
  if (band === "high") return score >= 80;
  if (band === "medium") return score >= 60 && score < 80;
  return score < 60;
}

/** Distinct values for a profile field, sorted, for the filter selects. */
export function profileOptions(
  candidates: ProspectCandidate[],
  field: "industry" | "location" | "size",
): string[] {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const value = candidate.profile?.[field];
    if (value) seen.add(value);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export function filterCandidates(
  candidates: ProspectCandidate[],
  filters: ScoutTableFilters,
): ProspectCandidate[] {
  const term = filters.search.trim().toLowerCase();
  return candidates.filter((candidate) => {
    if (term && !haystack(candidate).includes(term)) return false;
    if (filters.fit !== "all" && candidate.evaluation.light !== filters.fit) return false;
    if (!inBand(candidate.evaluation.score, candidate.evaluation.scoreable, filters.score))
      return false;
    if (filters.industry !== "all" && candidate.profile?.industry !== filters.industry) return false;
    if (filters.location !== "all" && candidate.profile?.location !== filters.location) return false;
    if (filters.size !== "all" && candidate.profile?.size !== filters.size) return false;
    return true;
  });
}

// Pagination primitives are shared with the other suite lists (Comms
// relationships paginate the same way). Re-exported so existing Scout imports
// keep working unchanged.
export { paginate, pageNumbers, type PageView } from "./pagination";
