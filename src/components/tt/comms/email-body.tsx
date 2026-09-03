/**
 * The email itself, rendered faithfully.
 *
 * Comms shows the actual meaningful email a person sent or received, full
 * body, inline images in place, quoted history behind an explicit toggle,
 * and never a silent clamp: long mail starts folded with a visible
 * Show more / Show less.
 *
 * Rendering never touches raw HTML: the stored HTML was sanitized at ingest
 * and is parsed here into a small node tree that becomes ordinary
 * components. Inline images load through the authenticated attachment
 * proxy as object URLs, no Google credential or raw Gmail URL ever reaches
 * the browser. Remote images were refused at ingest and are simply absent,
 * with the refusal count surfaced in the event's provenance line.
 */

import { useEffect, useMemo, useState } from "react";
import { FileText, ImageOff } from "lucide-react";

import {
  parseEmailHtml,
  primaryEmailNeedsCollapse,
  splitQuotedContent,
  splitQuotedNodes,
  type EmailNode,
} from "@/domain/comms-email-body";
import type { AttachmentMeta } from "@/domain/comms-integrations";
import { formatBytes } from "@/domain/comms-mime";
import { gmailFetchInlineImage } from "@/data/supabase/comms-gmail";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------- inline images */

/**
 * One inline MIME image, fetched on demand through the authenticated proxy
 * and rendered from a blob URL. The message row is proof of access; the
 * stored metadata is what lets the server serve it inline.
 */
