/**
 * ZenMode → Scout lead import — server only.
 *
 * Pulls ZenMode campaign leads (GET /leads) and lands them on the shared
 * `prospects` board ALONGSIDE existing Scout discovery — it never replaces the
 * AI discovery path. Each imported lead becomes a `source='zenmode'` prospect
 * whose provenance carries ZenMode's `campaign_id` + `lead_id` as TRANSPORT
 * ids (never canonical identity) and whose `suggested` holds a plain-English
 * recommendation.
 *
 * Laws (mirror scout-discover.server.ts + the prospects contract):
 *   - `prospects` real columns only: company_name, website_url, status,
 *     source, observed[], inferred, suggested (NOT NULL), provenance,
 *     metadata. There is NO contact_title column — the lead's title rides in
 *     `inferred`/`metadata`, never as a top-level column.
 *   - Dedupe by the lead's LinkedIn URL (stored in provenance/metadata) AND by
 *     ZenMode lead_id. A lead without a LinkedIn URL is skipped — there is no
 *     stable person-route to anchor, and ZenMode is transport, not identity.
 *   - Nothing here creates a contact. A prospect is a company/lead card on the
 *     board; the human-confirm path still owns canonical people.
 *
 * Feature-gated OFF behind `ZENMODE_SCOUT_IMPORT_ENABLED` (default false).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";
import {
  zenModeListAllLeads,
  zenModeListLeads,
  type ZenModeLead,
} from "@/lib/zenmode-provider.server";

export const ZENMODE_SCOUT_SOURCE = "zenmode" as const;

export interface ZenModeImportInput {
  organizationId: string;
  /** Optional authenticated user id; written to `created_by` when present. */
  userId?: string | undefined;
  status?: string | undefined;
  campaignId?: string | undefined;
  limit?: number | undefined;
}

export interface ZenModeImportEnv {
  ZENMODE_SCOUT_IMPORT_ENABLED?: string | undefined;
  ZENMODE_READ_ENABLED?: string | undefined;
  ZENMODE_API_KEY?: string | undefined;
  ZENMODE_BASE_URL?: string | undefined;
}

export interface ZenModeImportResult {
  status: "imported" | "disabled";
  imported: number;
  duplicates: number;
  /** Leads with no LinkedIn route to anchor provenance on. */
  skipped: number;
  importedLeadIds: string[];
  note?: string | undefined;
}

/** Lowercase, strip a trailing slash and www — the same shape used to compare
 * a stored LinkedIn route against an observed one. */
function normalizeLinkedin(url: string | null | undefined): string | null {
  if (!url) return null;
  const clean = url.trim().toLowerCase().replace(/\/+$/, "");
  return clean || null;
}

/**
 * ZenMode's `company` field is derived by naively splitting the LinkedIn
 * headline, so it frequently yields a fragment rather than a business: the
 * headline "Business Owner at Complete Lawn & Yard Care, Inc." arrives as
 * `"Inc."`, and "Owner at Thee Hubbell House B&B Resort --CLOSED. Victim of
 * COVID-19" arrives as `"COVID"`. Left alone those become the prospect's
 * display name on the Scout board. Bare legal suffixes and other one-word
 * residue are therefore rejected outright.
 */
const BARE_COMPANY_RESIDUE = new Set([
  "inc",
  "llc",
  "pllc",
  "llp",
  "ltd",
  "co",
  "corp",
  "corporation",
  "company",
  "group",
  "plc",
  "pc",
  "covid",
]);

/** Role words are never a business name. "CEO / Owner" must not yield
 * "/ Owner", and "Owner | Founder" must not yield "Founder". */
const ROLE_WORDS =
  /^(?:owner|founder|co-?founder|president|ceo|coo|cto|principal|partner|director|operator|entrepreneur|executive|officer|chief|and|&|\/|-|,)$/i;

