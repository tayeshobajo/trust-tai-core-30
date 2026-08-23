/**
 * The message builder.
 *
 * Turning an approved draft into an RFC 2822 message is deterministic and
 * testable, so it lives in the domain: headers, threading, recipients, and
 * attachments are pure functions. The Gmail transport only ever receives the
 * finished string, base64url-encoded.
 *
 * Three guarantees hold here:
 *  1. Our own mailbox is never a recipient — reply-all can never echo to us.
 *  2. What the person approved is exactly what is sent. Nothing is appended
 *     (no hidden signature), nothing is rewritten.
 *  3. One draft carries one deterministic Message-ID, so a retried send is
 *     recognizable instead of duplicated.
 */

import type { AttachmentMeta } from "./comms-integrations";

/** A file the person chose to send: metadata plus the bytes, base64. */
export interface OutgoingAttachment extends AttachmentMeta {
  contentBase64: string;
}

/* ------------------------------------------------------------ validation */

/** Per-file bound. Gmail's own ceiling is 25 MB for the whole message. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** All files together, leaving room under Gmail's 25 MB for the message. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Extensions Gmail refuses outright; naming one is an actionable error. */
const BLOCKED_EXTENSIONS = new Set([
  "ade", "adp", "apk", "app", "appx", "bat", "cab", "cmd", "com", "cpl", "dll",
  "dmg", "exe", "hta", "ins", "iso", "jar", "js", "jse", "lib", "lnk", "mde",
  "msc", "msi", "msp", "mst", "nsh", "pif", "ps1", "scr", "sct", "sh", "sys",
  "vb", "vbe", "vbs", "vxd", "wsc", "wsf", "wsh",
]);

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

/** `9` or `9.5`, for calm human-readable sizes. */
function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");
}

/** Bytes as a person reads them: `840 B`, `12 KB`, `2.4 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${megabytes(bytes)} MB`;
}

/** Every reason the chosen files cannot go, in plain words. Empty means fine. */
export function validateAttachments(files: { filename: string; size: number }[]): string[] {
  const errors: string[] = [];
  for (const file of files) {
    if (!file.filename.trim()) {
      errors.push("One of the files has no name. Rename it and try again.");
      continue;
    }
    const extension = extensionOf(file.filename);
    if (BLOCKED_EXTENSIONS.has(extension)) {
      errors.push(
        `“${file.filename}” cannot go through Gmail — .${extension} files are blocked.`,
      );
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      errors.push(
        `“${file.filename}” is ${megabytes(file.size)} MB; one file can be at most ${megabytes(MAX_ATTACHMENT_BYTES)} MB.`,
      );
    }
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
    errors.push(
      `Together the files are ${megabytes(total)} MB; one message can carry at most ${megabytes(MAX_TOTAL_ATTACHMENT_BYTES)} MB.`,
    );
  }
  return errors;
}

/* ------------------------------------------------------------ recipients */

