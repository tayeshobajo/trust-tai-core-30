/**
 * Scout people research, read from the browser.
 *
 * The browser never speaks to Apollo or Clay: it asks the Trust Tai server
 * route, which holds the credentials. Everything here is one signed-in
 * member's request, and nothing is spent unless a person clicked for it.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import {
  inferBuyingRole,
  type EnrichmentProviderId,
  type OpportunityContext,
  type ScoutPerson,
} from "@/domain/scout-people";

const ENDPOINT = "/api/public/scout/people";

export interface EnrichmentStatusRead {
  connected: boolean;
  apolloConfigured: boolean;
  clayConfigured: boolean;
  order: EnrichmentProviderId[];
  automaticEnrichment: boolean;
}

async function token(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function readEnrichmentStatus(): Promise<EnrichmentStatusRead> {
  const response = await fetch(ENDPOINT, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    return {
      connected: false,
      apolloConfigured: false,
      clayConfigured: false,
      order: [],
      automaticEnrichment: false,
    };
  }
  return (await response.json()) as EnrichmentStatusRead;
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const accessToken = await token();
  if (!accessToken) throw new Error("Sign in to research people.");
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload["error"] === "string" ? payload["error"] : "That request could not be finished.",
    );
  }
  return payload;
}

export interface DiscoverInput {
  organizationId: string;
  companyName: string;
  domain?: string | undefined;
  opportunity: OpportunityContext;
}

/** Search for the people who could own or influence this problem. No spend. */
export async function discoverPeople(input: DiscoverInput): Promise<ScoutPerson[]> {
  const payload = await post({
    action: "discover",
    organizationId: input.organizationId,
    companyName: input.companyName,
    ...(input.domain ? { domain: input.domain } : {}),
    roleFamilies: input.opportunity.functionalOwners,
  });

  const provider = (payload["provider"] as EnrichmentProviderId) ?? "other";
  const rows = Array.isArray(payload["people"]) ? (payload["people"] as Record<string, unknown>[]) : [];
  const discoveredAt = new Date().toISOString();

  return rows.flatMap((row, index) => {
    const fullName = typeof row["fullName"] === "string" ? row["fullName"] : "";
    if (!fullName) return [];
    const title = typeof row["title"] === "string" ? row["title"] : undefined;
    const evidence = typeof row["evidence"] === "string" ? row["evidence"] : undefined;
    const leadership =
      row["thoughtLeadership"] && typeof row["thoughtLeadership"] === "object"
        ? (row["thoughtLeadership"] as { summary?: string; sourceUrl?: string })
        : null;
    const thoughtLeadership =
      leadership?.summary
        ? {
            summary: leadership.summary,
            ...(leadership.sourceUrl ? { sourceUrl: leadership.sourceUrl } : {}),
            provider,
            observedAt: discoveredAt,
          }
        : null;

    const role = inferBuyingRole({
      title,
      opportunity: input.opportunity,
      thoughtLeadership,
    });

    const person: ScoutPerson = {
      key:
        typeof row["providerPersonId"] === "string"
          ? `${provider}:${row["providerPersonId"]}`
          : `${provider}:${fullName.toLowerCase().replace(/\s+/g, "-")}:${index}`,
      fullName,
      companyName:
        typeof row["companyName"] === "string" ? row["companyName"] : input.companyName,
      ...(title ? { title } : {}),
      ...(typeof row["companyDomain"] === "string"
        ? { companyDomain: row["companyDomain"] }
        : input.domain
          ? { companyDomain: input.domain }
          : {}),
      ...(typeof row["profileUrl"] === "string" ? { profileUrl: row["profileUrl"] } : {}),
      ...(typeof row["providerPersonId"] === "string"
        ? { providerPersonId: row["providerPersonId"] }
        : {}),
      buyingRole: role.role,
      ...(role.evidence ? { buyingRoleEvidence: role.evidence } : {}),
      whyThisPerson:
        evidence ??
        (title
          ? `${title} at ${input.companyName}, the function this opportunity touches.`
          : `Listed at ${input.companyName} by ${provider}.`),
      emailStatus: "not_checked",
      provider,
      discoveredAt,
      thoughtLeadership,
      support: evidence ? 20 : 10,
    };
    return [person];
  });
}

export interface EnrichInput {
  organizationId: string;
  person: ScoutPerson;
}

/** One paid lookup for one person, asked for by the person who clicked. */
export async function findWorkEmail(input: EnrichInput): Promise<ScoutPerson> {
  const payload = await post({
    action: "enrich",
    organizationId: input.organizationId,
    companyName: input.person.companyName,
    fullName: input.person.fullName,
    ...(input.person.companyDomain ? { domain: input.person.companyDomain } : {}),
    ...(input.person.providerPersonId
      ? { providerPersonId: input.person.providerPersonId }
      : {}),
    ...(input.person.profileUrl ? { profileUrl: input.person.profileUrl } : {}),
  });

  const email = typeof payload["email"] === "string" ? payload["email"] : null;
  const verified = payload["verified"] === true;
  const at = typeof payload["at"] === "string" ? payload["at"] : new Date().toISOString();
  const provider = (payload["provider"] as EnrichmentProviderId) ?? input.person.provider;

  if (!email) {
    return { ...input.person, emailStatus: "not_found", provider, emailFetchedAt: at };
  }
  return {
    ...input.person,
    workEmail: email,
    emailStatus: verified ? "verified" : "found_unverified",
    provider,
    emailFetchedAt: at,
    ...(verified ? { emailVerifiedAt: at } : {}),
  };
}
