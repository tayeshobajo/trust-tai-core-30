/**
 * Company profile fields (industry / size / location) read from what research
 * already recorded. Nothing is inferred or invented here: if the stored payload
 * does not state a field, it stays undefined and the table shows "-".
 */

export interface CompanyProfile {
  industry?: string;
  size?: string;
  location?: string;
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** First non-empty string found across the given keys. */
function pick(sources: Row[], keys: string[]): string | undefined {
  for (const key of keys) {
    for (const source of sources) {
      const value = text(source[key]);
      if (value) return value;
    }
  }
  return undefined;
}

const INDUSTRY_KEYS = ["industry", "sector", "vertical", "company_industry"];
const SIZE_KEYS = [
  "company_size",
  "size",
  "employees",
  "employee_count",
  "headcount",
  "team_size",
];
const LOCATION_KEYS = [
  "location",
  "headquarters",
  "hq",
  "city",
  "region",
  "company_location",
];

/**
 * Read the profile from the inferred payload first (where discovery writes
 * industry / location) and then from structured observation facts.
 */
export function companyProfile(inferred: unknown, facts: unknown): CompanyProfile {
  const sources: Row[] = [];
  if (inferred && typeof inferred === "object") sources.push(inferred as Row);
  if (facts && typeof facts === "object") sources.push(facts as Row);
  if (sources.length === 0) return {};

  const industry = pick(sources, INDUSTRY_KEYS);
  const size = pick(sources, SIZE_KEYS);
  const location = pick(sources, LOCATION_KEYS);

  return {
    ...(industry ? { industry } : {}),
    ...(size ? { size } : {}),
    ...(location ? { location } : {}),
  };
}
