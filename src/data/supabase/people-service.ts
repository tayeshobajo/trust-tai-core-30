/**
 * Scout, People service.
 *
 * The one place ingestion, manual entry, and human confirmation meet. Every
 * write is organization-scoped, provenance-stamped, and mirrored into the
 * shared activity stream so People events read like everything else in Trust
 * Tai.
 *
 * Ordering rule: a human-owned record is never overwritten by a provider run.
 */

import type { ID } from "@/domain/entities";
import {
  guessSeniority,
  isHumanOwned,
  type EmailStatus,
  type Person,
  type PersonConfidence,
  type PersonDraft,
  type Seniority,
} from "@/domain/people";
import type { ProspectCandidate } from "@/domain/scout";
import { getPeopleProvider } from "@/data/people/registry";
import { supabase } from "@/integrations/trust-tai/supabase";

import { supabaseActivity } from "./activities";
import { insertContact, listProspectContacts, updateContact, type ContactPatch } from "./contacts";

export interface PeopleContext {
  organizationId: ID;
  userId: ID;
}

function sameEmail(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function matches(person: Person, draft: PersonDraft): boolean {
  return sameEmail(person.email, draft.email) || sameName(person.fullName, draft.fullName);
}

async function record(
  context: PeopleContext,
  action: "created" | "updated",
  person: Person,
  summary: string,
  payload: Record<string, unknown>,
) {
  const occurredAt = new Date().toISOString();
  await supabaseActivity.record({
    organizationId: context.organizationId,
    name: `contact.${action}`,
    subject: { type: "contact", id: person.id, label: person.fullName },
    ...(person.prospectId
      ? { related: [{ type: "prospect" as const, id: person.prospectId }] }
      : {}),
    summary,
    payload: { ...payload, source_id: person.sourceId, email_status: person.emailStatus },
    provenance: {
      appId: "scout",
      actor: { type: "user", id: context.userId },
      observedAt: occurredAt,
      confidence: person.confidence === "inferred" ? "inferred" : "observed",
    },
    occurredAt,
  });
}

export interface ManualPersonInput {
  prospectId: ID;
  fullName: string;
  roleTitle?: string | undefined;
  seniority?: Seniority | undefined;
  email?: string | undefined;
  emailStatus?: EmailStatus | undefined;
  linkedinUrl?: string | undefined;
  phone?: string | undefined;
}

export interface IngestResult {
  providerId: string;
  added: Person[];
  /** Drafts skipped because a human already owns that record. */
  skipped: number;
  /** Nothing was found, or the source is approved but not wired yet. */
  note?: string;
}

const LINKI_LOOKUP_ENDPOINT = "/api/public/linki/lookup";

export interface LinkiLookupInput {
  fullName: string;
  companyName?: string | undefined;
  companyDomain?: string | undefined;
  roleTitle?: string | undefined;
  location?: string | undefined;
  organizationId: ID;
}

export interface LinkiLookupCandidate {
  linkedinUrl: string;
  fullName: string;
  headline: string | null;
  location: string | null;
  degree: string | null;
  company: string | null;
  /** Ranking evidence, display-only: "Why this may be the person." */
  why: string[];
  score: number;
}

export interface LinkiLookupResult {
  candidates: LinkiLookupCandidate[];
  /** Non-null when nothing cleared the confidence bar (fail-closed). */
  noMatchReason: string | null;
}

export const peopleService = {
  /** Everyone on record for a company. */
  async list(organizationId: ID, prospectId: ID): Promise<Person[]> {
    return listProspectContacts(organizationId, prospectId);
  },

  /** A person added by hand. Always outranks anything a provider asserts. */
  async addManual(input: ManualPersonInput, context: PeopleContext): Promise<Person> {
    const fullName = input.fullName.trim();
    if (!fullName) throw new Error("A person needs a name before they can be saved.");

    const person = await insertContact({
      organizationId: context.organizationId,
      prospectId: input.prospectId,
      userId: context.userId,
      fullName,
      roleTitle: input.roleTitle?.trim() || undefined,
      seniority: input.seniority ?? guessSeniority(input.roleTitle),
      email: input.email?.trim().toLowerCase() || undefined,
      emailStatus: input.emailStatus ?? (input.email?.trim() ? "found" : "unknown"),
      confidence: "human_confirmed",
      linkedinUrl: input.linkedinUrl?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      sourceId: "manual",
    });

    await record(context, "created", person, `${person.fullName} was added by hand in Scout.`, {
      role_title: person.roleTitle ?? null,
      entered_by: "human",
    });

    return person;
  },

  /**
   * Run one approved source for a company and store what it returns.
   * Existing human-owned records are left exactly as they are.
   */
  async ingest(
    providerId: string,
    candidate: ProspectCandidate,
    context: PeopleContext,
  ): Promise<IngestResult> {
    const provider = getPeopleProvider(providerId);
    if (!provider) {
      throw new Error("That people source is not approved for Trust Tai use.");
    }
    if (!(await provider.available())) {
      return {
        providerId,
        added: [],
        skipped: 0,
        note: `${provider.label} is approved but not connected yet, so nothing was ingested.`,
      };
    }

    const prospectId = candidate.prospect.id;
    const drafts = await provider.discover({
      organizationId: context.organizationId,
      prospectId,
      companyName: candidate.prospect.name,
      ...(candidate.prospect.websiteUrl ? { websiteUrl: candidate.prospect.websiteUrl } : {}),
      ...(candidate.prospect.domain ? { domain: candidate.prospect.domain } : {}),
      ...(candidate.facts ? { facts: candidate.facts } : {}),
      statements: candidate.signals.map((signal) => signal.statement),
    });

    const existing = await listProspectContacts(context.organizationId, prospectId);
    const added: Person[] = [];
    let skipped = 0;

    for (const draft of drafts) {
      const current = existing.find((person) => matches(person, draft));
      if (current) {
        if (isHumanOwned(current)) {
          skipped += 1;
          continue;
        }
        // Fill gaps on a provider-owned record without downgrading anything.
        const patch: ContactPatch = {};
        if (!current.roleTitle && draft.roleTitle) patch.roleTitle = draft.roleTitle;
        if (!current.email && draft.email) {
          patch.email = draft.email;
          patch.emailStatus = draft.emailStatus ?? "found";
        }
        if (Object.keys(patch).length === 0) {
          skipped += 1;
          continue;
        }
        const updated = await updateContact(current.id, patch, context.userId);
        added.push(updated);
        await record(
          context,
          "updated",
          updated,
          `${updated.fullName} was enriched from ${provider.label}.`,
          { provider: provider.id },
        );
        continue;
      }

      const confidence: PersonConfidence = draft.confidence ?? provider.baseConfidence;
      const person = await insertContact({
        organizationId: context.organizationId,
        prospectId,
        userId: context.userId,
        fullName: draft.fullName,
        roleTitle: draft.roleTitle,
        seniority: draft.seniority ?? guessSeniority(draft.roleTitle),
        email: draft.email?.toLowerCase(),
        emailStatus: draft.emailStatus ?? (draft.email ? "found" : "unknown"),
        confidence,
        linkedinUrl: draft.linkedinUrl,
        sourceId: provider.id,
        sourceUrl: draft.sourceUrl,
        note: draft.note,
      });
      added.push(person);
      existing.push(person);
      await record(
        context,
        "created",
        person,
        `${person.fullName} was ingested from ${provider.label}.`,
        { provider: provider.id, role_title: person.roleTitle ?? null },
      );
    }

    return {
      providerId,
      added,
      skipped,
      ...(added.length === 0
        ? {
            note: `${provider.label} returned nothing new for this company.`,
          }
        : {}),
    };
  },

  /** Ask an approved source to test an address. Never guesses a result. */
  async verifyEmail(providerId: string, person: Person, context: PeopleContext): Promise<Person> {
    if (!person.email) throw new Error("There is no address to verify.");
    const provider = getPeopleProvider(providerId);
    if (!provider?.verifyEmail || !(await provider.available())) {
      throw new Error("No approved verification source is connected yet.");
    }
    const result = await provider.verifyEmail(person.email);
    const updated = await updateContact(
      person.id,
      { emailStatus: result.status, emailCheckedBy: provider.label },
      context.userId,
    );
    await record(
      context,
      "updated",
      updated,
      `${updated.fullName}'s address was checked by ${provider.label}: ${result.status}.`,
      { provider: provider.id, result: result.status },
    );
    return updated;
  },

  /** A human vouches for the address. Outranks every provider result. */
  async confirmEmail(person: Person, context: PeopleContext): Promise<Person> {
    if (!person.email) throw new Error("There is no address to confirm.");
    const updated = await updateContact(
      person.id,
      { emailStatus: "verified", confidence: "human_confirmed", emailCheckedBy: "human" },
      context.userId,
    );
    await record(
      context,
      "updated",
      updated,
      `${updated.fullName}'s business email was confirmed by a Trust Tai member.`,
      { confirmed_by: "human" },
    );
    return updated;
  },

  /** Browser -> Trust Tai server -> Linki. The internal secret never leaves the server. */
  async lookupLinkedinCandidates(input: LinkiLookupInput): Promise<LinkiLookupResult> {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      throw new Error("Your session has expired. Sign in again to search LinkedIn routes.");
    }

    const response = await fetch(LINKI_LOOKUP_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        organization_id: input.organizationId,
        full_name: input.fullName,
        ...(input.companyName ? { company_name: input.companyName } : {}),
        ...(input.companyDomain ? { company_domain: input.companyDomain } : {}),
        ...(input.roleTitle ? { role_title: input.roleTitle } : {}),
        ...(input.location ? { location: input.location } : {}),
      }),
    });

    let payload: {
      error?: string;
      candidates?: unknown;
      no_match_reason?: unknown;
    } = {};
    try {
      payload = (await response.json()) as {
        error?: string;
        candidates?: unknown;
        no_match_reason?: unknown;
      };
    } catch {
      payload = {};
    }

    if (!response.ok) {
      throw new Error(
        payload.error ||
          (response.status === 401
            ? "Your session has expired. Sign in again to search LinkedIn routes."
            : "LinkedIn route search failed. Nothing was changed."),
      );
    }

    const noMatchReason =
      typeof payload.no_match_reason === "string" && payload.no_match_reason.trim()
        ? payload.no_match_reason
        : null;
    return {
      candidates: Array.isArray(payload.candidates)
        ? (payload.candidates as LinkiLookupCandidate[])
        : [],
      noMatchReason,
    };
  },

  /** A human confirms which LinkedIn profile is the legitimate route. */
  async confirmLinkedinRoute(
    person: Person,
    match: LinkiLookupCandidate,
    context: PeopleContext,
  ): Promise<Person> {
    const updated = await updateContact(
      person.id,
      {
        linkedinUrl: match.linkedinUrl,
        linkedinConfirmed: true,
        linkedinProvider: "linki",
        linkedinConfidence: "confirmed",
        confidence: "human_confirmed",
      },
      context.userId,
    );
    await record(
      context,
      "updated",
      updated,
      `${updated.fullName}'s LinkedIn route was confirmed by a Trust Tai member.`,
      {
        confirmed_by: "human",
        linkedin_provider: "linki",
        linkedin_url: match.linkedinUrl,
      },
    );
    return updated;
  },
};
