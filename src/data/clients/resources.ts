/**
 * A client's saved links, read and written from the browser.
 *
 * The browser never writes to the table directly: it asks the Trust Tai
 * server route, which proves active membership and a working role before
 * anything is saved. A missing table is reported as exactly that, so the page
 * can say saving is not available yet instead of pretending a link was kept.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ClientResource, ClientResourceDraft } from "@/domain/client-resources";

const ENDPOINT = "/api/public/clients/resources";

/** Saving is not possible yet because the table is not in this database. */
export class ResourceStorageUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceStorageUnavailable";
  }
}

async function token(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const accessToken = await token();
  if (!accessToken) throw new Error("Sign in to read this company's links.");
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      typeof payload["error"] === "string"
        ? payload["error"]
        : "That request could not be finished.";
    if (payload["schemaUnavailable"] === true) throw new ResourceStorageUnavailable(message);
    throw new Error(message);
  }
  return payload;
}

export interface ClientResourcesRead {
  /** false means the store is not in this database yet. */
  available: boolean;
  resources: ClientResource[];
  unavailableBecause?: string;
}

export async function listClientResources(
  organizationId: string,
  clientId: string,
): Promise<ClientResourcesRead> {
  try {
    const payload = await post({ action: "list", organizationId, clientId });
    const rows = Array.isArray(payload["resources"])
      ? (payload["resources"] as ClientResource[])
      : [];
    return { available: true, resources: rows };
  } catch (error) {
    if (error instanceof ResourceStorageUnavailable) {
      return { available: false, resources: [], unavailableBecause: error.message };
    }
    throw error;
  }
}

function payloadFor(draft: ClientResourceDraft): Record<string, unknown> {
  return {
    category: draft.category,
    title: draft.title,
    url: draft.url,
    projectId: draft.projectId ?? "",
    ...(draft.description ? { description: draft.description } : {}),
    ...(draft.meetingDate ? { meetingDate: draft.meetingDate } : {}),
  };
}

export async function addClientResource(
  organizationId: string,
  clientId: string,
  draft: ClientResourceDraft,
): Promise<ClientResource> {
  const payload = await post({
    action: "add",
    organizationId,
    clientId,
    ...payloadFor(draft),
  });
  return payload["resource"] as ClientResource;
}

export async function editClientResource(
  organizationId: string,
  clientId: string,
  id: string,
  draft: ClientResourceDraft,
): Promise<ClientResource> {
  const payload = await post({
    action: "edit",
    organizationId,
    clientId,
    id,
    ...payloadFor(draft),
  });
  return payload["resource"] as ClientResource;
}

/** Forgets the reference. Nothing external is deleted. */
export async function removeClientResource(
  organizationId: string,
  clientId: string,
  id: string,
): Promise<void> {
  await post({ action: "remove", organizationId, clientId, id });
}
