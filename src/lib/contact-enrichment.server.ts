/**
 * Contact discovery and work-email enrichment (server only).
 *
 * Two vendors are supported behind one shape: Apollo first, Clay second. The
 * product is not married to either, and neither key ever reaches the browser
 * or a log line.
 *
 * Honesty rules built into this file:
 *  1. A provider is configured only when this app runtime holds its key. A
 *     connector authorised somewhere else is not this app's credential.
 *  2. Search and paid enrichment are separate calls. Searching never quietly
 *     buys enrichment.
 *  3. An address is only "verified" when the provider's own evidence says so.
 *  4. One attempt per provider. The second provider is tried only when the
 *     first failed in a way that could succeed elsewhere (network, timeout,
 *     rate limit, provider outage). An auth, permission or credit failure
 *     stops the run, so a broken account is never charged in a loop.
 */

import type { EnrichmentProviderId } from "@/domain/scout-people";

const GATEWAY = "https://connector-gateway.lovable.dev";

type Env = Record<string, string | undefined>;
type FetchLike = typeof fetch;

export interface ProviderPerson {
  providerPersonId?: string;
  fullName: string;
  title?: string;
  profileUrl?: string;
  companyName: string;
  companyDomain?: string;
  /** Only present when the provider returned one. Search rarely does. */
  email?: string;
  /** True only when the provider stated the address is deliverable. */
  emailVerified?: boolean;
  /** The provider's own words about this person, used as evidence. */
  evidence?: string;
  thoughtLeadership?: { summary: string; sourceUrl?: string };
}

export interface PeopleSearchInput {
  companyName: string;
  domain?: string | undefined;
  /** Functional families this opportunity implies. Never a global C-suite rule. */
  roleFamilies: string[];
  /** Apollo seniority bands, when the opportunity implies them. Optional. */
  seniorities?: string[] | undefined;

  limit: number;
}

export interface EmailEnrichmentInput {
  fullName: string;
  companyName: string;
  domain?: string | undefined;
  providerPersonId?: string | undefined;
  profileUrl?: string | undefined;
}

export interface EmailEnrichment {
  email: string | null;
  verified: boolean;
  provider: EnrichmentProviderId;
  /** When the provider answered. Stored as fetched/verified time. */
  at: string;
  because?: string;
}

export interface ContactEnrichmentProvider {
  id: Extract<EnrichmentProviderId, "apollo" | "clay">;
  label: string;
  configured: boolean;
  searchPeople(input: PeopleSearchInput): Promise<ProviderPerson[]>;
  enrichEmail(input: EmailEnrichmentInput): Promise<EmailEnrichment>;
  findThoughtLeadership?(
    input: EmailEnrichmentInput,
  ): Promise<{ summary: string; sourceUrl?: string } | null>;
}

/** Nothing is wired up in this app runtime. */
export class EnrichmentNotConfigured extends Error {
  constructor(message = "Contact enrichment is not connected in this workspace.") {
    super(message);
    this.name = "EnrichmentNotConfigured";
  }
}

/** A provider answered badly. `retryable` decides whether a fallback runs. */
export class ProviderFailure extends Error {
  readonly provider: EnrichmentProviderId;
  readonly status: number;
  readonly retryable: boolean;

