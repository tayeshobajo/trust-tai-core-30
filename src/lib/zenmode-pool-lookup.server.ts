/**
 * Contact-route search over the ZenMode lead pool — server only.
 *
 * What replaced Linki (2026-09-09). Linki answered "find this person on
 * LinkedIn" by driving a real LinkedIn session from a droplet; LinkedIn
 * rate-limited it, and the button started failing with "LinkedIn temporarily
 * blocked this session from its current network."
 *
 * ZenMode has no person-search API, so this is not a swap of one search
 * transport for another — it is a different move. Every lead a ZenMode
 * campaign scrapes already arrives carrying its LinkedIn URL, and the import
 * parks that in `prospects.metadata.zenmode`. So the pool is already a
 * name → route index that Trust Tai owns. We search that instead.
 *
 * Consequences worth naming:
 *   - ZERO network. Nothing here contacts LinkedIn or ZenMode. There is no
 *     session to get blocked and no key to hold, so this path needs no
 *     ZENMODE_* environment variable at all.
 *   - It can only find people a campaign already scraped. That is a real
 *     limit, not a bug, and the caller is told which of the two "no" answers
 *     it got — an empty pool is a different fact from a pool that had no
 *     confident match.
 *   - Reads run on the CALLER'S Supabase client, so RLS and the organization
 *     boundary apply. No service-role key on this path.
 *
 * Results are CANDIDATES. A human still confirms identity before anything
 * becomes a contact route — same law as before.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  rankCandidates,
  type LinkedinCandidate,
  type LinkedinLookupInput,
  type RankedLinkedinCandidate,
} from "@/lib/linkedin-candidates";
import { ZENMODE_SCOUT_SOURCE } from "@/lib/zenmode-scout-import.server";

/**
 * Why a search came back with nothing. The distinction matters: "we have no
 * ZenMode leads at all" tells a person to run a campaign, while "none of them
 * matched" tells them to try the company website instead. Collapsing both into
 * "no results" is what teaches people to stop trusting a search box.
 */
export const EMPTY_POOL_REASON =
  "No ZenMode leads have been imported yet, so there is no pool to search. Run a ZenMode campaign and import its leads first.";

export const NO_POOL_MATCH_REASON =
  "No confident match among the leads ZenMode has already found. Try the company website, or add the person by hand.";

export interface ZenModePoolLookupResult {
  candidates: RankedLinkedinCandidate[];
  /** Non-null when nothing is being offered (fail-closed). */
  noMatchReason: string | null;
  /** How many ZenMode leads were searched. Display-only, but it makes an
   * empty answer legible instead of mysterious. */
  poolSize: number;
}

/** The shape the ZenMode import parks on each prospect. All fields optional —
 * this is read defensively because it is stored JSON, not a typed column. */
interface ZenModeBag {
  name?: unknown;
  title?: unknown;
  location?: unknown;
  linkedin_url?: unknown;
  company_reported_by_zenmode?: unknown;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Turn one stored ZenMode lead into a candidate card. Returns null when the row
 * carries no name or no LinkedIn route — without both there is nothing to match
 * on and nothing to offer, and a half-identity is worse than no answer.
 */
function candidateFrom(row: Record<string, unknown>): LinkedinCandidate | null {
  const metadata = row["metadata"];
  const bag: ZenModeBag =
    metadata && typeof metadata === "object"
      ? (((metadata as Record<string, unknown>)["zenmode"] as ZenModeBag) ?? {})
      : {};

  const fullName = str(bag.name);
  const linkedinUrl = str(bag.linkedin_url);
  if (!fullName || !linkedinUrl) return null;

  // The prospect's resolved company beats ZenMode's own guess — the import
  // already did that work, and ZenMode's `company` is often a headline fragment.
  const company = str(row["company_name"]) ?? str(bag.company_reported_by_zenmode);

  return {
    linkedinUrl,
    fullName,
    headline: str(bag.title),
    location: str(bag.location),
    degree: null,
    company,
  };
}

/**
 * Search the organization's ZenMode leads for a person.
 *
 * `client` must be the caller's authenticated Supabase client — this function
 * deliberately takes no token and creates no client of its own, so there is no
 * way to accidentally run it with service-role reach.
 */
export async function zenModePoolFindPerson(
  client: SupabaseClient,
  input: LinkedinLookupInput & { organizationId: string },
): Promise<ZenModePoolLookupResult> {
  const { data, error } = await client
    .from("prospects")
    .select("company_name, metadata")
    .eq("organization_id", input.organizationId)
    .eq("source", ZENMODE_SCOUT_SOURCE);

  if (error) {
    throw new Error(`Could not read the ZenMode lead pool: ${error.message}`);
  }

  const pool: LinkedinCandidate[] = [];
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const candidate = candidateFrom(row);
    if (candidate) pool.push(candidate);
  }

  if (pool.length === 0) {
    return { candidates: [], noMatchReason: EMPTY_POOL_REASON, poolSize: 0 };
  }

  // Same ranking the Linki path used: name is the identity anchor, company /
  // title / location are evidence, and a name match alone is never enough.
  const { ranked } = rankCandidates(input, pool);

  if (ranked.length === 0) {
    return { candidates: [], noMatchReason: NO_POOL_MATCH_REASON, poolSize: pool.length };
  }
  return { candidates: ranked, noMatchReason: null, poolSize: pool.length };
}
