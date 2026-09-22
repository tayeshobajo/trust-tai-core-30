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

import { planPersonResolution, type MemberIdentity } from "@/data/scout/person-resolution";

import { supabaseActivity } from "./activities";
import {
  insertContact,
  listOrganizationContacts,
  listProspectContacts,
  saveProspectContact,
  updateContact,
  type ContactPatch,
} from "./contacts";
import { submissionsForProspect } from "./website-service";

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
  /**
   * Capped to "found" | "unknown" on purpose: an address entered by hand is
   * never more than found. "verified" is earned through confirmEmail or
   * setRoute with an explicit human confirmation, never handed in here.
   */
  emailStatus?: Extract<EmailStatus, "found" | "unknown"> | undefined;
  linkedinUrl?: string | undefined;
  phone?: string | undefined;
}

export interface ManualPersonResult {
  person: Person;
  /**
   * True when this person was already on record and the entry filled gaps on
   * that record. The caller says so out loud, otherwise adding somebody twice
   * looks like a form that did nothing.
   */
  matchedExisting: boolean;
}

/** What a member can put on record as a way to reach somebody. */
export interface RouteInput {
  email?: string | undefined;
  /** The member states they have checked the address is right. */
  emailConfirmed?: boolean | undefined;
  linkedinUrl?: string | undefined;
  /** The member states this profile is the right person. */
  linkedinConfirmed?: boolean | undefined;
}

const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/**
 * A LinkedIn route has to actually be on LinkedIn. The host is matched as a
 * domain rather than as a suffix, so a lookalike like `my-linkedin.com` is not
 * accepted as the real thing.
 */
function isLinkedinProfileUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com");
}

export interface IngestResult {
  providerId: string;
  added: Person[];
  /** Drafts skipped because a human already owns that record. */
  skipped: number;
  /** Nothing was found, or the source is approved but not wired yet. */
  note?: string;
}

/** The ZenMode lead pool, searched locally. Replaced the Linki lookup on
 * 2026-09-09 — see `zenmode-pool-lookup.server.ts` for why. */
const ROUTE_LOOKUP_ENDPOINT = "/api/public/zenmode/lookup";

export interface RouteLookupInput {
  fullName: string;
  companyName?: string | undefined;
  companyDomain?: string | undefined;
  roleTitle?: string | undefined;
  location?: string | undefined;
  organizationId: ID;
}

