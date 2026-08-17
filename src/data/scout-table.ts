/**
 * Scout listing — pure search, filter and pagination.
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

export interface PageView<T> {
  rows: T[];
  page: number;
  pageCount: number;
  total: number;
  /** 1-based index of the first row on this page, 0 when empty. */
  from: number;
  to: number;
}

/** Bounded slice. An out-of-range page clamps to the last available page. */
export function paginate<T>(items: T[], page: number, pageSize: number): PageView<T> {
  const total = items.length;
  const size = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  const rows = items.slice(start, start + size);
  return {
    rows,
    page: current,
    pageCount,
    total,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(total, start + rows.length),
  };
}

/**
 * Page numbers to render, with `null` marking an elision. Keeps the control
 * compact no matter how many companies are on the board.
 */
export function pageNumbers(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const out: (number | null)[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) out.push(null);
  for (let i = start; i <= end; i += 1) out.push(i);
  if (end < pageCount - 1) out.push(null);
  out.push(pageCount);
  return out;
}
