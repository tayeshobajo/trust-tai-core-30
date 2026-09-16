/**
 * Where Scout's researched people are actually kept (server only).
 *
 * One table, `scout_people`, one row per human per prospect. Everything here
 * runs with the server's own credential, and every statement carries the
 * workspace as an explicit filter. This module never decides who the caller
 * is: the route proves an active membership and a writing role first, and
 * refuses before this file is reached.
 *
 * Two rules are structural, not conventional:
 *   1. The table may not exist yet. That is a gap, reported honestly as
 *      "cannot be saved yet", never a silent success and never a refusal
 *      dressed up as an error.
 *   2. An address state is derived from the provider answer inside
 *      `recordEmail`. Nothing a browser sends can produce "verified".
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  identityKey,
  storedEmailFacts,
  type ProviderEmailAnswer,
  type SavableResearch,
} from "@/domain/scout-people-persistence";
import type { BuyingRole, EnrichmentProviderId, StoredEmailStatus } from "@/domain/scout-people";
import { trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";

const TABLE = "scout_people";

type Row = Record<string, unknown>;

/** The table is not in this database yet. A gap, stated plainly. */
export class ScoutPeopleSchemaUnavailable extends Error {
  constructor(
    message = "Researched people cannot be saved yet: the Scout people table is not in this database.",
  ) {
    super(message);
    this.name = "ScoutPeopleSchemaUnavailable";
  }
}

/** Something went wrong while writing. Nothing was saved. */
export class ScoutPeopleStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoutPeopleStoreError";
  }
}

export function scoutPeopleWriter(): SupabaseClient {
  const key =
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) {
    throw new ScoutPeopleStoreError(
      "Saving researched people is not configured on this server, so nothing was saved.",
    );
  }
  return createClient(trustTaiSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Missing table or missing column. Both mean the schema is not there yet. */
export function missingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42703" || code === "42P01") return true;
  return /does not exist/i.test(error.message ?? "");
}

function isConflict(error: { code?: string } | null): boolean {
  return (error?.code ?? "") === "23505";
}

