/**
 * People persistence on the shared `contacts` table.
 *
 * The table is owned outside this project and its real columns are:
 *   id, organization_id, client_id, full_name, title, email, phone,
 *   metadata, created_by, created_at, updated_at
 *
 * There is no `prospect_id`, `seniority`, `email_status`, `confidence` or
 * `provenance` column, so Scout keeps those inside the existing `metadata`
 * jsonb rather than inventing schema on a shared table. Everything stays
 * organization-scoped and passes through RLS as the signed-in user.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { Provenance } from "@/domain/activity";
import type { ID } from "@/domain/entities";
import {
  guessSeniority,
  type EmailStatus,
  type Person,
  type PersonConfidence,
  type Seniority,
} from "@/domain/people";

import { writeTolerant, type Row } from "./schema";

const SELECT_COLUMNS =
  "id, organization_id, client_id, full_name, title, email, phone, metadata, created_by, created_at, updated_at";

export interface ContactRow {
  id: string;
  organization_id: string;
  client_id: string | null;
  full_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  metadata: Row | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

const EMAIL_STATUSES: EmailStatus[] = [
  "unknown",
  "found",
  "verified",
  "risky",
  "invalid",
  "bounced",
];

const CONFIDENCES: PersonConfidence[] = [
  "observed",
  "inferred",
  "asserted_by_provider",
  "human_confirmed",
];

const SENIORITIES: Seniority[] = ["founder", "owner", "exec", "marketing", "operations", "other"];

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Where people-owned fields live inside `metadata`. Rows written by the
 * discovery pipeline nest them under `people`; rows written by the app keep
 * them at the root. Reads and writes must resolve the same location for a
 * record, otherwise a confirmation lands where the next read never looks.
 */
function peopleMetaOf(metadata: Row): Row {
  const nested = metadata["people"];
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Row)
    : metadata;
}

function peopleMeta(row: ContactRow): Row {
  return peopleMetaOf((row.metadata ?? {}) as Row);
}

/**
 * Merge people-owned fields into the same location `peopleMetaOf` reads,
 * leaving every unrelated key, root or nested, exactly as it was.
 */
function mergePeopleMeta(metadata: Row, patch: Row): Row {
  const nested = metadata["people"];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return { ...metadata, people: { ...(nested as Row), ...patch } };
  }
  return { ...metadata, ...patch };
}

export function toPerson(row: ContactRow): Person {
  const meta = peopleMeta(row);
  const emailStatus = text(meta["email_status"]) as EmailStatus | undefined;
  const confidence = text(meta["confidence"]) as PersonConfidence | undefined;
  const seniority = text(meta["seniority"]) as Seniority | undefined;
  const provenance = (meta["provenance"] ?? {}) as Partial<Provenance>;
  const createdAt = row.created_at;

  return {
    id: row.id,
    organizationId: row.organization_id,
    ...(text(meta["prospect_id"]) ? { prospectId: text(meta["prospect_id"])! } : {}),
    ...(row.client_id ? { clientId: row.client_id } : {}),
    fullName: row.full_name,
    ...(row.title ? { roleTitle: row.title } : {}),
    seniority:
      seniority && SENIORITIES.includes(seniority)
        ? seniority
        : guessSeniority(row.title ?? undefined),
    ...(row.email ? { email: row.email } : {}),
    emailStatus:
      emailStatus && EMAIL_STATUSES.includes(emailStatus)
        ? emailStatus
        : row.email
          ? "found"
          : "unknown",
    confidence:
      confidence && CONFIDENCES.includes(confidence) ? confidence : "asserted_by_provider",
    ...(text(meta["linkedin_url"]) ? { linkedinUrl: text(meta["linkedin_url"])! } : {}),
    ...(meta["linkedin_confirmed"] !== undefined && meta["linkedin_confirmed"] !== null
      ? {
          linkedinConfirmed:
            meta["linkedin_confirmed"] === "true" || meta["linkedin_confirmed"] === true,
        }
      : {}),
    ...(text(meta["linkedin_checked_at"])
      ? { linkedinCheckedAt: text(meta["linkedin_checked_at"])! }
      : {}),
    ...(text(meta["linkedin_provider"])
      ? { linkedinProvider: text(meta["linkedin_provider"])! }
      : {}),
    ...(text(meta["linkedin_external_id"])
      ? { linkedinExternalId: text(meta["linkedin_external_id"])! }
      : {}),
    ...(text(meta["linkedin_route_confidence"])
      ? {
          linkedinConfidence: text(meta["linkedin_route_confidence"]) as NonNullable<
            Person["linkedinConfidence"]
          >,
        }
      : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    ...(text(meta["email_checked_at"]) ? { emailCheckedAt: text(meta["email_checked_at"])! } : {}),
    ...(text(meta["email_checked_by"]) ? { emailCheckedBy: text(meta["email_checked_by"])! } : {}),
    sourceId: text(meta["source_id"]) ?? "manual",
    ...(text(meta["source_url"]) ? { sourceUrl: text(meta["source_url"])! } : {}),
    ...(text(meta["note"]) ? { note: text(meta["note"])! } : {}),
    provenance: {
      appId: String(provenance.appId ?? "scout"),
      actor: (provenance.actor as Provenance["actor"]) ?? {
        type: "user",
        id: row.created_by ?? "",
      },
      observedAt: String(provenance.observedAt ?? createdAt),
      ...(provenance.externalRef ? { externalRef: String(provenance.externalRef) } : {}),
      ...(provenance.confidence ? { confidence: provenance.confidence } : {}),
    },
    createdAt,
    updatedAt: row.updated_at ?? createdAt,
  };
}

/** Everyone on record for one Scout prospect. */
/**
 * Everyone on record for the whole organization, read once.
 *
 * Bulk callers (the Scout intake sweep) group these by prospect themselves
 * rather than issuing one lookup per company.
 */
export async function listOrganizationContacts(organizationId: ID): Promise<Person[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ContactRow[]).map(toPerson);
}