export interface RouteLookupCandidate {
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

export interface RouteLookupResult {
  candidates: RouteLookupCandidate[];
  /** Non-null when nothing cleared the confidence bar (fail-closed). Says
   * WHICH "no" it is — an empty lead pool reads differently from a pool that
   * held no confident match. */
  noMatchReason: string | null;
  /** How many ZenMode leads were searched. Makes an empty answer legible. */
  poolSize: number;
}

/**
 * Reuse the people canonical Trust Tai data already holds for this company,
 * then read the company's people again.
 *
 * Deterministic and provenance preserving: an existing contact is linked, not
 * copied; a person named in the intake is recorded in their own words as
 * observed, with an unverified address, because stating an address is not the
 * same as confirming it. Returns an empty list when nothing was resolved.
 */
/**
 * Trust Tai's own people, read as identities rather than as contacts.
 *
 * A workspace member is a known human: Scout must resolve them before it says
 * nobody is known. Read only, and never fatal, an unavailable directory simply
 * contributes nothing.
 */
async function listMemberIdentities(organizationId: ID): Promise<MemberIdentity[]> {
  const memberships = await supabase
    .from("organization_memberships")
    .select("user_id, status")
    .eq("organization_id", organizationId);
  if (memberships.error) return [];

  const ids = ((memberships.data ?? []) as { user_id?: string; status?: string }[])
    .filter((row) => (row.status ?? "active") === "active")
    .map((row) => String(row.user_id ?? ""))
    .filter(Boolean);
  if (ids.length === 0) return [];

  const profiles = await supabase.from("profiles").select("*").in("id", ids);
  if (profiles.error) return [];

  return ((profiles.data ?? []) as Record<string, unknown>[])
    .map((row) => {
      const text = (key: string) => String(row[key] ?? "").trim();
      const email = text("email");
      const fullName = text("full_name") || text("display_name");
      return {
        userId: text("id"),
        fullName,
        email,
        roleTitle: text("job_title") || null,
      } satisfies MemberIdentity;
    })
    .filter((member) => member.userId && member.email && member.fullName);
}

async function resolveKnownPeople(
  stored: Person[],
  prospectId: ID,
  context: PeopleContext,
): Promise<Person[]> {
  const [orgPeople, submissions, members, prospect] = await Promise.all([
    listOrganizationContacts(context.organizationId),
    submissionsForProspect(context.organizationId, prospectId),
    listMemberIdentities(context.organizationId).catch(() => [] as MemberIdentity[]),
    supabase
      .from("prospects")
      .select("website_url")
      .eq("id", prospectId)
      .maybeSingle()
      .then((result) => result.data as { website_url?: string | null } | null),
  ]);

  const plan = planPersonResolution({
    prospectPeople: stored,
    orgPeople,
    submissions,
    members,
    websiteUrl: prospect?.website_url ?? null,
  });
  if (plan.link.length === 0 && plan.create.length === 0) return [];

  for (const link of plan.link) {
    const existing = orgPeople.find((person) => person.id === link.contactId);
    const person = await updateContact(
      link.contactId,
      {
        prospectId,
        // Only gaps are filled. A human-confirmed record keeps its own truth.
        ...(existing && existing.confidence === "human_confirmed"
          ? {}
          : { confidence: "observed" as const }),
      },
      context.userId,
    );
    await record(
      context,
      "updated",
      person,
      `${person.fullName} was already known to Trust Tai and was matched to this company.`,
      {
        resolution: link.reason,
        resolution_note: link.note,
        reused_existing_record: true,
      },
    );
  }

  for (const draft of plan.create) {
    const person = await insertContact({
      organizationId: context.organizationId,
      prospectId,
      userId: context.userId,
      fullName: draft.fullName,
      ...(draft.roleTitle ? { roleTitle: draft.roleTitle } : {}),
      seniority: draft.seniority,
      ...(draft.email ? { email: draft.email } : {}),
      // Their own words: read, not verified. Nobody has checked the address.
      emailStatus: draft.email ? "found" : "unknown",
      confidence: "observed",
      sourceId:
        draft.reason === "workspace_member" ? "trust_tai_workspace" : "website_roadmap_intake",
      note: draft.note,
    });
    await record(
      context,
      "created",
      person,
      draft.reason === "workspace_member"
        ? `${person.fullName} is a Trust Tai workspace member on this company's own domain.`
        : `${person.fullName} was recorded from what they said in the roadmap intake.`,
      {
        resolution: draft.reason,
        resolution_note: draft.note,
        ...(draft.submissionId ? { submission_id: draft.submissionId } : {}),
        ...(draft.memberUserId ? { member_user_id: draft.memberUserId } : {}),
      },
    );
  }

  return listProspectContacts(context.organizationId, prospectId);
}

export const peopleService = {
  /**
   * Everyone on record for a company.
   *
   * Before Scout is allowed to say nobody is known, it resolves the people
   * canonical Trust Tai data already holds for this same company: the person
   * who filled in the roadmap intake, and anyone already on record with a
   * business address on the company's own domain. Existing records are reused,
   * never duplicated, and a human-confirmed record is never rewritten.
   *
   * Resolution only runs when a signed-in member is on the call, because
   * linking and recording are provenance-stamped acts.
   */
  async list(organizationId: ID, prospectId: ID, context?: PeopleContext): Promise<Person[]> {
    const stored = await listProspectContacts(organizationId, prospectId);
    if (!context) return stored;
    try {
      const resolved = await resolveKnownPeople(stored, prospectId, context);
      return resolved.length > 0 ? resolved : stored;
    } catch {
      // Resolution is an improvement on the read, never a reason to fail it.
      return stored;
    }
  },

  /**
   * A person added by hand. Always outranks anything a provider asserts.
   *
   * Somebody already on record is matched rather than written again, so the
   * board never holds the same human twice.
   */
  async addManual(input: ManualPersonInput, context: PeopleContext): Promise<ManualPersonResult> {
    const fullName = input.fullName.trim();
    if (!fullName) throw new Error("A person needs a name before they can be saved.");

    const { person, matched } = await saveProspectContact({
      organizationId: context.organizationId,
      prospectId: input.prospectId,
      userId: context.userId,
      fullName,
      roleTitle: input.roleTitle?.trim() || undefined,
      seniority: input.seniority ?? guessSeniority(input.roleTitle),
      email: input.email?.trim().toLowerCase() || undefined,
      // Belt to the type's braces: even a caller that dodges the compiler
      // cannot write more than "found" from a by-hand entry.
      emailStatus:
        input.emailStatus === "found" || input.emailStatus === "unknown"
          ? input.emailStatus
          : input.email?.trim()
            ? "found"
            : "unknown",
      confidence: "human_confirmed",
      linkedinUrl: input.linkedinUrl?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      sourceId: "manual",
    });

    await record(
      context,
      matched ? "updated" : "created",
      person,
      matched
        ? `${person.fullName} was already on record, so what was entered by hand in Scout went onto that record.`
        : `${person.fullName} was added by hand in Scout.`,
      {
        role_title: person.roleTitle ?? null,
        entered_by: "human",
        ...(matched ? { matched_existing_record: true } : {}),
      },
    );

    return { person, matchedExisting: matched };
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

  /**
   * Carry a provider-verified professional address, already stored on a
   * durable Scout People row, onto the shared people record.
   *
   * The verification is the provider's claim, not this app's: it may only be
   * written when the address came back verified from a lookup that was saved
   * (`scoutPersonId`). Nothing here asks a provider anything, so no credit is
   * spent, and a title the lookup recovered travels with the address so the
   * Comms handoff opens on a real person, not a nameless role.
   */
  async recordProviderVerifiedEmail(
    person: Person,
    input: {
      email: string;
      /** The durable Scout People row the verification is stored on. */
      scoutPersonId: string;
      providerLabel: string;
      roleTitle?: string | undefined;
    },
    context: PeopleContext,
  ): Promise<Person> {
    const email = input.email.trim().toLowerCase();
    if (!email) throw new Error("There is no address to carry across.");
    if (!input.scoutPersonId.trim()) {
      throw new Error("Only an address saved on a Scout person can be carried across as verified.");
    }

    const updated = await updateContact(
      person.id,
      {
        email,
        emailStatus: "verified",
        emailCheckedBy: input.providerLabel,
        ...(input.roleTitle?.trim() && !person.roleTitle
          ? { roleTitle: input.roleTitle.trim() }
          : {}),
      },
      context.userId,
    );
    await record(
      context,
      "updated",
      updated,
      `${updated.fullName}'s professional address was verified by ${input.providerLabel} and saved in Scout, so it now stands on the shared record.`,
      { provider: input.providerLabel, scout_person_id: input.scoutPersonId },
    );
    return updated;
  },



  /**
   * Put a way of reaching somebody already on record: an address, a LinkedIn
   * profile, or both.
   *
   * Saving and confirming are two different acts. An address saved without a
   * member confirming it stays unsendable, because reachability asks for
   * "verified" and nothing here grants that on its own. That is deliberate: a
   * guessed address that gets emailed anyway is how a sending domain is burned.
   */
  async setRoute(person: Person, input: RouteInput, context: PeopleContext): Promise<Person> {
    const email = input.email?.trim().toLowerCase() || undefined;
    const linkedinUrl = input.linkedinUrl?.trim() || undefined;

    if (!email && !linkedinUrl) {
      throw new Error("Add a business email or a LinkedIn profile link before saving.");
    }
    if (email && !EMAIL_PATTERN.test(email)) {
      throw new Error("That does not look like an email address. Check it and try again.");
    }
    if (linkedinUrl && !isLinkedinProfileUrl(linkedinUrl)) {
      throw new Error("A LinkedIn route needs a link to a profile on linkedin.com.");
    }

    const patch: ContactPatch = {};
    if (email) {
      patch.email = email;
      if (input.emailConfirmed) {
        patch.emailStatus = "verified";
        patch.confidence = "human_confirmed";
        patch.emailCheckedBy = "human";
      } else if (email === person.email?.toLowerCase() && person.emailStatus === "verified") {
        // Re-typing your own verified address without the checkbox is not
        // new doubt; the confirmation already given stands. Only a DIFFERENT
        // address arriving unconfirmed drops back to "found" below.
        patch.emailStatus = "verified";
      } else {
        // On record, and still nobody's word that it is right.
        patch.emailStatus = "found";
      }
    }
    if (linkedinUrl) {
      patch.linkedinUrl = linkedinUrl;
      if (input.linkedinConfirmed) {
        patch.linkedinConfirmed = true;
        patch.linkedinProvider = "manual";
        patch.linkedinConfidence = "confirmed";
        patch.confidence = "human_confirmed";
      }
    }

    const updated = await updateContact(person.id, patch, context.userId);

    const added: string[] = [];
    if (email) {
      added.push(
        input.emailConfirmed
          ? "a confirmed business email"
          : "a business email nobody has checked yet",
      );
    }
    if (linkedinUrl) {
      added.push(
        input.linkedinConfirmed
          ? "a confirmed LinkedIn route"
          : "a LinkedIn link that is not a confirmed route yet",
      );
    }
    await record(
      context,
      "updated",
      updated,
      `A Trust Tai member put ${added.join(" and ")} on record for ${updated.fullName}.`,
      {
        entered_by: "human",
        ...(email ? { email_confirmed: Boolean(input.emailConfirmed) } : {}),
        ...(linkedinUrl
          ? { linkedin_url: linkedinUrl, linkedin_confirmed: Boolean(input.linkedinConfirmed) }
          : {}),
      },
    );
    return updated;
  },

  /**
   * Search the leads a ZenMode campaign already found. Browser -> Trust Tai
   * server -> Supabase, and it stops there: nothing contacts LinkedIn, so this
   * cannot be rate-limited or blocked the way the old Linki search was.
   */
  async lookupLinkedinCandidates(input: RouteLookupInput): Promise<RouteLookupResult> {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      throw new Error("Your session has expired. Sign in again to search contact routes.");
    }

    const response = await fetch(ROUTE_LOOKUP_ENDPOINT, {
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
      pool_size?: unknown;
    } = {};
    try {
      payload = (await response.json()) as {
        error?: string;
        candidates?: unknown;
        no_match_reason?: unknown;
        pool_size?: unknown;
      };
    } catch {
      payload = {};
    }

    if (!response.ok) {
      throw new Error(
        payload.error ||
          (response.status === 401
            ? "Your session has expired. Sign in again to search contact routes."
            : "The contact route search failed. Nothing was changed."),
      );
    }

    const noMatchReason =
      typeof payload.no_match_reason === "string" && payload.no_match_reason.trim()
        ? payload.no_match_reason
        : null;
    return {
      candidates: Array.isArray(payload.candidates)
        ? (payload.candidates as RouteLookupCandidate[])
        : [],
      noMatchReason,
      poolSize: typeof payload.pool_size === "number" ? payload.pool_size : 0,
    };
  },

  /** A human confirms which LinkedIn profile is the legitimate route. */
  async confirmLinkedinRoute(
    person: Person,
    match: RouteLookupCandidate,
    context: PeopleContext,
  ): Promise<Person> {
    const updated = await updateContact(
      person.id,
      {
        linkedinUrl: match.linkedinUrl,
        linkedinConfirmed: true,
        linkedinProvider: "zenmode",
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
        linkedin_provider: "zenmode",
        linkedin_url: match.linkedinUrl,
      },
    );
    return updated;
  },
};
