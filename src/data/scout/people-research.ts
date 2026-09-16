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
  /** Present once the person is saved, so the answer is written to their row. */
  prospectId?: string | undefined;
  /**
   * The company this page is about. Used only when the person record carries
   * no company of its own, so a lookup is never refused for a company we can
   * already see on screen.
   */
  companyName?: string | undefined;
  domain?: string | undefined;
}


export interface EnrichResult {
  person: ScoutPerson;
  /** True only when the answer was written to the durable record. */
  persisted: boolean;
  /** Why it was not written, when it was not. */
  because?: string;
}

/** One paid lookup for one person, asked for by the person who clicked. */
export async function findWorkEmail(input: EnrichInput): Promise<EnrichResult> {
  const payload = await post({
    action: "enrich",
    organizationId: input.organizationId,
    companyName: input.person.companyName,
    fullName: input.person.fullName,
    ...(input.prospectId ? { prospectId: input.prospectId } : {}),
    ...(input.person.persistedId ? { personId: input.person.persistedId } : {}),
    ...(input.person.companyDomain ? { domain: input.person.companyDomain } : {}),
    ...(input.person.providerPersonId
      ? { providerPersonId: input.person.providerPersonId }
      : {}),
    ...(input.person.profileUrl ? { profileUrl: input.person.profileUrl } : {}),
  });

  const stored = payload["person"];
  if (stored && typeof stored === "object") {
    return { person: fromStored(stored as Record<string, unknown>), persisted: true };
  }

  const email = typeof payload["email"] === "string" ? payload["email"] : null;
  const verified = payload["verified"] === true;
  const at = typeof payload["at"] === "string" ? payload["at"] : new Date().toISOString();
  const provider = (payload["provider"] as EnrichmentProviderId) ?? input.person.provider;
  const because = typeof payload["because"] === "string" ? payload["because"] : undefined;

  const person: ScoutPerson = email
    ? {
        ...input.person,
        workEmail: email,
        emailStatus: verified ? "verified" : "found_unverified",
        provider,
        emailFetchedAt: at,
        ...(verified ? { emailVerifiedAt: at } : {}),
      }
    : { ...input.person, emailStatus: "not_found", provider, emailFetchedAt: at };

  return { person, persisted: false, ...(because ? { because } : {}) };
}

/* ------------------------------------------------------- durable rows */

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A saved row, read back as the person the card already knows how to show. */
export function fromStored(row: Record<string, unknown>): ScoutPerson {
  const leadership = text(row["thoughtLeadershipSummary"]);
  const provider = (text(row["provider"]) || "other") as EnrichmentProviderId;
  const discoveredAt = text(row["discoveredAt"]) || new Date().toISOString();
  return {
    key: text(row["id"]),
    persistedId: text(row["id"]),
    fullName: text(row["fullName"]),
    ...(text(row["title"]) ? { title: text(row["title"]) } : {}),
    companyName: text(row["companyName"]),
    ...(text(row["companyDomain"]) ? { companyDomain: text(row["companyDomain"]) } : {}),
    ...(text(row["profileUrl"]) ? { profileUrl: text(row["profileUrl"]) } : {}),
    buyingRole: (text(row["buyingRole"]) || "unknown") as ScoutPerson["buyingRole"],
    ...(text(row["buyingRoleEvidence"])
      ? { buyingRoleEvidence: text(row["buyingRoleEvidence"]) }
      : {}),
    whyThisPerson: text(row["whyThisPerson"]),
    ...(text(row["workEmail"]) ? { workEmail: text(row["workEmail"]) } : {}),
    emailStatus: (text(row["emailStatus"]) || "not_checked") as ScoutPerson["emailStatus"],
    provider,
    ...(text(row["providerPersonId"])
      ? { providerPersonId: text(row["providerPersonId"]) }
      : {}),
    discoveredAt,
    ...(text(row["emailFetchedAt"]) ? { emailFetchedAt: text(row["emailFetchedAt"]) } : {}),
    ...(text(row["emailVerifiedAt"]) ? { emailVerifiedAt: text(row["emailVerifiedAt"]) } : {}),
    thoughtLeadership: leadership
      ? {
          summary: leadership,
          ...(text(row["thoughtLeadershipSource"])
            ? { sourceUrl: text(row["thoughtLeadershipSource"]) }
            : {}),
          provider,
          observedAt: discoveredAt,
        }
      : null,
    selectedForOutreach: row["selectedForOutreach"] === true,
    ...(text(row["handoffRelationshipId"])
      ? { handoffRelationshipId: text(row["handoffRelationshipId"]) }
      : {}),
    support: 20,
  };
}

export class ScoutPeopleNotStored extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoutPeopleNotStored";
  }
}

async function durable(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    return await post(body);
  } catch (error) {
    throw error instanceof Error ? new ScoutPeopleNotStored(error.message) : error;
  }
}

/** Everyone already saved for this company. No provider call, no spend. */
export async function listPersistedPeople(input: {
  organizationId: string;
  prospectId: string;
}): Promise<ScoutPerson[]> {
  const payload = await durable({
    action: "list",
    organizationId: input.organizationId,
    prospectId: input.prospectId,
  });
  const rows = Array.isArray(payload["people"])
    ? (payload["people"] as Record<string, unknown>[])
    : [];
  return rows.map(fromStored);
}

/** Save selected research. No address is sent: the server owns that state. */
export async function savePeople(input: {
  organizationId: string;
  prospectId: string;
  people: ScoutPerson[];
}): Promise<ScoutPerson[]> {
  const payload = await durable({
    action: "save",
    organizationId: input.organizationId,
    prospectId: input.prospectId,
    people: input.people.map((person) => ({
      fullName: person.fullName,
      title: person.title,
      companyName: person.companyName,
      companyDomain: person.companyDomain,
      profileUrl: person.profileUrl,
      buyingRole: person.buyingRole,
      buyingRoleEvidence: person.buyingRoleEvidence,
      whyThisPerson: person.whyThisPerson,
      provider: person.provider,
      providerPersonId: person.providerPersonId,
      discoveredAt: person.discoveredAt,
      thoughtLeadership: person.thoughtLeadership,
    })),
  });
  const rows = Array.isArray(payload["people"])
    ? (payload["people"] as Record<string, unknown>[])
    : [];
  return rows.map(fromStored);
}

/** Record which Comms conversation this saved person moved into. */
export async function recordPersonHandoff(input: {
  organizationId: string;
  personId: string;
  relationshipId: string;
  contactId?: string | undefined;
}): Promise<ScoutPerson> {
  const payload = await durable({
    action: "handoff",
    organizationId: input.organizationId,
    personId: input.personId,
    relationshipId: input.relationshipId,
    ...(input.contactId ? { contactId: input.contactId } : {}),
  });
  return fromStored((payload["person"] ?? {}) as Record<string, unknown>);
}
