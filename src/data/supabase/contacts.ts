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

const SENIORITIES: Seniority[] = [
  "founder",
  "owner",
  "exec",
  "marketing",
  "operations",
  "other",
];

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function peopleMeta(row: ContactRow): Row {
  const metadata = (row.metadata ?? {}) as Row;
  const nested = metadata["people"];
  return nested && typeof nested === "object" ? (nested as Row) : metadata;
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
    ...(row.phone ? { phone: row.phone } : {}),
    sourceId: text(meta["source_id"]) ?? "manual",
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
export async function listProspectContacts(
  organizationId: ID,
  prospectId: ID,
): Promise<Person[]> {
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
      const result = await supabase
        .from("contacts")
        .insert(body)
        .select(SELECT_COLUMNS)
        .single();
      return { data: result.data as unknown as ContactRow | null, error: result.error };
    },
  );

  if (error || !data) throw new Error(error?.message ?? "That person could not be saved.");
  return toPerson(data);
}

export interface ContactPatch {
  fullName?: string | undefined;
  roleTitle?: string | undefined;
  seniority?: Seniority | undefined;
  email?: string | undefined;
  emailStatus?: EmailStatus | undefined;
  confidence?: PersonConfidence | undefined;
  linkedinUrl?: string | undefined;
  phone?: string | undefined;
}

/** Patch one person, merging into the existing metadata rather than replacing. */
export async function updateContact(
  id: ID,
  patch: ContactPatch,
  userId: ID,
): Promise<Person> {
  const current = await supabase
    .from("contacts")
    .select(SELECT_COLUMNS)
    .eq("id", id)
    .single();
  if (current.error || !current.data) {
    throw new Error(current.error?.message ?? "That person is no longer on record.");
  }

  const row = current.data as unknown as ContactRow;
  const meta = { ...((row.metadata ?? {}) as Row) };
  const at = new Date().toISOString();

  if (patch.seniority) meta["seniority"] = patch.seniority;
  if (patch.emailStatus) meta["email_status"] = patch.emailStatus;
  if (patch.confidence) meta["confidence"] = patch.confidence;
  if (patch.linkedinUrl !== undefined) meta["linkedin_url"] = patch.linkedinUrl;
  meta["last_edited_by"] = userId;
  meta["last_edited_at"] = at;

  const payload: Row = {
    ...(patch.fullName ? { full_name: patch.fullName } : {}),
    ...(patch.roleTitle !== undefined ? { title: patch.roleTitle } : {}),
    ...(patch.email !== undefined ? { email: patch.email } : {}),
    ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
    metadata: meta,
  };

  const { data, error } = await writeTolerant<ContactRow>(
    payload,
    ["metadata"],
    async (body) => {
      const result = await supabase
        .from("contacts")
        .update(body)
        .eq("id", id)
        .select(SELECT_COLUMNS)
        .single();
      return { data: result.data as unknown as ContactRow | null, error: result.error };
    },
  );

  if (error || !data) throw new Error(error?.message ?? "That change could not be saved.");
  return toPerson(data);
}
