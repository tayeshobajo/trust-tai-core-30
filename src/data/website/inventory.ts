/**
 * Page inventory discovery rules.
 *
 * Everything here is pure so it can be proved in tests: how a sitemap is read,
 * which addresses belong to the site, and what a page's own markup is allowed
 * to tell us. The rule that matters most is restraint. If the markup does not
 * say something, we do not say it either. A field we cannot read stays null,
 * and nothing already stored by another room is overwritten with emptiness.
 */

import { normalizePath } from "./url";

/* -------------------------------------------------------------- discovery */

/** Paths the crawler never fetches, whatever a sitemap claims. */
export const PRIVATE_PREFIXES = [
  "/admin",
  "/login",
  "/signin",
  "/sign-in",
  "/logout",
  "/account",
  "/dashboard",
  "/wp-admin",
  "/cms",
  "/studio",
  "/api",
  "/private",
  "/draft",
  "/preview",
] as const;

/** Bare host, lower case, without a leading www. */
export function host(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** True when the address belongs to the same site we were asked to read. */
export function sameSite(url: string, origin: string): boolean {
  const site = host(origin);
  return site.length > 0 && host(url) === site;
}

/** True when the path is public enough to fetch. */
export function isPublicPath(path: string): boolean {
  const normalized = normalizePath(path);
  return !PRIVATE_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

export interface SitemapDocument {
  /** Page addresses found in a urlset. */
  urls: string[];
  /** Child sitemap addresses found in a sitemapindex. */
  sitemaps: string[];
}

const LOCS = /<loc>\s*([^<]+?)\s*<\/loc>/gi;

/**
 * Reads a sitemap or a sitemap index without an XML dependency. A document
 * that names other sitemaps is treated as an index; anything else is a page
 * list. Entities are decoded because sitemaps escape ampersands.
 */
export function parseSitemap(xml: string): SitemapDocument {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const found: string[] = [];
  let match: RegExpExecArray | null;
  LOCS.lastIndex = 0;
  while ((match = LOCS.exec(xml)) !== null) {
    const raw = (match[1] ?? "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    if (raw) found.push(raw);
  }
  return isIndex ? { urls: [], sitemaps: found } : { urls: found, sitemaps: [] };
}

export interface DiscoveredPage {
  path: string;
  url: string;
}

/**
 * Turns raw sitemap addresses into one entry per public page: same site only,
 * no query variants, no fragments, no duplicate slash or case forms. The first
 * address seen for a path wins, so the list is stable between runs.
 */
export function discoverPages(urls: string[], origin: string): DiscoveredPage[] {
  const seen = new Map<string, DiscoveredPage>();
  for (const raw of urls) {
    if (!raw || !sameSite(raw, origin)) continue;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
    const path = normalizePath(parsed.pathname);
    if (!isPublicPath(path)) continue;
    if (seen.has(path)) continue;
    seen.set(path, { path, url: `${new URL(origin).origin}${path === "/" ? "/" : path}` });
  }
  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/* --------------------------------------------------------------- metadata */

export type DiscoveredPageType = "page" | "blog" | "case_study" | "landing_page";

export interface PageMetadata {
  title: string | null;
  canonicalUrl: string | null;
  publishedAt: string | null;
  lastUpdatedAt: string | null;
  /** null when the page did not say either way. */
  indexable: boolean | null;
  /** Only from explicit structured metadata, never guessed from copy. */
  topic: string | null;
  /** Only from explicit structured metadata. */
  ogType: string | null;
}

export const EMPTY_METADATA: PageMetadata = {
  title: null,
  canonicalUrl: null,
  publishedAt: null,
  lastUpdatedAt: null,
  indexable: null,
  topic: null,
  ogType: null,
};

const attr = (tag: string, name: string): string | null => {
  const match = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match ? (match[2] ?? match[3] ?? "").trim() || null : null;
};

const metaTags = (html: string): string[] => html.match(/<meta\b[^>]*>/gi) ?? [];

function metaContent(html: string, keys: string[]): string | null {
  const wanted = keys.map((key) => key.toLowerCase());
  for (const tag of metaTags(html)) {
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop") ?? "")
      .toLowerCase();
    if (key && wanted.includes(key)) {
      const content = attr(tag, "content");
      if (content) return content;
    }
  }
  return null;
}

/** ISO instant when the value is a date we can actually read, else null. */
export function readDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value.trim());
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function robotsIndexable(values: (string | null)[]): boolean | null {
  const said = values.filter((value): value is string => Boolean(value));
  if (said.length === 0) return null;
  const joined = said.join(",").toLowerCase();
  if (/\bnoindex\b/.test(joined)) return false;
  if (/\b(index|all)\b/.test(joined)) return true;
  return null;
}

function jsonLdBlocks(html: string): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const pattern = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1] ?? "");
      for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
        if (entry && typeof entry === "object") blocks.push(entry as Record<string, unknown>);
      }
    } catch {
      /* a broken block tells us nothing, which is not an error */
    }
  }
  return blocks;
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * Reads only what the page states about itself. Header robots directives are
 * passed in because they arrive on the response, not in the markup.
 */
