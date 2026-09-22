/**
 * Where a client's uploaded files are actually kept (server only).
 *
 * The bytes live in the private `client-files` store, under the workspace and
 * the company that own them. Nothing is public: every read is a short lived
 * address minted for one person who has already proved active membership.
 *
 * This module never decides who the caller is. The route proves that first.
 */

import {
  CLIENT_FILES_BUCKET,
  CLIENT_FILE_MAX_BYTES,
  safeFileName,
  uploadedFilePath,
} from "@/domain/client-files";
import { clientResourcesWriter } from "@/lib/client-resources-store.server";
import { trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";

export interface StoredFile {
  path: string;
  url: string;
}

/** The store is not provisioned in this backend yet. Said plainly. */
export class ClientFilesUnavailable extends Error {
  constructor(message = "Files cannot be uploaded yet: this workspace has no file store.") {
    super(message);
    this.name = "ClientFilesUnavailable";
  }
}

function missingBucket(message: string): boolean {
  return /bucket not found|does not exist/i.test(message);
}

/** The durable address of an object. It only opens with a signed link. */
function addressOf(path: string): string {
  const base = trustTaiSupabaseUrl().replace(/\/+$/, "");
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/${CLIENT_FILES_BUCKET}/${encoded}`;
}

export async function storeClientFile(input: {
  organizationId: string;
  clientId: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<StoredFile> {
  if (input.bytes.byteLength === 0) throw new Error("That file is empty, so nothing was saved.");
  if (input.bytes.byteLength > CLIENT_FILE_MAX_BYTES) {
    throw new Error("That file is larger than 25 MB, so nothing was saved.");
  }
  const path = `${input.organizationId}/${input.clientId}/${Date.now()}-${safeFileName(input.fileName)}`;
  const upload = await clientResourcesWriter()
    .storage.from(CLIENT_FILES_BUCKET)
    .upload(path, input.bytes, {
      contentType: input.contentType || "application/octet-stream",
      upsert: false,
    });
  if (upload.error) {
    if (missingBucket(upload.error.message)) throw new ClientFilesUnavailable();
    throw new Error("That file could not be stored, so nothing was saved.");
  }
  return { path, url: addressOf(path) };
}

/** A short lived address for one uploaded file. Ten minutes. */
export async function signClientFile(path: string): Promise<string | null> {
  const { data, error } = await clientResourcesWriter()
    .storage.from(CLIENT_FILES_BUCKET)
    .createSignedUrl(path, 600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Removes the bytes. Used when a record could not be written, or was removed. */
export async function deleteClientFile(url: string): Promise<void> {
  const path = uploadedFilePath(url);
  if (!path) return;
  await clientResourcesWriter().storage.from(CLIENT_FILES_BUCKET).remove([path]);
}

/** The file belongs to this company, proved from its own path. */
export function fileBelongsTo(url: string, organizationId: string, clientId: string): boolean {
  const path = uploadedFilePath(url);
  if (!path) return false;
  return path.startsWith(`${organizationId}/${clientId}/`);
}
