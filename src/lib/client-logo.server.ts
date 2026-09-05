/**
 * The client image boundary.
 *
 * A company's logo is a real file a person uploaded, not a guess. The file
 * lands in the public `client-logos` bucket under the organization that owns
 * the client, and the durable address is written onto the canonical client
 * row. The upload itself is privileged work, so it happens with the service
 * key, but only after the caller's own token proved active membership of the
 * organization AND the client row is readable under that same session. A
 * token that cannot see the client can never write its image.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { trustTaiSupabaseUrl } from "./trust-tai-backend.server";

/** Public, so the address in a client record still resolves in a year. */
export const CLIENT_LOGO_BUCKET = "client-logos";

/** What a browser may send. Anything else is refused rather than stored. */
export const CLIENT_LOGO_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/svg+xml",
] as const;

export const CLIENT_LOGO_MAX_BYTES = 2 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

export interface UploadResult {
  ok: boolean;
  url?: string;
  because?: string;
}

function serviceClient(): SupabaseClient | null {
  const key = process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"];
  if (!key) return null;
  return createClient(trustTaiSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Store one image and record its address on the client row.
 *
 * `caller` is the person's own client, already proven to be an active member
 * of `organizationId`. The client row is re-read under it, so row level
 * security, not this function, decides whether the write may happen.
 */
export async function storeClientLogo(input: {
  caller: SupabaseClient;
  organizationId: string;
  clientId: string;
  userId: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<UploadResult> {
  const extension = EXTENSIONS[input.contentType];
  if (!extension) return { ok: false, because: "That file type cannot be stored as a logo." };
  if (input.bytes.byteLength === 0) return { ok: false, because: "That file was empty." };
  if (input.bytes.byteLength > CLIENT_LOGO_MAX_BYTES) {
    return { ok: false, because: "That image is larger than 2 MB." };
  }

  const admin = serviceClient();
  if (!admin) {
    return { ok: false, because: "No durable image store is configured, so nothing was saved." };
  }

  const current = await input.caller
    .from("clients")
    .select("id, organization_id, metadata")
    .eq("id", input.clientId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (current.error) return { ok: false, because: "That client could not be read." };
  if (!current.data) return { ok: false, because: "That client is not in your organization." };

  const path = `${input.organizationId}/${input.clientId}-${Date.now()}.${extension}`;
  const upload = await admin.storage
    .from(CLIENT_LOGO_BUCKET)
    .upload(path, input.bytes, { contentType: input.contentType, upsert: false });
  if (upload.error) return { ok: false, because: "That image could not be stored." };

  const { data: publicUrl } = admin.storage.from(CLIENT_LOGO_BUCKET).getPublicUrl(path);
  const url = publicUrl?.publicUrl ?? "";
  if (!url) {
    await admin.storage.from(CLIENT_LOGO_BUCKET).remove([path]);
    return { ok: false, because: "The stored image had no durable address." };
  }

  const row = current.data as Record<string, unknown>;
  const metadata =
    row["metadata"] && typeof row["metadata"] === "object" && !Array.isArray(row["metadata"])
      ? (row["metadata"] as Record<string, unknown>)
      : {};

  // The write is made under the person's own session, so it is refused unless
  // policy already lets them change this client.
  const saved = await input.caller
    .from("clients")
    .update({
      metadata: {
        ...metadata,
        logo_url: url,
        logo_uploaded_by: input.userId,
        logo_uploaded_at: new Date().toISOString(),
      },
    })
    .eq("id", input.clientId)
    .eq("organization_id", input.organizationId)
    .select("id")
    .maybeSingle();

  if (saved.error || !saved.data) {
    // Never leave an orphan image behind when the record could not be written.
    await admin.storage.from(CLIENT_LOGO_BUCKET).remove([path]);
    return { ok: false, because: "The image was not recorded on this client, so it was removed." };
  }

  return { ok: true, url };
}