function isUsableCompany(value: string | null): boolean {
  if (!value) return false;
  const bare = value.toLowerCase().replace(/[.,]/g, "").trim();
  if (bare.length <= 1 || BARE_COMPANY_RESIDUE.has(bare)) return false;
  // A real business name starts with a letter or digit, not punctuation.
  if (!/^[A-Za-z0-9]/.test(value)) return false;
  // Reject a string made only of role words ("Owner and Founder").
  return value.split(/\s+/).some((token) => !ROLE_WORDS.test(token));
}

/**
 * Recover the business name from the headline itself, which is the more
 * reliable source. Handles the connectors LinkedIn owners actually write:
 * "Owner at X", "Owner of X", "Owner, X", "President/Owner @ X", "CEO at X".
 * Returns null when the headline names only a role ("CEO / Owner") — there is
 * no business to name and the caller falls back to the person.
 */
const ROLE = String.raw`\b(?:owner|founder|co-founder|president|ceo|principal|partner|director)\b`;

/**
 * Connectors in priority order. "at"/"@" name the employer directly and win
 * even when an earlier "of" appears inside the role itself — "Owner & Director
 * of Funding at Top Funding" is Top Funding, not "Funding at Top Funding". The
 * `[^,@]*` before "at" is greedy so the LAST "at" wins ("Owner at Bank of
 * America"), while "of" and "," take the FIRST occurrence after the role.
 */
const HEADLINE_PATTERNS: RegExp[] = [
  new RegExp(`${ROLE}[^,@]*\\s+at\\s+(.+)$`, "i"),
  new RegExp(`${ROLE}[^,@]*\\s*@\\s*(.+)$`, "i"),
  new RegExp(`${ROLE}\\s+of\\s+(.+)$`, "i"),
  new RegExp(`${ROLE}\\s*,\\s*(.+)$`, "i"),
];

/** Last resort: "Owner Shane McFarland Construction" — no connector at all.
 * Requires two or more words so "Owner Operator" is not read as a business. */
const BARE_ROLE_PREFIX = new RegExp(`${ROLE}\\s+(\\S+(?:\\s+\\S+)+)$`, "i");

export function companyFromHeadline(title: string | null | undefined): string | null {
  if (!title) return null;
  const head = (title.split("|")[0] ?? title)
    // "Thee Hubbell House B&B Resort --CLOSED. Victim of COVID-19" — cut the
    // editorial aside before matching, or "of COVID-19" wins as a connector.
    .split(/\s+--+/)[0]!
    .trim();

  for (const pattern of [...HEADLINE_PATTERNS, BARE_ROLE_PREFIX]) {
    const candidate = head
      .match(pattern)?.[1]
      ?.replace(/\s+/g, " ")
      .trim()
      .replace(/[.,;:]+$/, "");
    if (candidate && isUsableCompany(candidate)) return candidate;
  }
  return null;
}

/** Headlines that announce the business is gone. Imported, never silently
 * dropped, but flagged so a human sees it before any outreach. */
function reviewFlagsFor(lead: ZenModeLead): string[] {
  const flags: string[] = [];
  const title = lead.title ?? "";
  if (/\bclosed\b|no longer|out of business|retired/i.test(title)) {
    flags.push("headline_says_business_closed");
  }
  if (!lead.title?.trim()) flags.push("no_headline");
  if (!companyFromHeadline(lead.title) && !isUsableCompany(lead.companyName)) {
    flags.push("no_identifiable_business");
  }
  return flags;
}

/** The business this lead represents, best-effort, in trust order:
 * headline extraction → ZenMode's field (if not residue) → the person. */
export function resolveCompanyName(lead: ZenModeLead): string {
  const fromHeadline = companyFromHeadline(lead.title);
  if (fromHeadline) return fromHeadline;
  if (isUsableCompany(lead.companyName)) return lead.companyName!;
  return lead.name ?? "ZenMode lead";
}

function recommendationFor(lead: ZenModeLead): string {
  const who = lead.name ?? "This lead";
  const where = lead.companyName ? ` at ${lead.companyName}` : "";
  return `${who}${where} was surfaced by the ZenMode ICP campaign${
    lead.campaignId ? ` (${lead.campaignId})` : ""
  }. Review the LinkedIn route and confirm fit before any outreach.`;
}