export interface StoredScoutPerson {
  id: string;
  organizationId: string;
  prospectId: string;
  contactId: string | null;
  fullName: string;
  title: string | null;
  companyName: string;
  companyDomain: string | null;
  profileUrl: string | null;
  buyingRole: BuyingRole;
  buyingRoleEvidence: string | null;
  whyThisPerson: string;
  workEmail: string | null;
  emailStatus: StoredEmailStatus;
  provider: EnrichmentProviderId;
  providerPersonId: string | null;
  matchKind: string;
  matchValue: string;
  discoveredAt: string;
  emailFetchedAt: string | null;
  emailVerifiedAt: string | null;
  thoughtLeadershipSummary: string | null;
  thoughtLeadershipSource: string | null;
  selectedForOutreach: boolean;
  handoffRelationshipId: string | null;
  createdBy: string | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function maybe(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function toStoredPerson(row: Row): StoredScoutPerson {
  return {
    id: text(row["id"]),
    organizationId: text(row["organization_id"]),
    prospectId: text(row["prospect_id"]),
    contactId: maybe(row["contact_id"]),
    fullName: text(row["full_name"]),
    title: maybe(row["title"]),
    companyName: text(row["company_name"]),
    companyDomain: maybe(row["company_domain"]),
    profileUrl: maybe(row["profile_url"]),
    buyingRole: (text(row["buying_role"]) || "unknown") as BuyingRole,
    buyingRoleEvidence: maybe(row["buying_role_evidence"]),
    whyThisPerson: text(row["why_this_person"]),
    workEmail: maybe(row["work_email"]),
    emailStatus: (text(row["email_status"]) || "not_checked") as StoredEmailStatus,
    provider: (text(row["provider"]) || "other") as EnrichmentProviderId,
    providerPersonId: maybe(row["provider_person_id"]),
    matchKind: text(row["match_kind"]),
    matchValue: text(row["match_value"]),
    discoveredAt: text(row["discovered_at"]),
    emailFetchedAt: maybe(row["email_fetched_at"]),
    emailVerifiedAt: maybe(row["email_verified_at"]),
    thoughtLeadershipSummary: maybe(row["thought_leadership_summary"]),
    thoughtLeadershipSource: maybe(row["thought_leadership_source"]),
    selectedForOutreach: row["selected_for_outreach"] === true,
    handoffRelationshipId: maybe(row["handoff_relationship_id"]),
    createdBy: maybe(row["created_by"]),
  };
}

function fail(error: { code?: string; message?: string }, what: string): never {
  if (missingSchema(error)) throw new ScoutPeopleSchemaUnavailable();
  throw new ScoutPeopleStoreError(`${what}: ${error.message ?? "unknown database error"}`);
}

export interface ScoutPeopleStore {
  list(input: { organizationId: string; prospectId: string }): Promise<StoredScoutPerson[]>;
  saveResearch(input: {
    organizationId: string;
    prospectId: string;
    createdBy: string;
    people: SavableResearch[];
  }): Promise<StoredScoutPerson[]>;
  recordEmail(input: {
    organizationId: string;
    prospectId: string;
    personId: string;
    answer: ProviderEmailAnswer;
  }): Promise<StoredScoutPerson>;
  recordHandoff(input: {
    organizationId: string;
    personId: string;
    relationshipId: string;
    contactId?: string | undefined;
  }): Promise<StoredScoutPerson>;
}

export function scoutPeopleStore(deps: { db?: SupabaseClient } = {}): ScoutPeopleStore {
  const db = deps.db ?? scoutPeopleWriter();

  /** The prospect must live in the workspace the caller proved. */
  async function assertProspect(organizationId: string, prospectId: string): Promise<void> {
    const { data, error } = await db
      .from("prospects")
      .select("id")
      .eq("id", prospectId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) fail(error, "That company could not be checked");
    if (!data) {
      throw new ScoutPeopleStoreError("That company is not in this workspace, so nothing was saved.");
    }
  }

  async function readOne(organizationId: string, personId: string): Promise<StoredScoutPerson> {
    const { data, error } = await db
      .from(TABLE)
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", personId)
      .maybeSingle();
    if (error) fail(error, "That person could not be read");
    if (!data) throw new ScoutPeopleStoreError("That person is no longer on record.");
    return toStoredPerson(data as Row);
  }

  return {
    async list({ organizationId, prospectId }) {
      const { data, error } = await db
        .from(TABLE)
        .select("*")
        .eq("organization_id", organizationId)
        .eq("prospect_id", prospectId)
        .order("discovered_at", { ascending: false });
      if (error) fail(error, "Researched people could not be read");
      return ((data ?? []) as Row[]).map(toStoredPerson);
    },

    async saveResearch({ organizationId, prospectId, createdBy, people }) {
      if (people.length === 0) return [];
      await assertProspect(organizationId, prospectId);

      const rows = people.map((person) => {
        const key = identityKey({
          key: person.providerPersonId ?? person.fullName,
          fullName: person.fullName,
          ...(person.providerPersonId ? { providerPersonId: person.providerPersonId } : {}),
          ...(person.profileUrl ? { profileUrl: person.profileUrl } : {}),
        });
        return {
          organization_id: organizationId,
          prospect_id: prospectId,
          full_name: person.fullName,
          title: person.title ?? null,
          company_name: person.companyName,
          company_domain: person.companyDomain ?? null,
          profile_url: person.profileUrl ?? null,
          buying_role: person.buyingRole,
          buying_role_evidence: person.buyingRoleEvidence ?? null,
          why_this_person: person.whyThisPerson,
          provider: person.provider,
          provider_person_id: person.providerPersonId ?? null,
          match_kind: key.kind,
          match_value: key.value,
          discovered_at: person.discoveredAt,
          thought_leadership_summary: person.thoughtLeadershipSummary ?? null,
          thought_leadership_source: person.thoughtLeadershipSource ?? null,
          provenance: {
            discovered_by: person.provider,
            discovered_at: person.discoveredAt,
            match_kind: key.kind,
          },
          created_by: createdBy,
        };
      });

      /* One statement, so two people saving the same research at the same
         moment settle in the database rather than producing two rows.
         Address columns are deliberately absent: an existing row keeps the
         address state its provider lookup wrote. */
      const { data, error } = await db
        .from(TABLE)
        .upsert(rows, {
          onConflict: "organization_id,prospect_id,provider,match_kind,match_value",
          ignoreDuplicates: false,
        })
        .select("*");

      if (error && isConflict(error)) {
        return this.list({ organizationId, prospectId });
      }
      if (error) fail(error, "Researched people could not be saved");
      return ((data ?? []) as Row[]).map(toStoredPerson);
    },

    async recordEmail({ organizationId, prospectId, personId, answer }) {
      // The provider answer alone decides the state. Nothing else can.
      const facts = storedEmailFacts(answer);
      const { data, error } = await db
        .from(TABLE)
        .update({
          work_email: facts.workEmail,
          email_status: facts.emailStatus,
          email_fetched_at: facts.emailFetchedAt,
          email_verified_at: facts.emailVerifiedAt,
          provider: facts.provider,
        })
        .eq("organization_id", organizationId)
        .eq("prospect_id", prospectId)
        .eq("id", personId)
        .select("*")
        .maybeSingle();
      if (error) fail(error, "That lookup could not be saved");
      if (!data) {
        throw new ScoutPeopleStoreError(
          "That person is no longer on record, so the lookup was not saved.",
        );
      }
      return toStoredPerson(data as Row);
    },

    async recordHandoff({ organizationId, personId, relationshipId, contactId }) {
      const existing = await readOne(organizationId, personId);
      // Handing the same person over twice returns the first relationship.
      if (existing.handoffRelationshipId) return existing;

      const { data, error } = await db
        .from(TABLE)
        .update({
          handoff_relationship_id: relationshipId,
          selected_for_outreach: true,
          ...(contactId ? { contact_id: contactId } : {}),
        })
        .eq("organization_id", organizationId)
        .eq("id", personId)
        .is("handoff_relationship_id", null)
        .select("*")
        .maybeSingle();
      if (error) fail(error, "That handoff could not be recorded");
      // Somebody else won the race: their relationship is the one that stands.
      if (!data) return readOne(organizationId, personId);
      return toStoredPerson(data as Row);
    },
  };
}
