/**
 * The page inventory sync (server only).
 *
 * It reads the public site the way a careful person would: the sitemap first
 * because that is the site's own list, then each page's markup for what the
 * page states about itself, and robots.txt only for crawlability context.
 *
 * Laws:
 *  - same site only, bounded, no query or fragment variants
 *  - a fetch that fails is a failure to read, never a deletion
 *  - fields that are absent stay absent, so content_intent and anything else
 *    a room already wrote survives untouched
 *  - writes are service role only and idempotent on organization plus path
 */

import {
  EMPTY_METADATA,
  discoverPages,
  inventoryRow,
  isPublicPath,
  parsePageMetadata,
  parseSitemap,
  sameSite,
  type DiscoveredPage,
  type InventorySyncSummary,
} from "@/data/website/inventory";
import { normalizePath } from "@/data/website/url";

type Client = { from: (table: string) => any };

const USER_AGENT = "TrustTaiOS-InventorySync/1.0 (+https://trusttai.com)";
const MAX_PAGES = 200;
const MAX_SITEMAPS = 10;

async function get(url: string, timeoutMs = 12_000): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xml;q=0.9,*/*;q=0.8" },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response;
  } catch {
    return null;
  }
}

/** Sitemap addresses named by robots.txt, plus the conventional location. */
export async function sitemapCandidates(origin: string): Promise<string[]> {
  const found: string[] = [];
  const robots = await get(`${origin}/robots.txt`);
  if (robots?.ok) {
    const body = await robots.text();
    for (const line of body.split("\n")) {
      const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
      const candidate = match?.[1];
      if (candidate && sameSite(candidate, origin)) found.push(candidate);
    }
  }
  if (found.length === 0) found.push(`${origin}/sitemap.xml`);
  return [...new Set(found)].slice(0, MAX_SITEMAPS);
}

/** Walks a sitemap or sitemap index into a bounded list of public pages. */
export async function discoverFromSitemaps(
  origin: string,
  candidates: string[],
): Promise<{ pages: DiscoveredPage[]; notes: string[] }> {
  const notes: string[] = [];
  const urls: string[] = [];
  const queue = [...candidates];
  const visited = new Set<string>();

  while (queue.length > 0 && visited.size < MAX_SITEMAPS) {
    const next = queue.shift();
    if (!next || visited.has(next)) continue;
    visited.add(next);
    const response = await get(next);
    if (!response?.ok) {
      notes.push(`Could not read ${next}.`);
      continue;
    }
    const parsed = parseSitemap(await response.text());
    urls.push(...parsed.urls);
    for (const child of parsed.sitemaps) {
      if (sameSite(child, origin)) queue.push(child);
    }
  }

  return { pages: discoverPages(urls, origin).slice(0, MAX_PAGES), notes };
}

export interface InventorySyncOptions {
  organizationId: string;
  origin: string;
  /** Optional cap for a quick verification run. */
  limit?: number;
}

/** Runs one bounded inventory sync and returns exactly what it did. */
export async function syncPageInventory(
  client: Client,
  options: InventorySyncOptions,
): Promise<InventorySyncSummary> {
  const origin = new URL(options.origin).origin;
  const summary: InventorySyncSummary = {
    origin,
    discovered: 0,
    fetched: 0,
    upserted: 0,
    skipped: 0,
    failed: 0,
    notes: [],
  };

  const candidates = await sitemapCandidates(origin);
  const discovery = await discoverFromSitemaps(origin, candidates);
  summary.notes.push(...discovery.notes);

  const pages = discovery.pages
    .filter((page) => isPublicPath(page.path))
    .slice(0, Math.max(1, Math.min(options.limit ?? MAX_PAGES, MAX_PAGES)));
  summary.discovered = pages.length;

  if (pages.length === 0) {
    summary.notes.push("No public page was discovered, so nothing was written.");
    return summary;
  }

  const rows: Record<string, unknown>[] = [];
  for (const page of pages) {
    const response = await get(page.url);
    if (!response || !response.ok) {
      summary.failed += 1;
      summary.notes.push(`Could not read ${page.path}, left unchanged.`);
      continue;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) {
      summary.skipped += 1;
      continue;
    }
    summary.fetched += 1;
    const html = await response.text();
    const meta = parsePageMetadata(html, response.headers.get("x-robots-tag"));
    rows.push(
      inventoryRow({
        organizationId: options.organizationId,
        page: { path: normalizePath(page.path), url: page.url },
        meta: meta ?? EMPTY_METADATA,
        inSitemap: true,
      }),
    );
  }

  if (rows.length > 0) {
    const { error } = await client
      .from("website_pages")
      .upsert(rows, { onConflict: "organization_id,path" });
    if (error) throw new Error(error.message);
    summary.upserted = rows.length;
  }

  return summary;
}