/**
 * Import ZenMode leads as `prospects`. Idempotent across runs: an existing
 * prospect carrying the same LinkedIn route or ZenMode lead_id is counted as a
 * duplicate and left untouched (a human-owned board row is never overwritten
 * by a transport pull).
 */
export async function importZenModeLeadsAsProspects(
  client: SupabaseClient,
  input: ZenModeImportInput,
  env: ZenModeImportEnv = process.env,
): Promise<ZenModeImportResult> {
  if (env["ZENMODE_SCOUT_IMPORT_ENABLED"] !== "true") {
    return {
      status: "disabled",
      imported: 0,
      duplicates: 0,
      skipped: 0,
      importedLeadIds: [],
      note: "ZenMode Scout import is disabled (ZENMODE_SCOUT_IMPORT_ENABLED is not 'true').",
    };
  }

  // Without an explicit limit, page through EVERY lead. A single unbounded
  // call silently stops at ZenMode's default 100 and then reports "no new
  // leads to import" — confident and wrong.
  const filters = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
  };
  const leads = input.limit
    ? await zenModeListLeads(
        { ...filters, limit: input.limit },
        env as Record<string, string | undefined>,
      )
    : await zenModeListAllLeads(filters, env as Record<string, string | undefined>);

  // Existing board rows for this org, to dedupe against by LinkedIn route and
  // ZenMode lead_id (both carried in provenance/metadata, since `prospects`
  // has no person-route column of its own).
  const { data: existingRows, error: readError } = await client
    .from("prospects")
    .select("id, provenance, metadata")
    .eq("organization_id", input.organizationId);
  if (readError) {
    throw new Error(`ZenMode import could not read the Scout board: ${readError.message}`);
  }

  const seenLinkedin = new Set<string>();
  const seenLeadIds = new Set<string>();
  for (const row of (existingRows ?? []) as Record<string, unknown>[]) {
    for (const bag of [row["provenance"], row["metadata"]]) {
      const zm = readZenModeBag(bag);
      const url = normalizeLinkedin(zm.linkedin_url);
      if (url) seenLinkedin.add(url);
      if (zm.lead_id) seenLeadIds.add(zm.lead_id);
    }
  }

  let imported = 0;
  let duplicates = 0;
  let skipped = 0;
  const importedLeadIds: string[] = [];
  const now = new Date().toISOString();

  for (const lead of leads) {
    const linkedin = normalizeLinkedin(lead.linkedinUrl);
    if (!linkedin) {
      // No stable route to anchor provenance on. Never guess an identity.
      skipped += 1;
      continue;
    }
    if (seenLinkedin.has(linkedin) || seenLeadIds.has(lead.leadId)) {
      duplicates += 1;
      continue;
    }
    seenLinkedin.add(linkedin);
    seenLeadIds.add(lead.leadId);

    const reviewFlags = reviewFlagsFor(lead);
    const zenmodeBag = {
      transport: "zenmode",
      lead_id: lead.leadId,
      campaign_id: lead.campaignId,
      linkedin_url: lead.linkedinUrl,
      lead_status: lead.status,
      name: lead.name,
      title: lead.title,
      location: lead.location,
      /** ZenMode's own company guess, kept verbatim next to ours so a human can
       * see when the two disagree. */
      company_reported_by_zenmode: lead.companyName,
      review_flags: reviewFlags,
      observed_at: now,
    };

    const { error: insertError } = await client.from("prospects").insert({
      organization_id: input.organizationId,
      company_name: resolveCompanyName(lead),
      website_url: lead.websiteUrl,
      status: "discovered",
      source: ZENMODE_SCOUT_SOURCE,
      observed: [],
      inferred: {
        name: lead.name,
        title: lead.title,
        location: lead.location,
        lead_status: lead.status,
        linkedin_url: lead.linkedinUrl,
        review_flags: reviewFlags,
      },
      suggested: { recommendation: recommendationFor(lead) },
      provenance: {
        app_key: "scout",
        app: "scout",
        source: ZENMODE_SCOUT_SOURCE,
        transport: "zenmode",
        campaign_id: lead.campaignId,
        lead_id: lead.leadId,
        linkedin_url: lead.linkedinUrl,
        observed_at: now,
        actor: { type: "system", id: "zenmode-scout-import", label: "ZenMode lead import" },
      },
      metadata: { zenmode: zenmodeBag },
      ...(input.userId ? { created_by: input.userId } : {}),
    });
    if (insertError) {
      throw new Error(`ZenMode import could not add a prospect: ${insertError.message}`);
    }
    imported += 1;
    importedLeadIds.push(lead.leadId);
  }

  return {
    status: "imported",
    imported,
    duplicates,
    skipped,
    importedLeadIds,
    ...(imported === 0
      ? { note: "ZenMode returned no new leads to import for this organization." }
      : {}),
  };
}