export async function listProspectContacts(organizationId: ID, prospectId: ID): Promise<Person[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ContactRow[])
    .map(toPerson)
    .filter((person) => person.prospectId === prospectId);
}

export interface ContactWrite {
  organizationId: ID;
  prospectId: ID;
  userId: ID;
  fullName: string;
  roleTitle?: string | undefined;
  seniority: Seniority;
  email?: string | undefined;
  emailStatus: EmailStatus;
  confidence: PersonConfidence;
  linkedinUrl?: string | undefined;
  phone?: string | undefined;
  sourceId: string;
  sourceUrl?: string | undefined;
  note?: string | undefined;
}

function metadataFor(input: ContactWrite, at: string): Row {
  return {
    prospect_id: input.prospectId,
    seniority: input.seniority,
    email_status: input.emailStatus,
    confidence: input.confidence,
    source_id: input.sourceId,
    ...(input.linkedinUrl ? { linkedin_url: input.linkedinUrl } : {}),
    ...(input.sourceUrl ? { source_url: input.sourceUrl } : {}),
    ...(input.note ? { note: input.note } : {}),
    provenance: {
      appId: "scout",
      actor: { type: "user", id: input.userId },
      observedAt: at,
      confidence: input.confidence === "inferred" ? "inferred" : "observed",
      ...(input.sourceUrl ? { externalRef: input.sourceUrl } : {}),
    },
  };
}

export async function insertContact(input: ContactWrite): Promise<Person> {
  const at = new Date().toISOString();
  const payload: Row = {
    organization_id: input.organizationId,
    full_name: input.fullName,
    title: input.roleTitle ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    created_by: input.userId,
    metadata: metadataFor(input, at),
  };

  const { data, error } = await writeTolerant<ContactRow>(
    payload,
    ["organization_id", "full_name", "metadata"],
    async (body) => {
      const result = await supabase.from("contacts").insert(body).select(SELECT_COLUMNS).single();
      return { data: result.data as unknown as ContactRow | null, error: result.error };
    },
  );

  if (error || !data) throw new Error(error?.message ?? "That person could not be saved.");
  return toPerson(data);
}

export interface ContactPatch {
  /** Stamped whenever `emailStatus` is set by a check or a confirmation. */
  emailCheckedBy?: string | undefined;
  fullName?: string | undefined;
  roleTitle?: string | undefined;
  seniority?: Seniority | undefined;
  email?: string | undefined;
  emailStatus?: EmailStatus | undefined;
  confidence?: PersonConfidence | undefined;
  linkedinUrl?: string | undefined;
  /**
   * LinkedIn route confirmation (integration brief §12). Setting
   * `linkedinConfirmed: true` is the human identity gate, what turns a
   * stored LinkedIn URL into a legitimate route. Stamps
   * `linkedin_checked_at` on every write, like email confirmations do.
   */
  linkedinConfirmed?: boolean | undefined;
  linkedinProvider?: string | undefined;
  linkedinExternalId?: string | undefined;
  linkedinConfidence?: Person["linkedinConfidence"] | undefined;
  phone?: string | undefined;
  /**
   * Where this person works, as Comms and Scout both read it. The shared
   * table has no company column, so it lives beside the other people-owned
   * fields in `metadata`.
   */
  companyName?: string | undefined;
  /** Links this person to a Scout prospect profile. Never unset silently. */
  prospectId?: ID | undefined;
}

