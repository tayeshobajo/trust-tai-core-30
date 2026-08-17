/**
 * Scout — similar companies.
 *
 * Read-only, deterministic, and computed over the board already loaded for the
 * organization. No model, no extra query, no stored similarity truth.
 */

import type { ProspectCandidate } from "@/domain/scout";
import type { FitLight } from "@/domain/scout-fit";

export interface SimilarCompany {
  id: string;
  name: string;
  domain: string;
  websiteUrl: string;
  industry?: string;
  size?: string;
  location?: string;
  icpMatch: number | null;
  light: FitLight;
  themeColor?: string;
  logoUrl?: string;
  /** 0–100 similarity, for ordering only. */
  similarity: number;
}

function norm(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Rough headcount band from a free-text size string, when one can be read. */
function sizeBand(value: string | undefined): number | null {
  const digits = (value ?? "").match(/\d[\d,]*/g);
  if (!digits || digits.length === 0) return null;
  const first = Number(digits[0]?.replace(/,/g, ""));
  if (!Number.isFinite(first)) return null;
  if (first < 11) return 0;
  if (first < 51) return 1;
  if (first < 201) return 2;
  if (first < 501) return 3;
  if (first < 1001) return 4;
  return 5;
}

export function similarCompanies(
  subject: ProspectCandidate,
  board: ProspectCandidate[],
  limit = 6,
): SimilarCompany[] {
  const subjectIndustry = norm(subject.profile?.industry);
  const subjectLocation = norm(subject.profile?.location);
  const subjectBand = sizeBand(subject.profile?.size);
  const subjectScore = subject.evaluation.scoreable ? subject.evaluation.score : null;

  const scored = board
    .filter((c) => c.prospect.id !== subject.prospect.id)
    .filter((c) => c.prospect.status !== "archived")
    .map((candidate) => {
      let similarity = 0;
      const industry = norm(candidate.profile?.industry);
      if (subjectIndustry && industry && industry === subjectIndustry) similarity += 45;
      else if (subjectIndustry && industry && industry.includes(subjectIndustry)) similarity += 25;

      const band = sizeBand(candidate.profile?.size);
      if (subjectBand !== null && band !== null) {
        const gap = Math.abs(subjectBand - band);
        similarity += gap === 0 ? 20 : gap === 1 ? 10 : 0;
      }

      const location = norm(candidate.profile?.location);
      if (subjectLocation && location && location === subjectLocation) similarity += 15;

      const score = candidate.evaluation.scoreable ? candidate.evaluation.score : null;
      if (subjectScore !== null && score !== null) {
        similarity += Math.max(0, 20 - Math.abs(subjectScore - score) / 5);
      }

      const profile = candidate.profile;
      const identity = candidate.identity;
      const result: SimilarCompany = {
        id: candidate.prospect.id,
        name: candidate.prospect.name,
        domain: candidate.prospect.domain,
        websiteUrl: candidate.prospect.websiteUrl || candidate.prospect.domain,
        ...(profile?.industry ? { industry: profile.industry } : {}),
        ...(profile?.size ? { size: profile.size } : {}),
        ...(profile?.location ? { location: profile.location } : {}),
        icpMatch: score,
        light: candidate.evaluation.light,
        ...(identity?.themeColor ? { themeColor: identity.themeColor } : {}),
        ...(identity?.logoUrl ? { logoUrl: identity.logoUrl } : {}),
        similarity: Math.round(similarity),
      };
      return result;
    })
    .filter((c) => c.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity || a.name.localeCompare(b.name));

  return scored.slice(0, limit);
}