  constructor(provider: EnrichmentProviderId, status: number, message: string) {
    super(message);
    this.name = "ProviderFailure";
    this.provider = provider;
    this.status = status;
    // 401/402/403 are account problems: another attempt spends without hope.
    this.retryable = status === 0 || status === 429 || status >= 500;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function headers(env: Env, keyName: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env["LOVABLE_API_KEY"] ?? ""}`,
    "X-Connection-Api-Key": env[keyName] ?? "",
  };
}

/**
 * Apollo transport.
 *
 * Two shapes are supported and the key never leaves this module:
 *  - direct (default): the workspace holds its own Apollo key, so the request
 *    goes to Apollo with `X-Api-Key`.
 *  - gateway: only when APOLLO_VIA_CONNECTOR_GATEWAY is "true" and this runtime
 *    also holds a Lovable key, meaning the Apollo credential is a Lovable
 *    connection key rather than an Apollo one.
 */
const APOLLO_DIRECT = "https://api.apollo.io";

function apolloViaGateway(env: Env): boolean {
  return env["APOLLO_VIA_CONNECTOR_GATEWAY"] === "true";
}

function apolloUrl(env: Env, path: string): string {
  return apolloViaGateway(env) ? `${GATEWAY}/apollo${path}` : `${APOLLO_DIRECT}${path}`;
}

function apolloHeaders(env: Env): Record<string, string> {
  if (apolloViaGateway(env)) return headers(env, "APOLLO_API_KEY");
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    // Apollo's own scheme. Never a query parameter, never a bearer token.
    "X-Api-Key": env["APOLLO_API_KEY"] ?? "",
  };
}


/** Never let a key or a header reach an error message. */
async function readOrThrow(
  provider: EnrichmentProviderId,
  response: Response,
): Promise<Record<string, unknown>> {
  if (!response.ok) {
    const body = (await response.text()).slice(0, 400);
    throw new ProviderFailure(
      provider,
      response.status,
      `${provider} returned ${response.status}: ${body}`,
    );
  }
  return (await response.json()) as Record<string, unknown>;
}

/* ------------------------------------------------------------- Apollo */

function apolloTitles(roleFamilies: string[]): string[] {
  return roleFamilies.filter((family) => family.trim().length > 0).slice(0, 8);
}

export function apolloProvider(env: Env, fetchImpl: FetchLike): ContactEnrichmentProvider {
  // Apollo is configured when THIS runtime holds an Apollo key. A connector
  // authorised elsewhere is not this app's credential.
  const configured = Boolean(
    env["APOLLO_API_KEY"]?.trim() && (!apolloViaGateway(env) || env["LOVABLE_API_KEY"]?.trim()),
  );


  return {
    id: "apollo",
    label: "Apollo",
    configured,

    async searchPeople(input) {
      if (!configured) throw new EnrichmentNotConfigured();
      const url = new URL(apolloUrl(env, "/api/v1/mixed_people/api_search"));
      const params = new URLSearchParams({
        per_page: String(Math.min(Math.max(input.limit, 1), 25)),
        page: "1",
      });
      if (input.domain) params.append("q_organization_domains_list[]", input.domain);
      else params.append("q_organization_name", input.companyName);
      for (const title of apolloTitles(input.roleFamilies)) {
        params.append("person_titles[]", title);
      }
      for (const seniority of input.seniorities ?? []) {
        params.append("person_seniorities[]", seniority);
      }
      url.search = params.toString();

      let response: Response;
      try {
        response = await fetchImpl(url, { method: "POST", headers: apolloHeaders(env) });
      } catch (error) {
        throw new ProviderFailure("apollo", 0, error instanceof Error ? error.message : "no answer");
      }

      const body = await readOrThrow("apollo", response);
      const people = Array.isArray(body["people"]) ? (body["people"] as unknown[]) : [];

      return people.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const row = entry as Record<string, Record<string, unknown> | unknown>;
        const fullName = text(row["name"]);
        if (!fullName) return [];
        const organization = (row["organization"] ?? {}) as Record<string, unknown>;
        const person: ProviderPerson = {
          fullName,
          companyName: text(organization["name"]) ?? input.companyName,
          ...(text(row["id"]) ? { providerPersonId: text(row["id"])! } : {}),
          ...(text(row["title"]) ? { title: text(row["title"])! } : {}),
          ...(text(row["linkedin_url"]) ? { profileUrl: text(row["linkedin_url"])! } : {}),
          ...(text(organization["primary_domain"]) || input.domain
            ? { companyDomain: text(organization["primary_domain"]) ?? input.domain! }
            : {}),
          // Apollo search does not return an address. Anything that looks like
          // one here is masked, so it is deliberately ignored.
          ...(text(row["headline"]) ? { evidence: text(row["headline"])! } : {}),
        };
        return [person];
      });
    },

    async enrichEmail(input) {
      if (!configured) throw new EnrichmentNotConfigured();
      const at = new Date().toISOString();
      let response: Response;
      try {
        response = await fetchImpl(apolloUrl(env, "/api/v1/people/bulk_match"), {
          method: "POST",
          headers: apolloHeaders(env),

          body: JSON.stringify({
            details: [
              {
                name: input.fullName,
                ...(input.domain ? { domain: input.domain } : {}),
                ...(input.providerPersonId ? { id: input.providerPersonId } : {}),
                ...(input.profileUrl ? { linkedin_url: input.profileUrl } : {}),
                organization_name: input.companyName,
              },
            ],
            // Phone numbers are out of scope for this capability.
            reveal_phone_number: false,
          }),
        });
      } catch (error) {
        throw new ProviderFailure("apollo", 0, error instanceof Error ? error.message : "no answer");
      }
      const body = await readOrThrow("apollo", response);
      const matches = Array.isArray(body["matches"]) ? (body["matches"] as unknown[]) : [];
      const match = (matches[0] ?? {}) as Record<string, unknown>;
      const email = text(match["email"]) ?? null;
      const status = text(match["email_status"]);
      return {
        email,
        verified: status === "verified",
        provider: "apollo",
        at,
        ...(email
          ? status
            ? { because: `Apollo reported this address as ${status}.` }
            : { because: "Apollo returned this address without a verification state." }
          : { because: "Apollo had no professional address for this person." }),
      };
    },
  };
}

/* --------------------------------------------------------------- Clay */

export function clayProvider(env: Env, fetchImpl: FetchLike): ContactEnrichmentProvider {
  const configured = Boolean(env["CLAY_API_KEY"]?.trim() && env["LOVABLE_API_KEY"]?.trim());
  const emailRoutine = env["CLAY_EMAIL_ROUTINE_ID"]?.trim();
  const leadershipRoutine = env["CLAY_THOUGHT_LEADERSHIP_ROUTINE_ID"]?.trim();

  async function runRoutine(
    routineId: string,
    inputs: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetchImpl(`${GATEWAY}/clay/routines/${routineId}/run`, {
        method: "POST",
        headers: headers(env, "CLAY_API_KEY"),
        body: JSON.stringify({ items: [{ id: "person-1", inputs }] }),
      });
    } catch (error) {
      throw new ProviderFailure("clay", 0, error instanceof Error ? error.message : "no answer");
    }
    return readOrThrow("clay", response);
  }

  return {
    id: "clay",
    label: "Clay",
    configured,

    async searchPeople(input) {
      if (!configured) throw new EnrichmentNotConfigured();
      let created: Response;
      try {
        created = await fetchImpl(`${GATEWAY}/clay/search/filters-mode`, {
          method: "POST",
          headers: headers(env, "CLAY_API_KEY"),
          body: JSON.stringify({
            source_type: "people",
            filters: {
              company_identifier: [input.domain ?? input.companyName],
              ...(input.roleFamilies.length ? { about_keywords: input.roleFamilies } : {}),
            },
          }),
        });
      } catch (error) {
        throw new ProviderFailure("clay", 0, error instanceof Error ? error.message : "no answer");
      }
      const searchBody = await readOrThrow("clay", created);
      const searchId = text(searchBody["search_id"]);
      if (!searchId) return [];

      const runResponse = await fetchImpl(`${GATEWAY}/clay/search/filters-mode/${searchId}/run`, {
        method: "POST",
        headers: headers(env, "CLAY_API_KEY"),
        body: JSON.stringify({ limit: Math.min(Math.max(input.limit, 1), 25) }),
      });
      const runBody = await readOrThrow("clay", runResponse);
      const rows = Array.isArray(runBody["data"]) ? (runBody["data"] as unknown[]) : [];

      return rows.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const row = entry as Record<string, unknown>;
        const fullName = text(row["name"]) ?? text(row["full_name"]);
        if (!fullName) return [];
        const person: ProviderPerson = {
          fullName,
          companyName: text(row["company_name"]) ?? input.companyName,
          ...(text(row["id"]) ? { providerPersonId: text(row["id"])! } : {}),
          ...(text(row["title"]) ? { title: text(row["title"])! } : {}),
          ...(text(row["linkedin_url"]) ? { profileUrl: text(row["linkedin_url"])! } : {}),
          ...(text(row["company_domain"]) || input.domain
            ? { companyDomain: text(row["company_domain"]) ?? input.domain! }
            : {}),
          ...(text(row["about"]) ? { evidence: text(row["about"])! } : {}),
        };
        return [person];
      });
    },

    async enrichEmail(input) {
      if (!configured) throw new EnrichmentNotConfigured();
      if (!emailRoutine) {
        throw new EnrichmentNotConfigured(
          "Clay is connected, but no email enrichment routine is configured for this workspace.",
        );
      }
      const at = new Date().toISOString();
      const body = await runRoutine(emailRoutine, {
        full_name: input.fullName,
        company: input.companyName,
        ...(input.domain ? { domain: input.domain } : {}),
        ...(input.profileUrl ? { linkedin_url: input.profileUrl } : {}),
      });
      const results = Array.isArray(body["results"]) ? (body["results"] as unknown[]) : [];
      const first = (results[0] ?? {}) as Record<string, unknown>;
      const output = (first["outputs"] ?? first) as Record<string, unknown>;
      const email = text(output["email"]) ?? text(output["work_email"]) ?? null;
      const verification = text(output["email_status"]) ?? text(output["verification_status"]);
      return {
        email,
        verified: verification === "valid" || verification === "verified",
        provider: "clay",
        at,
        ...(email
          ? verification
            ? { because: `Clay reported this address as ${verification}.` }
            : { because: "Clay returned this address without a verification state." }
          : {
              because:
                body["routine_run_id"] && results.length === 0
                  ? "Clay accepted the lookup and has not answered yet."
                  : "Clay had no professional address for this person.",
            }),
      };
    },

    async findThoughtLeadership(input) {
      if (!configured || !leadershipRoutine) return null;
      const body = await runRoutine(leadershipRoutine, {
        full_name: input.fullName,
        company: input.companyName,
        ...(input.profileUrl ? { linkedin_url: input.profileUrl } : {}),
      });
      const results = Array.isArray(body["results"]) ? (body["results"] as unknown[]) : [];
      const output = ((results[0] as Record<string, unknown>)?.["outputs"] ?? {}) as Record<
        string,
        unknown
      >;
      const summary = text(output["summary"]) ?? text(output["thought_leadership"]);
      if (!summary) return null;
      const sourceUrl = text(output["source_url"]) ?? text(output["url"]);
      return { summary, ...(sourceUrl ? { sourceUrl } : {}) };
    },
  };
}

/* --------------------------------------------------------- selection */

export function enrichmentProviders(
  env: Env = process.env,
  fetchImpl: FetchLike = fetch,
): ContactEnrichmentProvider[] {
  const preference = (env["SCOUT_ENRICHMENT_ORDER"] ?? "apollo,clay")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value === "apollo" || value === "clay");

  const built: Record<string, ContactEnrichmentProvider> = {
    apollo: apolloProvider(env, fetchImpl),
    clay: clayProvider(env, fetchImpl),
  };
  return preference
    .map((id) => built[id])
    .filter((provider): provider is ContactEnrichmentProvider => Boolean(provider?.configured));
}

/** Secret-free status for the browser. Says what is missing, never a key. */
export function enrichmentStatus(env: Env = process.env): {
  connected: boolean;
  apolloConfigured: boolean;
  clayConfigured: boolean;
  order: EnrichmentProviderId[];
  automaticEnrichment: boolean;
} {
  const providers = enrichmentProviders(env, fetch);
  return {
    connected: providers.length > 0,
    apolloConfigured: apolloProvider(env, fetch).configured,
    clayConfigured: clayProvider(env, fetch).configured,
    order: providers.map((provider) => provider.id),
    automaticEnrichment: env["SCOUT_AUTOMATIC_ENRICHMENT"] === "true",
  };
}

/** Search across the configured providers, first one that answers wins. */
export async function searchPeople(
  input: PeopleSearchInput,
  env: Env = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<{ people: ProviderPerson[]; provider: EnrichmentProviderId }> {
  const providers = enrichmentProviders(env, fetchImpl);
  if (providers.length === 0) throw new EnrichmentNotConfigured();

  let lastFailure: ProviderFailure | null = null;
  for (const provider of providers) {
    try {
      return { people: await provider.searchPeople(input), provider: provider.id };
    } catch (error) {
      if (error instanceof ProviderFailure && error.retryable) {
        lastFailure = error;
        continue;
      }
      throw error;
    }
  }
  throw lastFailure ?? new EnrichmentNotConfigured();
}

/**
 * One paid lookup. A second provider runs only after a retryable failure, so
 * the same account is never charged twice for the same refusal.
 */
export async function enrichWorkEmail(
  input: EmailEnrichmentInput,
  env: Env = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<EmailEnrichment & { attempts: EnrichmentProviderId[] }> {
  const providers = enrichmentProviders(env, fetchImpl);
  if (providers.length === 0) throw new EnrichmentNotConfigured();

  const attempts: EnrichmentProviderId[] = [];
  let lastFailure: ProviderFailure | null = null;

  for (const provider of providers) {
    attempts.push(provider.id);
    try {
      const result = await provider.enrichEmail(input);
      return { ...result, attempts };
    } catch (error) {
      if (error instanceof ProviderFailure && error.retryable) {
        lastFailure = error;
        continue;
      }
      throw error;
    }
  }
  throw lastFailure ?? new EnrichmentNotConfigured();
}
