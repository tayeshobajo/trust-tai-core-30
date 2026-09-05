/**
 * Uploading a company image from the workspace.
 *
 * The file goes to the signed endpoint with the person's own session, so the
 * server can prove membership before anything is stored. A refusal comes back
 * as a plain sentence and nothing on the client record changes.
 */

import { supabase } from "@/integrations/trust-tai/supabase";

const ENDPOINT = "/api/public/clients/logo";

/** What a person may choose in the file dialog. */
export const CLIENT_LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/avif,image/svg+xml";

export async function uploadClientLogo(input: {
  organizationId: string;
  clientId: string;
  file: File;
}): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session could not be read, so nothing was uploaded.");

  const body = new FormData();
  body.set("organizationId", input.organizationId);
  body.set("clientId", input.clientId);
  body.set("file", input.file);

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });

  const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!response.ok || !payload.url) {
    throw new Error(payload.error ?? "That image could not be saved.");
  }
  return payload.url;
}