/** Why an authenticated import refused, when it refused. Distinct from a
 * successful import of zero leads, which is a legitimate outcome. */
export type ZenModeImportRefusal = "unauthenticated" | "no_membership";

export interface ZenModeImportRequest {
  /** The caller's Trust Tai Supabase access token. Never a service-role key. */
  token: string;
  /** Optional explicit workspace; must be one the caller actually belongs to. */
  organizationId?: string | undefined;
  status?: string | undefined;
  campaignId?: string | undefined;
  limit?: number | undefined;
}

/**
 * The import as a human triggers it: verify the caller's token, resolve their
 * organization membership SERVER-SIDE (never trusted from the client), then run
 * the import with the CALLER'S token so Supabase RLS and the organization
 * boundary still apply. No service-role key is used here — same law as
 * scout-discover.server.ts.
 *
 * Returns a refusal rather than throwing, so the route can map it to a status
 * code without inspecting error strings.
 */
export async function runZenModeImportForCaller(
  input: ZenModeImportRequest,
  env: ZenModeImportEnv = process.env,
): Promise<
  | { ok: true; organizationId: string; result: ZenModeImportResult }
  | { ok: false; refusal: ZenModeImportRefusal }
> {
  const supabaseKey = trustTaiSupabaseKey();
  const client = createClient(trustTaiSupabaseUrl(), supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${input.token}`, apikey: supabaseKey } },
  });

  const { data: userData, error: userError } = await client.auth.getUser(input.token);
  const user = userData?.user;
  if (userError || !user) return { ok: false, refusal: "unauthenticated" };

  const { data: memberships } = await client
    .from("organization_memberships")
    .select("organization_id, role, status")
    .eq("user_id", user.id);
  const active = (memberships ?? []).filter(
    (row) => ((row as Record<string, unknown>)["status"] ?? "active") === "active",
  ) as Record<string, unknown>[];
  const membership = input.organizationId
    ? active.find((row) => row["organization_id"] === input.organizationId)
    : active[0];
  if (!membership) return { ok: false, refusal: "no_membership" };
  const organizationId = membership["organization_id"] as string;

  const result = await importZenModeLeadsAsProspects(
    client,
    {
      organizationId,
      userId: user.id,
      ...(input.status ? { status: input.status } : {}),
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
      ...(input.limit ? { limit: input.limit } : {}),
    },
    env,
  );
  return { ok: true, organizationId, result };
}

/** Read the `{ zenmode: {...} }` bag (or a bare bag) off a provenance/metadata
 * value, tolerating either the nested or flat placement. */
function readZenModeBag(bag: unknown): { lead_id?: string; linkedin_url?: string } {
  if (!bag || typeof bag !== "object" || Array.isArray(bag)) return {};
  const record = bag as Record<string, unknown>;
  const nested =
    record["zenmode"] && typeof record["zenmode"] === "object"
      ? (record["zenmode"] as Record<string, unknown>)
      : record;
  const leadId = typeof nested["lead_id"] === "string" ? nested["lead_id"] : undefined;
  const linkedinUrl =
    typeof nested["linkedin_url"] === "string" ? nested["linkedin_url"] : undefined;
  return {
    ...(leadId ? { lead_id: leadId } : {}),
    ...(linkedinUrl ? { linkedin_url: linkedinUrl } : {}),
  };
}