/** Patch one person, merging into the existing metadata rather than replacing. */
export async function updateContact(id: ID, patch: ContactPatch, userId: ID): Promise<Person> {
  const current = await supabase.from("contacts").select(SELECT_COLUMNS).eq("id", id).single();
  if (current.error || !current.data) {
    throw new Error(current.error?.message ?? "That person is no longer on record.");
  }

  const row = current.data as unknown as ContactRow;
  const at = new Date().toISOString();

  // People-owned fields merge into the same metadata location the next read
  // resolves, nested for discovery-written records, root otherwise.
  const peoplePatch: Row = {};
  if (patch.seniority) peoplePatch["seniority"] = patch.seniority;
  if (patch.emailStatus) {
    peoplePatch["email_status"] = patch.emailStatus;
    peoplePatch["email_checked_at"] = at;
    peoplePatch["email_checked_by"] = patch.emailCheckedBy ?? "human";
  }
  if (patch.confidence) peoplePatch["confidence"] = patch.confidence;
  if (patch.linkedinUrl !== undefined) peoplePatch["linkedin_url"] = patch.linkedinUrl;
  if (patch.linkedinConfirmed !== undefined) {
    peoplePatch["linkedin_confirmed"] = patch.linkedinConfirmed;
    peoplePatch["linkedin_checked_at"] = at;
    if (patch.linkedinConfirmed) peoplePatch["linkedin_route_confidence"] = "confirmed";
  }
  if (patch.linkedinProvider !== undefined)
    peoplePatch["linkedin_provider"] = patch.linkedinProvider;
  if (patch.linkedinExternalId !== undefined)
    peoplePatch["linkedin_external_id"] = patch.linkedinExternalId;
  if (patch.linkedinConfidence !== undefined)
    peoplePatch["linkedin_route_confidence"] = patch.linkedinConfidence;
  if (patch.companyName !== undefined) peoplePatch["company_name"] = patch.companyName;
  if (patch.prospectId !== undefined) peoplePatch["prospect_id"] = patch.prospectId;

  peoplePatch["last_edited_by"] = userId;
  peoplePatch["last_edited_at"] = at;

  const meta = mergePeopleMeta((row.metadata ?? {}) as Row, peoplePatch);

  const payload: Row = {
    ...(patch.fullName ? { full_name: patch.fullName } : {}),
    ...(patch.roleTitle !== undefined ? { title: patch.roleTitle } : {}),
    ...(patch.email !== undefined ? { email: patch.email } : {}),
    ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
    metadata: meta,
  };

  const { data, error } = await writeTolerant<ContactRow>(payload, ["metadata"], async (body) => {
    const result = await supabase
      .from("contacts")
      .update(body)
      .eq("id", id)
      .select(SELECT_COLUMNS)
      .single();
    return { data: result.data as unknown as ContactRow | null, error: result.error };
  });

  if (error || !data) throw new Error(error?.message ?? "That change could not be saved.");
  return toPerson(data);
}

/**
 * Find the person already on record, or write them once.
 *
 * People live in the shared `contacts` table, so Comms never keeps a second
 * copy of a human being. A match is an email match first (the only identifier
 * that is actually unique) and an exact name match second. Provenance records
 * which app first met them and that a person, not a provider, entered it.
 */
export async function findOrCreateContact(input: {
  organizationId: ID;
  userId: ID;
  fullName: string;
  email?: string | undefined;
  roleTitle?: string | undefined;
  note?: string | undefined;
  metWhere?: string | undefined;
}): Promise<{ person: Person; created: boolean }> {
  const fullName = input.fullName.trim();
  const email = input.email?.trim().toLowerCase() || undefined;

  const { data, error } = await supabase
    .from("contacts")
    .select(SELECT_COLUMNS)
    .eq("organization_id", input.organizationId);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as ContactRow[];
  const match =
    (email ? rows.find((row) => (row.email ?? "").toLowerCase() === email) : undefined) ??
    rows.find((row) => row.full_name.trim().toLowerCase() === fullName.toLowerCase());

  if (match) {
    // An existing person is never overwritten by a capture. Only a missing
    // email is filled in, because that is new information, not a correction.
    if (email && !match.email) {
      const updated = await updateContact(
        match.id,
        { email, emailStatus: "found", confidence: "human_confirmed" },
        input.userId,
      );
      return { person: updated, created: false };
    }
    return { person: toPerson(match), created: false };
  }

  const at = new Date().toISOString();
  const metadata: Row = {
    seniority: guessSeniority(input.roleTitle),
    email_status: email ? "found" : "unknown",
    confidence: "human_confirmed",
    source_id: "comms_capture",
    ...(input.note ? { note: input.note } : {}),
    ...(input.metWhere ? { met_where: input.metWhere } : {}),
    provenance: {
      appId: "comms",
      actor: { type: "user", id: input.userId },
      observedAt: at,
      confidence: "observed",
      ...(input.metWhere ? { externalRef: input.metWhere } : {}),
    },
  };

  const { data: created, error: insertError } = await writeTolerant<ContactRow>(
    {
      organization_id: input.organizationId,
      full_name: fullName,
      title: input.roleTitle ?? null,
      email: email ?? null,
      created_by: input.userId,
      metadata,
    },
    ["organization_id", "full_name", "metadata"],
    async (body) => {
      const result = await supabase.from("contacts").insert(body).select(SELECT_COLUMNS).single();
      return { data: result.data as unknown as ContactRow | null, error: result.error };
    },
  );

  if (insertError || !created) {
    throw new Error(insertError?.message ?? "That person could not be saved.");
  }
  return { person: toPerson(created), created: true };
}
