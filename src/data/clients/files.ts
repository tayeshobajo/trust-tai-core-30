/**
 * Uploading and opening a client's own files, from the browser.
 *
 * The browser never touches the private store directly. It hands the bytes to
 * the Trust Tai server route, which proves active membership and a working
 * role first, and it asks that same route for a short lived address whenever
 * a saved file needs to be opened.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ClientResource, ResourceCategory } from "@/domain/client-resources";
import { ResourceStorageUnavailable } from "@/data/clients/resources";

const ENDPOINT = "/api/public/clients/files";

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Sign in to work with this company's files.");
  return accessToken;
}

function problem(payload: Record<string, unknown>, fallback: string): Error {
  const message = typeof payload["error"] === "string" ? payload["error"] : fallback;
  if (payload["storeUnavailable"] === true || payload["schemaUnavailable"] === true) {
    return new ResourceStorageUnavailable(message);
  }
  return new Error(message);
}

export interface FileUpload {
  file: File;
  title: string;
  category: ResourceCategory;
  projectId: string | null;
  description?: string | undefined;
  meetingDate?: string | undefined;
}

export async function uploadClientFile(
  organizationId: string,
  clientId: string,
  upload: FileUpload,
): Promise<ClientResource> {
  const form = new FormData();
  form.set("organizationId", organizationId);
  form.set("clientId", clientId);
  form.set("file", upload.file);
  form.set("title", upload.title);
  form.set("category", upload.category);
  if (upload.projectId) form.set("projectId", upload.projectId);
  if (upload.description) form.set("description", upload.description);
  if (upload.meetingDate) form.set("meetingDate", upload.meetingDate);

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}` },
    body: form,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw problem(payload, "That file could not be saved.");
  return payload["resource"] as ClientResource;
}

/** A link that opens one saved file. It stops working after ten minutes. */
export async function openClientFile(
  organizationId: string,
  clientId: string,
  url: string,
): Promise<string> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ action: "open", organizationId, clientId, url }),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw problem(payload, "That file could not be opened just now.");
  return String(payload["url"] ?? "");
}
