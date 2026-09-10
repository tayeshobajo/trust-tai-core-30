/**
 * Email body fidelity: MIME walking, sanitization, and render preparation.
 *
 * Comms shows the actual meaningful email a person sent or received, never
 * Gmail's preview snippet. This module is the whole story of how a Gmail
 * MIME payload becomes storable, renderable content:
 *
 *  - `extractEmailBody` walks a Gmail `format=full` payload: it finds the
 *    plain-text and HTML bodies through multipart/alternative and
 *    multipart/related, separates inline MIME images (Content-ID /
 *    inline disposition) from ordinary file attachments, and sanitizes the
 *    HTML before anything stores it.
 *  - `sanitizeEmailHtml` is the security boundary. It is an allowlist
 *    sanitizer: known-safe tags and attributes survive; scripts, forms,
 *    iframes, event handlers, styles, unsafe URLs, and remote resources do
 *    not. Remote images are dropped and counted, they never load silently.
 *  - `parseEmailHtml` turns the sanitized HTML into a small node tree the
 *    timeline renders with ordinary components, no dangerouslySetInnerHTML.
 *  - `splitQuotedContent` / `splitQuotedNodes` separate the current reply
 *    from quoted history. Fidelity beats cleverness: detection is
 *    conservative, and nothing is ever deleted, quoted content lives behind
 *    an explicit Show quoted text affordance.
 *
 * Everything here is pure: no network, no storage, no credentials. The
 * server composes extraction with fetching; the client composes parsing
 * with rendering.
 */

import type { AttachmentMeta } from "@/domain/comms-integrations";

/* ------------------------------------------------------------ MIME types */

export interface MimeHeader {
  name?: string;
  value?: string;
}

/** The subset of Gmail's MessagePart shape extraction reads. */
export interface MimePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: MimeHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: MimePart[];
}

/* --------------------------------------------------- base64url decoding */

/**
 * Decode Gmail's base64url body data to text. Tolerates missing padding,
 * as Gmail omits it. Returns "" for empty input.
 */
export function decodeBase64UrlToText(data: string): string {
  if (!data) return "";
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/* ------------------------------------------------------------ extraction */

export interface ExtractedEmailBody {
  /** The full readable text, plain part preferred, HTML flattened otherwise. */
  bodyText?: string;
  /** Sanitized HTML, present only when the mail carried an HTML part. */
  bodyHtml?: string;
  /** Remote images the sanitizer refused. Surfaced, never silently dropped. */
  blockedRemoteImages: number;
  /** Ordinary files: chips and downloads. Never inline MIME images. */
  attachments: AttachmentMeta[];
  /** Inline MIME images, keyed by Content-ID for `cid:` resolution. */
  inline: AttachmentMeta[];
}

function headerValue(part: MimePart, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const header of part.headers ?? []) {
    if ((header.name ?? "").toLowerCase() === wanted && typeof header.value === "string") {
      return header.value;
    }
  }
  return undefined;
}

/** `Content-ID: <abc@x>` → `abc@x`; anything else → undefined. */
function contentIdOf(part: MimePart): string | undefined {
  const raw = headerValue(part, "Content-ID");
  if (!raw) return undefined;
  const match = raw.trim().match(/^<([^>]+)>$/);
  const id = (match ? match[1]! : raw.trim()).trim();
  return id.length > 0 ? id : undefined;
}

function dispositionOf(part: MimePart): string | undefined {
  const raw = headerValue(part, "Content-Disposition");
  if (!raw) return undefined;
  return raw.split(";")[0]!.trim().toLowerCase() || undefined;
}

/** A filename for an inline image that did not bring one. */
function inlineFilename(part: MimePart, contentId: string | undefined): string {
  const existing = (part.filename ?? "").trim();
  if (existing) return existing;
  const extension = (part.mimeType ?? "").toLowerCase().split("/")[1] ?? "img";
  const base = (contentId ?? "image").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 40);
  return `${base}.${extension === "jpeg" ? "jpg" : extension}`;
}

interface WalkState {
  text?: string;
  html?: string;
  inline: AttachmentMeta[];
  attachments: AttachmentMeta[];
}

