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
  normalizeName,
  rankCandidates,
  type LinkedinCandidate,
  type LinkedinLookupInput,
  type RankedLinkedinCandidate,
} from "@/lib/linkedin-candidates";
import { ZENMODE_SCOUT_SOURCE } from "@/lib/zenmode-scout-import.server";

/**
 * Hard ceiling on rows pulled back for in-memory ranking.
 *
 * PostgREST caps rows server-side anyway (commonly 1000). Asking explicitly is
 * the point: the cap becomes a number we know we hit, instead of a silent page
 * boundary that turns "this person is in the pool" into "no confident match".
 */
const POOL_READ_LIMIT = 1000;

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

/**
 * The third "no": we hit the read ceiling, so "not found" is not a fact we are
 * entitled to state. Saying so is the whole difference between a search that is
 * limited and a search that lies.
 */
export const POOL_TRUNCATED_REASON =
  "No match in the leads we could search, but the ZenMode pool is larger than one search can read, so this is not a definitive no. Narrow by company, or check the lead in ZenMode directly.";

export interface ZenModePoolLookupResult {
  candidates: RankedLinkedinCandidate[];
  /** Non-null when nothing is being offered (fail-closed). */
  noMatchReason: string | null;
  /** How many ZenMode leads were searched. Display-only, but it makes an
   * empty answer legible instead of mysterious. */
  poolSize: number;
  /** True when the read hit POOL_READ_LIMIT, so absence proves nothing. */
  truncated: boolean;
}

/**
 * The surname the ranking gate will insist on.
 *
 * `hasStrongHumanNameMatch` requires the first AND last name token to match, so
 * any row capable of passing the gate must contain this token. That makes it
 * safe to push into the query: it can only remove rows that were already going
 * to be rejected. Returns null when the token could alter LIKE semantics, in
 * which case we read broadly rather than risk excluding a real match.
 */
function surnameFilterToken(fullName: string): string | null {
  const tokens = normalizeName(fullName).split(" ").filter(Boolean);
  const surname = tokens.length > 1 ? tokens[tokens.length - 1] : null;
  if (!surname || surname.length < 2) return null;
  if (/[%_\\]/.test(surname)) return null;
  return surname;
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
 * Does this organization hold any ZenMode leads at all?
 *
 * Only asked when a filtered search missed, to tell "run a campaign first" apart
 * from "that person is not in the pool". A count with `head` pulls no rows.
 * A failed count is treated as "not empty", so a hiccup downgrades the message
 * rather than inventing the more dramatic claim.
 */
async function poolIsEmpty(client: SupabaseClient, organizationId: string): Promise<boolean> {
  const { count, error } = await client
    .from("prospects")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("source", ZENMODE_SCOUT_SOURCE);
  if (error) return false;
  return (count ?? 0) === 0;
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
  let query = client
    .from("prospects")
    .select("company_name, metadata")
    .eq("organization_id", input.organizationId)
    .eq("source", ZENMODE_SCOUT_SOURCE);

  // Push the surname into the query so the read stays small enough that the row
  // ceiling is never the thing deciding the answer.
  const surname = surnameFilterToken(input.fullName);
  if (surname) {
    query = query.ilike("metadata->zenmode->>name", `%${surname}%`);
  }

  const { data, error } = await query.limit(POOL_READ_LIMIT);

  if (error) {
    throw new Error(`Could not read the ZenMode lead pool: ${error.message}`);
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const truncated = rows.length >= POOL_READ_LIMIT;

  const pool: LinkedinCandidate[] = [];
  for (const row of rows) {
    const candidate = candidateFrom(row);
    if (candidate) pool.push(candidate);
  }

  if (pool.length === 0) {
    // The surname filter means zero rows is ambiguous: it could be "nobody by
    // that name" OR "no leads at all", and those deserve different answers. One
    // cheap count settles it rather than guessing. Only runs on a miss.
    const emptyPool = surname ? await poolIsEmpty(client, input.organizationId) : true;
    return {
      candidates: [],
      noMatchReason: emptyPool ? EMPTY_POOL_REASON : NO_POOL_MATCH_REASON,
      poolSize: 0,
      truncated,
    };
  }

  // Same ranking the Linki path used: name is the identity anchor, company /
  // title / location are evidence, and a name match alone is never enough.
  const { ranked } = rankCandidates(input, pool);

  if (ranked.length === 0) {
    return {
      candidates: [],
      noMatchReason: truncated ? POOL_TRUNCATED_REASON : NO_POOL_MATCH_REASON,
      poolSize: pool.length,
      truncated,
    };
  }
  return { candidates: ranked, noMatchReason: null, poolSize: pool.length, truncated };
}
