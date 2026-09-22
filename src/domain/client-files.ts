/**
 * Uploaded files on a client page.
 *
 * A saved link records where something already lives. An uploaded file is the
 * opposite: the bytes themselves are kept by Trust Tai, in a private store,
 * and opened through a short lived address. Both appear in the same list on
 * the client page, and each one says plainly which it is.
 *
 * Nothing here reads, converts or interprets a file. It is kept and handed
 * back exactly as it arrived.
 */

import type { ResourceCategory } from "./client-resources";

/** The private store that holds a client's uploaded files. */
export const CLIENT_FILES_BUCKET = "client-files";

/** 25 MB. The same ceiling the store itself enforces. */
export const CLIENT_FILE_MAX_BYTES = 26_214_400;

const OBJECT_PATH = new RegExp(
  `/storage/v1/object/(?:public/|sign/)?${CLIENT_FILES_BUCKET}/(.+)$`,
  "i",
);

/**
 * The path of an uploaded file inside the private store, or null when this
 * address points somewhere else entirely.
 */
export function uploadedFilePath(url: string): string | null {
  const match = OBJECT_PATH.exec(url.split("?")[0] ?? url);
  const path = match?.[1];
  if (!path) return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** True when this saved record is a file Trust Tai holds, not a link out. */
export function isUploadedFile(url: string): boolean {
  return uploadedFilePath(url) !== null;
}

/**
 * A kind suggested from the file itself. Only a suggestion: whoever uploads
 * can say something different, and what they say wins.
 */
export function categoryForFile(fileName: string, contentType: string): ResourceCategory {
  const name = fileName.toLowerCase();
  const type = contentType.toLowerCase();
  if (type.startsWith("audio/") || type.startsWith("video/")) return "meeting_recording";
  if (type.startsWith("image/")) return "assets";
  if (type === "application/pdf" || /\.(pdf|docx?|pages)$/.test(name)) return "google_doc";
  return "other";
}

/** A file name that is safe as a storage key: no paths, no surprises. */
export function safeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned || "file").slice(0, 120);
}

/** A readable size, for a person rather than for a machine. */
export function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