function walkPart(part: MimePart, state: WalkState): void {
  const mime = (part.mimeType ?? "").toLowerCase();
  if (mime.startsWith("multipart/")) {
    for (const child of part.parts ?? []) walkPart(child, state);
    return;
  }

  const filename = (part.filename ?? "").trim();
  const contentId = contentIdOf(part);
  const disposition = dispositionOf(part);
  const isInline = disposition === "inline" || contentId !== undefined;
  const data = part.body?.data;
  const attachmentId = part.body?.attachmentId;
  const size = part.body?.size ?? 0;

  // Body parts: the first text/plain and first text/html win. A part is a
  // body candidate only when it is not a named or inline-attached thing.
  if (mime === "text/plain" && !filename && !isInline && state.text === undefined) {
    if (data) state.text = decodeBase64UrlToText(data);
    return;
  }
  if (mime === "text/html" && !filename && !isInline && state.html === undefined) {
    if (data) state.html = decodeBase64UrlToText(data);
    return;
  }

  // Inline MIME images: Content-ID or an explicit inline disposition on an
  // image part. These render in place; they are never attachment chips.
  if (isInline && mime.startsWith("image/")) {
    state.inline.push({
      filename: inlineFilename(part, contentId),
      mimeType: mime || "image/*",
      size,
      ...(attachmentId ? { attachmentId } : {}),
      ...(contentId ? { contentId } : {}),
      inline: true,
    });
    return;
  }

  // Ordinary attachments: named or carrier parts. Multipart containers
  // already returned above, so nothing structural lands here.
  if (filename || attachmentId) {
    state.attachments.push({
      filename: filename || "attachment",
      mimeType: mime || "application/octet-stream",
      size,
      ...(attachmentId ? { attachmentId } : {}),
    });
    return;
  }

  // Anything else, an unnamed non-body leaf such as a calendar part, is
  // not content we render and not a file the person meant to send.
}

/**
 * Extract the meaningful content of one Gmail `format=full` message:
 * bodies, inline images, and ordinary attachments. The returned HTML is
 * already sanitized; remote images are counted, never loaded. Pure;
 * safe to call on metadata-format payloads too, they simply carry no
 * body data, and every body field comes back absent.
 */
export function extractEmailBody(payload: MimePart | undefined): ExtractedEmailBody {
  const state: WalkState = { inline: [], attachments: [] };
  if (payload) walkPart(payload, state);

  const rawHtml = state.html;
  let bodyHtml: string | undefined;
  let blockedRemoteImages = 0;
  if (rawHtml) {
    const sanitized = sanitizeEmailHtml(rawHtml);
    bodyHtml = sanitized.html;
    blockedRemoteImages = sanitized.blockedRemoteImages;
  }

  const text = state.text?.replace(/\r\n/g, "\n").trim();
  const bodyText =
    text && text.length > 0 ? text : bodyHtml ? htmlToPlainText(bodyHtml) : undefined;

  return {
    ...(bodyText ? { bodyText } : {}),
    ...(bodyHtml && bodyHtml.trim().length > 0 ? { bodyHtml } : {}),
    blockedRemoteImages,
    attachments: state.attachments,
    inline: state.inline,
  };
}

/* ----------------------------------------------------------- sanitizer */

const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "p",
  "br",
  "div",
  "span",
  "ul",
  "ol",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "img",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "pre",
  "code",
]);
const VOID_TAGS = new Set(["br", "hr", "img"]);
/** Dropped together with everything inside them. */
const DROP_WITH_CONTENTS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "svg",
  "math",
  "template",
  "title",
  "textarea",
  "select",
  "option",
  "button",
  "input",
  "link",
  "meta",
  "base",
  "video",
  "audio",
  "source",
  "track",
  "canvas",
  "frame",
  "frameset",
  "applet",
]);

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

