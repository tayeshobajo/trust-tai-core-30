/**
 * Files a person attaches to an outgoing draft.
 *
 * Bytes never live in the database. An upload goes to one bounded, private
 * storage bucket under `{organization}/{draft}/…`; the draft's rationale
 * carries only the metadata and the storage path. The send path reads the
 * bytes at send time, and a successful send deletes them — Gmail becomes the
 * source of truth. A failed send keeps them, so a retry never asks for the
 * files again. Unsent uploads on discarded drafts are swept by lifecycle
 * (see docs/comms-send-schema.sql).
 *
 * Pure and I/O-free: the browser composer and the server send module share
 * these rules, and tests pin them.
 */

import type { AttachmentMeta } from "./comms-integrations";

/** The one bucket outgoing draft files may live in. Private, org-pathed. */
export const DRAFT_ATTACHMENT_BUCKET = "comms-drafts";

/** A calm bound on how many files one message carries. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/** What the draft remembers about one uploaded file: metadata plus the path. */
export interface OutgoingAttachmentRef extends AttachmentMeta {
  /** Storage path inside DRAFT_ATTACHMENT_BUCKET. */
  path: string;
}

/** Where one file lives. The draft id scopes it; the name is made safe. */
export function attachmentStoragePath(
  organizationId: string,
  draftId: string,
  filename: string,
): string {
  const clean = filename
    .trim()
    .replace(/[^\w. -]+/g, "_")
    .replace(/\s+/g, " ")
    .slice(-120);
  return `${organizationId}/${draftId}/${Date.now()}-${clean || "file"}`;
}

/* ---------------------------------------------------------- rationale IO */

function refFromJson(raw: unknown): OutgoingAttachmentRef | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const filename = typeof value["filename"] === "string" ? value["filename"] : "";
  const path = typeof value["path"] === "string" ? value["path"] : "";
  if (!filename || !path) return null;
  return {
    filename,
    path,
    mimeType:
      typeof value["mime_type"] === "string" ? value["mime_type"] : "application/octet-stream",
    size: typeof value["size"] === "number" ? value["size"] : 0,
  };
}

/** The files currently staged on a draft. Empty when there are none. */
export function readOutgoingAttachments(
  rationale: Record<string, unknown> | null | undefined,
): OutgoingAttachmentRef[] {
  const raw = rationale?.["outgoing_attachments"];
  if (!Array.isArray(raw)) return [];
  return raw.map(refFromJson).filter((entry): entry is OutgoingAttachmentRef => entry !== null);
}

/** Merge the staged-file list into a draft's rationale. Nothing else moves. */
export function writeOutgoingAttachments(
  rationale: Record<string, unknown> | null | undefined,
  attachments: OutgoingAttachmentRef[],
): Record<string, unknown> {
  return {
    ...(rationale ?? {}),
    outgoing_attachments: attachments.map((attachment) => ({
      filename: attachment.filename,
      mime_type: attachment.mimeType,
      size: attachment.size,
      path: attachment.path,
    })),
  };
}

/* ----------------------------------------------------- extra recipients */

/**
 * CC/BCC the person added on top of the planned recipients. Kept on the
 * draft so what was approved is on record, and merged into the send plan at
 * send time. Never includes the person's own mailbox — the server drops it.
 */
export function readOutgoingExtras(
  rationale: Record<string, unknown> | null | undefined,
): { cc: string[]; bcc: string[] } {
  const raw = rationale?.["outgoing_extras"];
  if (!raw || typeof raw !== "object") return { cc: [], bcc: [] };
  const value = raw as Record<string, unknown>;
  const list = (key: string): string[] =>
    Array.isArray(value[key]) ? (value[key] as unknown[]).map(String).filter(Boolean) : [];
  return { cc: list("cc"), bcc: list("bcc") };
}

/** Merge CC/BCC into a draft's rationale. Nothing else moves. */
export function writeOutgoingExtras(
  rationale: Record<string, unknown> | null | undefined,
  extras: { cc: string[]; bcc: string[] },
): Record<string, unknown> {
  return {
    ...(rationale ?? {}),
    outgoing_extras: { cc: extras.cc, bcc: extras.bcc },
  };
}