export function parsePageMetadata(html: string, xRobotsTag?: string | null): PageMetadata {
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title =
    (titleTag?.[1] ?? "").replace(/\s+/g, " ").trim() ||
    metaContent(html, ["og:title", "twitter:title"]) ||
    null;

  const canonicalTag = (html.match(/<link\b[^>]*>/gi) ?? []).find(
    (tag) => (attr(tag, "rel") ?? "").toLowerCase() === "canonical",
  );

  const ld = jsonLdBlocks(html);
  const ldValue = (key: string): string | null => {
    for (const block of ld) {
      const value = str(block[key]);
      if (value) return value;
    }
    return null;
  };

  const published =
    readDate(metaContent(html, ["article:published_time", "datepublished", "og:published_time"])) ??
    readDate(ldValue("datePublished"));
  const updated =
    readDate(metaContent(html, ["article:modified_time", "datemodified", "og:updated_time"])) ??
    readDate(ldValue("dateModified"));

  const ldType = (() => {
    for (const block of ld) {
      const value = block["@type"];
      const named = Array.isArray(value) ? str(value[0]) : str(value);
      if (named) return named;
    }
    return null;
  })();

  return {
    title,
    canonicalUrl: canonicalTag ? attr(canonicalTag, "href") : null,
    publishedAt: published,
    lastUpdatedAt: updated,
    indexable: robotsIndexable([metaContent(html, ["robots", "googlebot"]), xRobotsTag ?? null]),
    topic:
      metaContent(html, ["article:section", "og:article:section"]) ??
      str(ld.find((block) => str(block["articleSection"]))?.["articleSection"]),
    ogType: metaContent(html, ["og:type"]) ?? ldType,
  };
}

/**
 * Page type only when the address or the page's own structured type says so.
 * Anything else is a page, which is the honest default.
 */
export function classifyPageType(path: string, meta: PageMetadata): DiscoveredPageType {
  const normalized = normalizePath(path);
  const type = (meta.ogType ?? "").toLowerCase();
  if (/^\/(case-stud(y|ies)|work|clients?)(\/|$)/.test(normalized)) return "case_study";
  if (/^\/(blog|insights?|articles?|writing|news)(\/|$)/.test(normalized)) return "blog";
  if (/^\/(lp|landing|get-started|start|apply|book)(\/|$)/.test(normalized)) return "landing_page";
  if (type === "article" || type === "blogposting") return "blog";
  return "page";
}

/* ------------------------------------------------------------ upsert shape */

export interface InventoryRowInput {
  organizationId: string;
  page: DiscoveredPage;
  meta: PageMetadata;
  inSitemap: boolean;
}

/**
 * The row we are prepared to write. Only grounded fields appear: keys we could
 * not read are simply absent, so an upsert never replaces a stored value with
 * an empty one and never touches content_intent.
 */
export function inventoryRow(input: InventoryRowInput): Record<string, unknown> {
  const { organizationId, page, meta, inSitemap } = input;
  const row: Record<string, unknown> = {
    organization_id: organizationId,
    path: page.path,
    url: page.url,
    page_type: classifyPageType(page.path, meta),
    in_sitemap: inSitemap,
    updated_at: new Date().toISOString(),
  };
  if (meta.title) row["title"] = meta.title;
  if (meta.canonicalUrl) row["canonical_url"] = meta.canonicalUrl;
  if (meta.publishedAt) row["published_at"] = meta.publishedAt;
  if (meta.lastUpdatedAt) row["last_updated_at"] = meta.lastUpdatedAt;
  if (meta.indexable !== null) row["indexable"] = meta.indexable;
  if (meta.topic) row["topic"] = meta.topic;
  return row;
}

export interface InventorySyncSummary {
  origin: string;
  discovered: number;
  fetched: number;
  upserted: number;
  skipped: number;
  failed: number;
  notes: string[];
}

export const EMPTY_SUMMARY: InventorySyncSummary = {
  origin: "",
  discovered: 0,
  fetched: 0,
  upserted: 0,
  skipped: 0,
  failed: 0,
  notes: [],
};