/** Links may point at the web, mail, or an in-document anchor, nothing else. */
function safeHref(value: string): string | undefined {
  const trimmed = value.trim();
  if (/^(https?:\/\/|mailto:|#)/i.test(trimmed)) return trimmed;
  return undefined;
}

/** Images render only from the MIME itself, via Content-ID. */
function safeImageSrc(value: string): string | undefined {
  const trimmed = value.trim();
  if (/^cid:/i.test(trimmed)) return trimmed.slice(4);
  return undefined;
}

function safeClassName(value: string): string | undefined {
  const trimmed = value.trim();
  return /^[a-zA-Z0-9_ -]{1,100}$/.test(trimmed) ? trimmed : undefined;
}

function safeDimension(value: string): string | undefined {
  const trimmed = value.trim();
  return /^\d{1,4}$/.test(trimmed) ? trimmed : undefined;
}

interface ParsedTag {
  name: string;
  attrs: Record<string, string>;
  closing: boolean;
  selfClosing: boolean;
}

/** Parse one `<...>` tag body (without the angle brackets). */
function parseTag(raw: string): ParsedTag | null {
  const source = raw.trim();
  const closing = source.startsWith("/");
  const body = closing ? source.slice(1) : source;
  const nameMatch = body.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
  if (!nameMatch) return null;
  const name = nameMatch[1]!.toLowerCase();
  const rest = body.slice(nameMatch[1]!.length);
  const selfClosing = /\/\s*$/.test(rest);
  const attrs: Record<string, string> = {};
  const attrPattern = /([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(rest)) !== null) {
    const attrName = match[1]!.toLowerCase();
    attrs[attrName] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return { name, attrs, closing, selfClosing };
}

export interface SanitizeResult {
  /** Balanced, allowlisted HTML. Safe to parse and render, never to trust blindly. */
  html: string;
  /** Remote images refused. Counted so the UI can say so. */
  blockedRemoteImages: number;
}

/**
 * Allowlist-sanitize email HTML. Everything not explicitly permitted is
 * removed: scripts, styles, forms, iframes, event handlers, javascript: and
 * data: URLs, remote resources. Unknown tags are unwrapped (their text
 * survives); dangerous containers are dropped with their contents. The
 * output is balanced, every opened allowed tag is closed.
 */
export function sanitizeEmailHtml(input: string): SanitizeResult {
  let blockedRemoteImages = 0;
  const out: string[] = [];
  const openTags: string[] = [];
  let index = 0;

  const closeTo = (name: string) => {
    const at = openTags.lastIndexOf(name);
    if (at === -1) return;
    for (let depth = openTags.length - 1; depth >= at; depth -= 1) {
      out.push(`</${openTags[depth]}>`);
    }
    openTags.length = at;
  };

  while (index < input.length) {
    const lt = input.indexOf("<", index);
    if (lt === -1) {
      out.push(escapeText(input.slice(index)));
      break;
    }
    out.push(escapeText(input.slice(index, lt)));

    if (input.startsWith("<!--", lt)) {
      const end = input.indexOf("-->", lt + 4);
      index = end === -1 ? input.length : end + 3;
      continue;
    }
    // A `<` that cannot begin a tag is literal text, never markup.
    if (!/[a-zA-Z/!]/.test(input.charAt(lt + 1))) {
      out.push("&lt;");
      index = lt + 1;
      continue;
    }
    const gt = input.indexOf(">", lt);
    if (gt === -1) break;
    const rawTag = input.slice(lt + 1, gt);
    index = gt + 1;

    if (rawTag.startsWith("!") || rawTag.startsWith("?")) continue;
    const tag = parseTag(rawTag);
    if (!tag) continue;

    if (DROP_WITH_CONTENTS.has(tag.name) && !tag.closing) {
      // Skip to the matching close tag, honoring same-tag nesting.
      let depth = 1;
      const closePattern = new RegExp(`<\\/?${tag.name}\\b[^>]*>`, "gi");
      closePattern.lastIndex = index;
      let match: RegExpExecArray | null;
      while (depth > 0 && (match = closePattern.exec(input)) !== null) {
        depth += match[0].startsWith("</") ? -1 : 1;
      }
      index = depth === 0 ? closePattern.lastIndex : input.length;
      continue;
    }
    if (DROP_WITH_CONTENTS.has(tag.name)) continue;

    if (!ALLOWED_TAGS.has(tag.name)) continue; // unwrap: keep contents

    if (tag.closing) {
      closeTo(tag.name);
      continue;
    }

    if (tag.name === "img") {
      const cid = safeImageSrc(tag.attrs["src"] ?? "");
      if (!cid) {
        blockedRemoteImages += 1;
        continue;
      }
      const alt = tag.attrs["alt"]?.trim();
      const width = safeDimension(tag.attrs["width"] ?? "");
      const height = safeDimension(tag.attrs["height"] ?? "");
      out.push(
        `<img data-cid="${escapeAttribute(cid)}"` +
          (alt ? ` alt="${escapeAttribute(alt)}"` : "") +
          (width ? ` width="${width}"` : "") +
          (height ? ` height="${height}"` : "") +
          ` />`,
      );
      continue;
    }

    let attrs = "";
    if (tag.name === "a") {
      const href = safeHref(tag.attrs["href"] ?? "");
      if (href) attrs = ` href="${escapeAttribute(href)}"`;
    }
    const className = safeClassName(tag.attrs["class"] ?? "");
    if (className) attrs += ` class="${escapeAttribute(className)}"`;
    if ((tag.name === "td" || tag.name === "th") && safeDimension(tag.attrs["colspan"] ?? "")) {
      attrs += ` colspan="${tag.attrs["colspan"]}"`;
    }

    if (tag.selfClosing || VOID_TAGS.has(tag.name)) {
      out.push(`<${tag.name}${attrs} />`);
      continue;
    }
    out.push(`<${tag.name}${attrs}>`);
    openTags.push(tag.name);
  }

  while (openTags.length > 0) out.push(`</${openTags.pop()}>`);
  return { html: out.join(""), blockedRemoteImages };
}

/* ------------------------------------------------- HTML → plain text */

const BLOCK_BOUNDARY_TAGS = /<(p|div|br|li|tr|blockquote|h[1-4]|hr|table|ul|ol|pre)\b[^>]*\/?>/gi;

/** Decode the entities the sanitizer emits, plus the common named set. */
export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

/** Flatten (sanitized) HTML to readable text: block tags become newlines. */
export function htmlToPlainText(html: string): string {
  const withBreaks = html.replace(BLOCK_BOUNDARY_TAGS, "\n");
  const withoutTags = withBreaks.replace(/<[^>]*>/g, "");
  return decodeEntities(withoutTags)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* --------------------------------------------------- render node tree */

export type EmailNode =
  | { type: "text"; text: string }
  | {
      type: "element";
      tag: string;
      href?: string;
      cid?: string;
      alt?: string;
      className?: string;
      colspan?: number;
      children: EmailNode[];
    };

/**
 * Parse sanitized email HTML into a small node tree. The renderer turns
 * this into components; raw HTML never touches the DOM. Defensive by
 * construction: unknown tags unwrap, mismatched closes are ignored, and the
 * tree always balances.
 */
export function parseEmailHtml(html: string): EmailNode[] {
  const root: EmailNode[] = [];
  const stack: { tag: string; node: Extract<EmailNode, { type: "element" }> }[] = [];
  const current = (): EmailNode[] =>
    stack.length > 0 ? stack[stack.length - 1]!.node.children : root;

  let index = 0;
  while (index < html.length) {
    const lt = html.indexOf("<", index);
    if (lt === -1) {
      const text = decodeEntities(html.slice(index));
      if (text) current().push({ type: "text", text });
      break;
    }
    const text = decodeEntities(html.slice(index, lt));
    if (text) current().push({ type: "text", text });
    const gt = html.indexOf(">", lt);
    if (gt === -1) break;
    const rawTag = html.slice(lt + 1, gt);
    index = gt + 1;
    if (rawTag.startsWith("!") || rawTag.startsWith("?")) continue;
    const tag = parseTag(rawTag);
    if (!tag || !ALLOWED_TAGS.has(tag.name)) continue;

    if (tag.closing) {
      const at = stack.map((entry) => entry.tag).lastIndexOf(tag.name);
      if (at !== -1) stack.length = at;
      continue;
    }

    const node: Extract<EmailNode, { type: "element" }> = {
      type: "element",
      tag: tag.name,
      children: [],
    };
    if (tag.name === "a") {
      const href = safeHref(tag.attrs["href"] ?? "");
      if (href) node.href = href;
    }
    if (tag.name === "img") {
      // data-cid arrives from our own sanitizer with the prefix already
      // stripped, it is safe by construction; src goes through the check.
      const dataCid = (tag.attrs["data-cid"] ?? "").trim();
      const cid = dataCid || safeImageSrc(tag.attrs["src"] ?? "");
      if (!cid) continue; // should not happen post-sanitization; refuse anyway
      node.cid = cid;
      const alt = decodeEntities(tag.attrs["alt"] ?? "").trim();
      if (alt) node.alt = alt;
    }
    if ((tag.name === "td" || tag.name === "th") && safeDimension(tag.attrs["colspan"] ?? "")) {
      node.colspan = Number.parseInt(tag.attrs["colspan"]!, 10);
    }
    const className = safeClassName(tag.attrs["class"] ?? "");
    if (className) node.className = className;

    current().push(node);
    if (!VOID_TAGS.has(tag.name) && !tag.selfClosing) {
      stack.push({ tag: tag.name, node });
    }
  }
  return root;
}

/* --------------------------------------------------- quoted content */

/** What a plain-text body splits into. `quoted` absent means none detected. */
export interface SplitContent {
  main: string;
  quoted?: string;
}

const QUOTED_LINE_PATTERNS = [
  /^On.{0,200}wrote:\s*$/i, // Gmail / Apple Mail
  /^-+\s*Original Message\s*-+\s*$/i, // Outlook classic
  /^_{5,}\s*$/, // Outlook separator bar
  /^>/, // classic ">" reply quoting
];

/**
 * Split a plain-text body into the current message and quoted history.
 * Conservative: the first line that clearly begins quoted history starts
 * the quoted portion, and if nothing meaningful would remain in front of
 * it, the whole body stays primary. Nothing is deleted, quoted content is
 * rendered behind an explicit affordance.
 */
export function splitQuotedContent(body: string): SplitContent {
  const lines = body.split("\n");
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (!QUOTED_LINE_PATTERNS.some((pattern) => pattern.test(line))) continue;
    const main = lines.slice(0, index).join("\n").trim();
    if (main.length < 2) break; // fidelity first: a quote-only mail stays whole
    // A main that is only a reply preamble ("On … wrote:") means the whole
    // message is quoted history, keep it whole rather than fold everything.
    if (/^on\s.{0,120}?wrote:$/is.test(main)) break;
    return { main, quoted: lines.slice(index).join("\n").trim() };
  }
  return { main: body };
}

/** One node is quoted history when it is a blockquote or a Gmail quote div. */
export function isQuotedNode(node: EmailNode): boolean {
  if (node.type !== "element") return false;
  return node.tag === "blockquote" || (node.className ?? "").includes("gmail_quote");
}

/**
 * Split a parsed body into current content and quoted history, at the first
 * top-level quoted block. Same law as the text splitter: nothing is lost,
 * and a quote-only message renders whole.
 */
export function splitQuotedNodes(nodes: EmailNode[]): { main: EmailNode[]; quoted: EmailNode[] } {
  const at = nodes.findIndex(isQuotedNode);
  if (at === -1) return { main: nodes, quoted: [] };
  const main = nodes.slice(0, at);
  const hasMeaningfulMain = main.some(
    (node) => (node.type === "text" && node.text.trim().length > 1) || node.type === "element",
  );
  if (!hasMeaningfulMain) return { main: nodes, quoted: [] };
  return { main, quoted: nodes.slice(at) };
}

/* ------------------------------------------------------- collapse rule */

/**
 * The shared fold threshold: long mail starts folded, never clamped. The
 * measure is meaningful text only, blank structural lines (layout divs,
 * empty breaks) do not count as lines; only lines carrying actual words do.
 */
function textNeedsCollapse(basis: string): boolean {
  const text = basis.trim();
  if (!text) return false;
  const meaningfulLines = text.split("\n").filter((line) => line.trim().length > 0);
  return text.length > 1200 || meaningfulLines.length > 18;
}

/**
 * Collapse check over a whole stored body. Inline images and other non-text
 * resources never push an email behind Show more: a short note with a large
 * image renders whole.
 *
 * Prefer `primaryEmailNeedsCollapse` for rendering, this measures the
 * unsplit body and exists for callers that genuinely need the whole-body
 * measure.
 */
export function emailNeedsCollapse(
  bodyText: string | undefined,
  bodyHtml: string | undefined,
): boolean {
  const basis = bodyText ?? (bodyHtml ? htmlToPlainText(bodyHtml) : "");
  return textNeedsCollapse(basis);
}

/** Tags that separate readable lines when flattening a node tree to text. */
const TEXT_LINE_BOUNDARY_TAGS = new Set([
  "p",
  "div",
  "br",
  "hr",
  "li",
  "ul",
  "ol",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "pre",
  "table",
  "tr",
]);

/**
 * The readable text of a node tree. Inline images contribute zero, not
 * their alt, not their filename, because an image is not prose, and image
 * metadata must never push an email behind Show more. Block boundaries
 * become line breaks so the meaningful-line rule applies to HTML the same
 * way it applies to plain text.
 */
export function emailNodesToText(nodes: EmailNode[]): string {
  const parts: string[] = [];
  const walk = (list: EmailNode[]): void => {
    for (const node of list) {
      if (node.type === "text") {
        parts.push(node.text);
        continue;
      }
      if (node.tag === "img") continue;
      const boundary = TEXT_LINE_BOUNDARY_TAGS.has(node.tag);
      if (boundary) parts.push("\n");
      walk(node.children);
      if (boundary) parts.push("\n");
    }
  };
  walk(nodes);
  return parts.join("");
}

/**
 * The collapse law for rendering: only the primary content currently visible
 * to the reader decides whether Show more exists.
 *
 * Quoted history is split away FIRST and never counts, a short reply atop
 * a long thread shows whole, with quoted history behind its own independent
 * Show quoted text affordance. Inline images contribute zero text, so an
 * image-led note never folds. Genuinely long primary prose still folds with
 * Show more / Show less.
 */
export function primaryEmailNeedsCollapse(
  bodyText: string | undefined,
  bodyHtml: string | undefined,
): boolean {
  if (bodyHtml) {
    const { main } = splitQuotedNodes(parseEmailHtml(bodyHtml));
    return textNeedsCollapse(emailNodesToText(main));
  }
  if (!bodyText) return false;
  return textNeedsCollapse(splitQuotedContent(bodyText).main);
}