function InlineImage({
  organizationId,
  messageId,
  resource,
}: {
  organizationId: string;
  messageId: string;
  resource: AttachmentMeta;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!resource.attachmentId) {
      setFailed(true);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    gmailFetchInlineImage({
      organizationId,
      messageId,
      attachmentId: resource.attachmentId,
    })
.then((created) => {
        if (cancelled) {
          URL.revokeObjectURL(created);
          return;
        }
        objectUrl = created;
        setUrl(created);
      })
.catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [organizationId, messageId, resource.attachmentId]);

  if (failed) {
    // The image could not be brought over; its identity still shows, so the
    // email never reads as if nothing was there.
    return (
      <span className="my-1 inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground">
        <ImageOff className="h-3 w-3" aria-hidden />
        <span className="max-w-[180px] truncate">{resource.filename}</span>
        {resource.size > 0 ? (
          <span className="text-[10px] opacity-70">{formatBytes(resource.size)}</span>
        ): null}
      </span>
    );
  }
  if (!url) {
    return (
      <span
        aria-hidden
        className="my-1 block h-16 w-40 animate-pulse rounded-md bg-secondary/60"
      />
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={resource.filename}
      className="my-1 inline-block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <img
        src={url}
        alt={resource.filename}
        className="h-auto max-h-[440px] w-auto max-w-full rounded-md border border-border object-contain"
        loading="lazy"
      />
    </a>
  );
}

/* ------------------------------------------------------------- rendering */

interface RenderContext {
  organizationId: string;
  messageId: string;
  inlineByCid: ReadonlyMap<string, AttachmentMeta>;
}

function renderNode(node: EmailNode, key: string, ctx: RenderContext): React.ReactNode {
  if (node.type === "text") return node.text;

  const children = node.children.map((child, index) => (
    <span key={`${key}:${index}`}>{renderNode(child, `${key}:${index}`, ctx)}</span>
  ));

  switch (node.tag) {
    case "a":
      return node.href ? (
        <a
          key={key}
          href={node.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-royal underline decoration-royal/40 underline-offset-2"
        >
          {children}
        </a>
      ): (
        <span key={key}>{children}</span>
      );
    case "b":
    case "strong":
      return (
        <strong key={key} className="font-medium text-foreground">
          {children}
        </strong>
      );
    case "i":
    case "em":
      return <em key={key}>{children}</em>;
    case "u":
      return <u key={key}>{children}</u>;
    case "s":
    case "strike":
      return <s key={key}>{children}</s>;
    case "br":
      return <br key={key} />;
    case "hr":
      return <hr key={key} className="my-2 border-border" />;
    case "p":
      return (
        <span key={key} className="block [&:not(:first-child)]:mt-2">
          {children}
        </span>
      );
    case "div":
      return (
        <span key={key} className="block">
          {children}
        </span>
      );
    case "blockquote":
      return (
        <span key={key} className="my-1 block border-l-2 border-border pl-3 text-muted-foreground">
          {children}
        </span>
      );
    case "ul":
      return (
        <span key={key} className="my-1 block list-disc pl-5">
          {children}
        </span>
      );
    case "ol":
      return (
        <span key={key} className="my-1 block list-decimal pl-5">
          {children}
        </span>
      );
    case "li":
      return (
        <span key={key} className="block">
          {children}
        </span>
      );
    case "h1":
    case "h2":
    case "h3":
    case "h4":
      return (
        <span key={key} className="mt-2 block font-medium text-foreground">
          {children}
        </span>
      );
    case "pre":
    case "code":
      return (
        <span key={key} className="font-mono text-[12px]">
          {children}
        </span>
      );
    case "table":
      return (
        <span key={key} className="my-1 block overflow-x-auto">
          <table className="border-collapse text-[12px]">{children}</table>
        </span>
      );
    case "thead":
      return <thead key={key}>{children}</thead>;
    case "tbody":
      return <tbody key={key}>{children}</tbody>;
    case "tfoot":
      return <tfoot key={key}>{children}</tfoot>;
    case "tr":
      return <tr key={key}>{children}</tr>;
    case "td":
    case "th":
      return (
        <td key={key} colSpan={node.colspan} className="border border-border px-2 py-1 align-top">
          {children}
        </td>
      );
    case "img": {
      if (!node.cid) return null;
      const resource =
        ctx.inlineByCid.get(node.cid) ?? ctx.inlineByCid.get(node.cid.toLowerCase());
      if (!resource || !resource.attachmentId) {
        // The image was referenced but its resource was not stored. Show the
        // absence plainly rather than a broken frame.
        return (
          <span
            key={key}
            className="my-1 inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground"
          >
            <ImageOff className="h-3 w-3" aria-hidden />
            {node.alt || "Inline image"}
          </span>
        );
      }
      return (
        <InlineImage
          key={key}
          organizationId={ctx.organizationId}
          messageId={ctx.messageId}
          resource={resource}
        />
      );
    }
    default:
      return <span key={key}>{children}</span>;
  }
}

/** Every Content-ID an HTML body references, so unreferenced inline resources can still show. */
function collectCids(nodes: EmailNode[], into: Set<string>): void {
  for (const node of nodes) {
    if (node.type !== "element") continue;
    if (node.cid) into.add(node.cid.toLowerCase());
    collectCids(node.children, into);
  }
}

/* --------------------------------------------------------------- the body */

const COLLAPSED_HEIGHT = "max-h-[16rem]";

/**
 * One email's body: full fidelity, quoted history behind a toggle, long
 * mail folded with an explicit affordance, never a silent clamp.
 */
export function EmailBodyView({
  organizationId,
  messageId,
  text,
  html,
  inline = [],
}: {
  organizationId: string;
  /** The comms_messages row id, the access handle for inline images. */
  messageId: string;
  text?: string;
  html?: string;
  inline?: AttachmentMeta[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [showQuoted, setShowQuoted] = useState(false);

  // The law: only the primary, currently visible content decides whether
  // Show more exists, quoted history and inline images never cause a fold.
  const needsCollapse = useMemo(() => primaryEmailNeedsCollapse(text, html), [text, html]);

  const inlineByCid = useMemo(() => {
    const map = new Map<string, AttachmentMeta>();
    for (const resource of inline) {
      if (resource.contentId) map.set(resource.contentId.toLowerCase(), resource);
    }
    return map;
  }, [inline]);

  const parsed = useMemo(() => {
    if (!html) return null;
    const nodes = parseEmailHtml(html);
    const { main, quoted } = splitQuotedNodes(nodes);
    const referenced = new Set<string>();
    collectCids(main, referenced);
    collectCids(quoted, referenced);
    return { main, quoted, referenced };
  }, [html]);

  const textSplit = useMemo(() => {
    if (html || !text) return null;
    return splitQuotedContent(text);
  }, [html, text]);

  const ctx: RenderContext = { organizationId, messageId, inlineByCid };

  // Inline resources the body never referenced still render, after the body,
  // so nothing the person embedded disappears.
  const unreferenced = inline.filter(
    (resource) =>
      resource.contentId &&
      (!parsed || !parsed.referenced.has(resource.contentId.toLowerCase())),
  );

  const hasQuoted = parsed ? parsed.quoted.length > 0: Boolean(textSplit?.quoted);

  return (
    <div className="mt-1 text-[13px] leading-relaxed text-foreground/90">
      <div className={cn("relative", !expanded && needsCollapse ? `${COLLAPSED_HEIGHT} overflow-hidden`: "")}>
        {parsed ? (
          <div className="whitespace-pre-wrap break-words">
            {parsed.main.map((node, index) => renderNode(node, `m${index}`, ctx))}
          </div>
        ): textSplit ? (
          <p className="whitespace-pre-wrap break-words">{textSplit.main}</p>
        ): null}

        {!expanded && needsCollapse ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent"
          />
        ): null}
      </div>

      {unreferenced.map((resource) =>
        resource.attachmentId ? (
          <InlineImage
            key={resource.contentId ?? resource.filename}
            organizationId={organizationId}
            messageId={messageId}
            resource={resource}
          />
        ): null,
      )}

      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {needsCollapse ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expanded ? "Show less": "Show more"}
          </button>
        ): null}
        {hasQuoted ? (
          <button
            type="button"
            onClick={() => setShowQuoted((value) => !value)}
            aria-expanded={showQuoted}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {showQuoted ? "Hide quoted text": "Show quoted text"}
          </button>
        ): null}
      </div>

      {showQuoted && parsed && parsed.quoted.length > 0 ? (
        <div className="mt-2 border-l-2 border-border pl-3 text-muted-foreground">
          <div className="whitespace-pre-wrap break-words">
            {parsed.quoted.map((node, index) => renderNode(node, `q${index}`, ctx))}
          </div>
        </div>
      ): null}
      {showQuoted && textSplit?.quoted ? (
        <p className="mt-2 whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-muted-foreground">
          {textSplit.quoted}
        </p>
      ): null}
    </div>
  );
}

/** Re-exported so the room can keep its chip row for ordinary files only. */
export function fileAttachments(attachments: AttachmentMeta[] | undefined): AttachmentMeta[] {
  return (attachments ?? []).filter((file) => !file.inline);
}

/** Kept for the chip fallback when an inline resource has no provider handle. */
export { FileText as EmailFileIcon };
