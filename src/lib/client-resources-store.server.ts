/**
 * Where a client's saved links are actually kept (server only).
 *
 * One table, `client_resources`. Everything here runs with the server's own
 * credential and every statement carries the workspace and the client as
 * explicit filters. This module never decides who the caller is: the route
 * proves an active membership, and a writing role for anything that writes,
 * and refuses before this file is reached.
 *
 * The table may not exist yet. That is reported honestly as "cannot be saved
 * yet", never as a silent success and never as an empty, healthy list.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  checkResourceUrl,
  isResourceCategory,
  type ClientResource,
  type ResourceCategory,
} from "@/domain/client-resources";
import { trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";

const TABLE = "client_resources";

type Row = Record<string, unknown>;

/** The table is not in this database yet. A gap, stated plainly. */
export class ClientResourcesSchemaUnavailable extends Error {
  constructor(
    message = "Links cannot be saved yet: the client resources table is not in this database.",
  ) {
    super(message);
    this.name = "ClientResourcesSchemaUnavailable";
  }
}

/** Something went wrong while writing. Nothing was saved. */
export class ClientResourcesStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientResourcesStoreError";
  }
}

export function clientResourcesWriter(): SupabaseClient {
  const key =
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) {
    throw new ClientResourcesStoreError(
      "Saving links is not configured on this server, so nothing was saved.",
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
  if (code === "42703" || code === "42P01" || code === "PGRST205") return true;
  return /does not exist|schema cache/i.test(error.message ?? "");
}

function isConflict(error: { code?: string } | null): boolean {
  return (error?.code ?? "") === "23505";
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function maybe(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function toResource(row: Row): ClientResource {
  const category = row["category"];
  return {
    id: text(row["id"]),
    organizationId: text(row["organization_id"]),
    clientId: text(row["client_id"]),
    projectId: maybe(row["project_id"]),
    category: isResourceCategory(category) ? category : "other",
    title: text(row["title"]),
    url: text(row["url"]),
    description: maybe(row["description"]),
    meetingDate: maybe(row["meeting_date"]),
    createdAt: text(row["created_at"]),
    createdBy: maybe(row["created_by"]),
  };
}

export interface ResourceScope {
  organizationId: string;
  clientId: string;
  userId: string;
}

export interface ResourceWrite {
  category: ResourceCategory;
  title: string;
  url: string;
  description?: string | undefined;
  meetingDate?: string | undefined;
  projectId: string | null;
}

/**
 * The address is checked again here, on the server. A browser check is a
 * courtesy; this one is the boundary.
 */
function payloadFor(scope: ResourceScope, input: ResourceWrite) {
  const checked = checkResourceUrl(input.url);
  if (!checked.ok) throw new ClientResourcesStoreError(checked.problem);
  const title = input.title.trim();
  if (!title) throw new ClientResourcesStoreError("A title is needed so this can be found again.");
  if (!isResourceCategory(input.category)) {
    throw new ClientResourcesStoreError("That is not a kind of link this page can save.");
  }
  return {
    category: input.category,
    title: title.slice(0, 200),
    url: checked.url,
    description: input.description?.trim() ? input.description.trim().slice(0, 2000) : null,
    meeting_date: input.meetingDate?.trim() ? input.meetingDate.trim() : null,
    project_id: input.projectId,
    organization_id: scope.organizationId,
    client_id: scope.clientId,
  };
}

/** A same-scope collision is the person's own duplicate, said in their words. */
const DUPLICATE =
  "That exact address is already saved in this scope. Save it on a different project if that is what you meant.";

/**
 * A rejection from the same-workspace trigger. Reported as a refusal, because
 * that is what it is: the client or project named is not this client's own.
 */
function ownershipRefusal(error: { message?: string } | null): boolean {
  const message = error?.message ?? "";
  return /is not in workspace|does not belong to client|are frozen/i.test(message);
}

export const clientResourcesStore = {
  /** Every link saved for this company, newest first. */
  async list(scope: Pick<ResourceScope, "organizationId" | "clientId">): Promise<ClientResource[]> {
    const { data, error } = await clientResourcesWriter()
      .from(TABLE)
      .select("*")
      .eq("organization_id", scope.organizationId)
      .eq("client_id", scope.clientId)
      .order("created_at", { ascending: false });
    if (error) {
      if (missingSchema(error)) throw new ClientResourcesSchemaUnavailable();
      throw new ClientResourcesStoreError("The saved links could not be read.");
    }
    return (data ?? []).map((row) => toResource(row as Row));
  },

  async add(scope: ResourceScope, input: ResourceWrite): Promise<ClientResource> {
    const payload = { ...payloadFor(scope, input), created_by: scope.userId };
    const { data, error } = await clientResourcesWriter()
      .from(TABLE)
      .insert(payload)
      .select("*")
      .single();
    if (error || !data) {
      if (missingSchema(error)) throw new ClientResourcesSchemaUnavailable();
      if (isConflict(error)) throw new ClientResourcesStoreError(DUPLICATE);
      if (ownershipRefusal(error)) {
        throw new ClientResourcesStoreError(
          "That project is not this company's own, so the link was not saved.",
        );
      }
      throw new ClientResourcesStoreError("That link could not be saved.");
    }
    return toResource(data as Row);
  },

  /** Retitle, recategorise, re-point, or move between this client's projects. */
  async edit(scope: ResourceScope, id: string, input: ResourceWrite): Promise<ClientResource> {
    const payload = payloadFor(scope, input);
    const { data, error } = await clientResourcesWriter()
      .from(TABLE)
      .update(payload)
      .eq("id", id)
      .eq("organization_id", scope.organizationId)
      .eq("client_id", scope.clientId)
      .select("*")
      .single();
    if (error || !data) {
      if (missingSchema(error)) throw new ClientResourcesSchemaUnavailable();
      if (isConflict(error)) throw new ClientResourcesStoreError(DUPLICATE);
      if (ownershipRefusal(error)) {
        throw new ClientResourcesStoreError(
          "That project is not this company's own, so the change was not saved.",
        );
      }
      throw new ClientResourcesStoreError("That change could not be saved.");
    }
    return toResource(data as Row);
  },

  /**
   * Removes the reference only. The document, recording or folder it points
   * at is untouched, and no project file is affected.
   */
  async remove(scope: Pick<ResourceScope, "organizationId" | "clientId">, id: string): Promise<void> {
    const { error } = await clientResourcesWriter()
      .from(TABLE)
      .delete()
      .eq("id", id)
      .eq("organization_id", scope.organizationId)
      .eq("client_id", scope.clientId);
    if (error) {
      if (missingSchema(error)) throw new ClientResourcesSchemaUnavailable();
      throw new ClientResourcesStoreError("That link could not be removed.");
    }
  },
};