const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Split a typed recipient field into clean, unique, lowercase addresses. */
export function parseRecipients(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[;,]/)) {
    const email = piece.trim().toLowerCase();
    if (!email || !EMAIL_PATTERN.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/**
 * Reply-all, computed safely: the person who wrote to us leads To; everyone
 * else on the message rides in Cc — except our own mailbox, which is never a
 * recipient no matter what the headers said.
 */
export function replyRecipients(input: {
  replyTo: string;
  toEmails: string[];
  ccEmails: string[];
  mailbox: string;
}): { to: string[]; cc: string[] } {
  const self = input.mailbox.trim().toLowerCase();
  const replyTo = input.replyTo.trim().toLowerCase();
  const to = replyTo && replyTo !== self ? [replyTo] : [];
  const seen = new Set(to);
  const cc: string[] = [];
  for (const email of [...input.toEmails, ...input.ccEmails]) {
    const clean = email.trim().toLowerCase();
    if (!clean || clean === self || seen.has(clean)) continue;
    seen.add(clean);
    cc.push(clean);
  }
  return { to, cc };
}

/** `Re:` exactly once, whatever the incoming subject already carried. */
export function replySubject(subject: string | undefined): string {
  let base = (subject ?? "").trim();
  for (let guard = 0; guard < 8; guard += 1) {
    const stripped = base.replace(/^\s*(re|fwd?)\s*:\s*/i, "").trim();
    if (stripped === base) break;
    base = stripped;
  }
  return base ? `Re: ${base}` : "";
}

/* -------------------------------------------------------------- encoding */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

function textToBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

/** MIME body lines fold at 76 characters. */
function fold76(value: string): string {
  const lines: string[] = [];
  for (let index = 0; index < value.length; index += 76) {
    lines.push(value.slice(index, index + 76));
  }
  return lines.join("\r\n");
}

const ASCII_PRINTABLE = /^[\x20-\x7e]*$/;

/** Headers carry ASCII; anything richer rides as an RFC 2047 encoded word. */
export function encodeHeaderValue(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  return ASCII_PRINTABLE.test(clean) ? clean : `=?UTF-8?B?${textToBase64(clean)}?=`;
}

/** The deterministic identity one draft carries into the mailbox. */
export function deterministicMessageId(draftId: string): string {
  return `<comms-${draftId}@trusttai.com>`;
}

/** RFC 5987 filename parameters, with an ASCII fallback for older readers. */
function filenameParameters(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "attachment";
  if (fallback === filename) return `filename="${fallback}"`;
  return `filename="${fallback}";\r\n\tfilename*=UTF-8''${encodeURIComponent(filename)}`;
}

/* -------------------------------------------------------------- the build */

export interface MimeMessageInput {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: OutgoingAttachment[];
}

/**
 * The finished message. A reply carries `In-Reply-To` / `References` so Gmail
 * keeps it inside its conversation; an attachment turns the message into a
 * `multipart/mixed` tree whose first part is always the readable text.
 */
export function buildMimeMessage(input: MimeMessageInput): string {
  const headers: string[] = [
    `From: ${input.from.trim().toLowerCase()}`,
    `To: input.to.join(", ")`,
  ];
  // (header list built below — kept explicit so a review reads top to bottom)
  headers.length = 0;
  headers.push(`From: ${input.from.trim().toLowerCase()}`);
  headers.push(`To: ${input.to.map((email) => email.trim().toLowerCase()).join(", ")}`);
  if (input.cc?.length) {
    headers.push(`Cc: ${input.cc.map((email) => email.trim().toLowerCase()).join(", ")}`);
  }
  if (input.bcc?.length) {
    headers.push(`Bcc: ${input.bcc.map((email) => email.trim().toLowerCase()).join(", ")}`);
  }
  headers.push(`Subject: ${encodeHeaderValue(input.subject)}`);
  if (input.messageId) headers.push(`Message-ID: ${input.messageId}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references?.length) headers.push(`References: ${input.references.join(" ")}`);
  headers.push("MIME-Version: 1.0");

  const attachments = input.attachments ?? [];
  const textHeaders = [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const textBody = fold76(textToBase64(input.bodyText));

  if (attachments.length === 0) {
    return [...headers, ...textHeaders, "", textBody].join("\r\n");
  }

  // The boundary is derived from the message identity, not a random source:
  // the same draft always builds the same message.
  const boundary = `----comms-${(input.messageId ?? "message").replace(/[^a-z0-9]/gi, "")}`;

  const parts: string[] = [[...textHeaders, "", textBody].join("\r\n")];
  for (const attachment of attachments) {
    parts.push(
      [
        `Content-Type: ${attachment.mimeType || "application/octet-stream"}; ${filenameParameters(attachment.filename)}`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; ${filenameParameters(attachment.filename)}`,
        "",
        fold76(attachment.contentBase64.replace(/\s+/g, "")),
      ].join("\r\n"),
    );
  }

  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...parts.flatMap((part) => [`--${boundary}`, part]),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** The wire format Gmail's send endpoint expects. */
export function encodeRawEmail(rfc2822: string): string {
  return textToBase64(rfc2822).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The always-available fallback: the same words, opened in Gmail's own
 * compose window, when Comms may not send itself.
 */
export function gmailComposeUrl(input: {
  to?: string[];
  subject?: string;
  body?: string;
}): string {
  const params = new URLSearchParams({ view: "cm", fs: "1" });
  if (input.to?.length) params.set("to", input.to.join(","));
  if (input.subject) params.set("su", input.subject);
  if (input.body) params.set("body", input.body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}
