/**
 * Public site health, kept deliberately small.
 *
 * This is not an SEO product. It answers one question: is anything about the
 * public site quietly working against us. Every finding names the pages it is
 * about so a person can check it in a minute.
 */

import type { HealthFinding, PageRow, WebsitePage } from "@/domain/website-analytics";

import { normalizePath } from "./url";

/** Impressions with no clicks only matters once the page is genuinely seen. */
export const SEEN_BUT_UNCLICKED = 100;

export function healthFindings(rows: PageRow[], pages: WebsitePage[]): HealthFinding[] {
  const findings: HealthFinding[] = [];
  const inventory = new Map(pages.map((page) => [normalizePath(page.path), page]));

  const noindex = pages.filter((page) => page.indexable === false).map((page) => page.path);
  if (noindex.length > 0) {
    findings.push({
      id: "noindex",
      severity: "attention",
      title: "Pages excluded from search",
      detail:
        "These public pages are marked as not indexable. If that was not deliberate, search cannot bring anyone to them.",
      paths: noindex,
    });
  }

  const missingSitemap = pages
    .filter((page) => page.inSitemap === false && page.indexable !== false)
    .map((page) => page.path);
  if (missingSitemap.length > 0) {
    findings.push({
      id: "sitemap",
      severity: "watch",
      title: "Indexable pages missing from the sitemap",
      detail: "Search engines will find these more slowly than the rest of the site.",
      paths: missingSitemap,
    });
  }

  const canonicalConflicts = pages
    .filter((page) => {
      if (!page.canonicalUrl) return false;
      return normalizePath(page.canonicalUrl) !== normalizePath(page.path);
    })
    .map((page) => page.path);
  if (canonicalConflicts.length > 0) {
    findings.push({
      id: "canonical",
      severity: "watch",
      title: "Pages pointing their canonical elsewhere",
      detail: "Credit for these pages is being handed to another address.",
      paths: canonicalConflicts,
    });
  }

  const unclicked = rows
    .filter(
      (row) =>
        row.impressions !== null &&
        row.impressions >= SEEN_BUT_UNCLICKED &&
        (row.clicks ?? 0) === 0,
    )
    .map((row) => row.path);
  if (unclicked.length > 0) {
    findings.push({
      id: "seen_not_clicked",
      severity: "attention",
      title: "Seen in search, never clicked",
      detail:
        "These pages appear often enough to matter and receive no clicks. The title and description are usually the cause.",
      paths: unclicked,
    });
  }

  const unlisted = rows.filter((row) => row.unlisted).map((row) => row.path);
  if (unlisted.length > 0) {
    findings.push({
      id: "unlisted",
      severity: "watch",
      title: "Traffic on pages Core does not hold",
      detail:
        "Providers reported these paths but the page inventory has no record of them, so they cannot be described or measured properly.",
      paths: unlisted,
    });
  }

  const unknownIndexing = pages.filter((page) => page.indexable === null).length;
  if (pages.length > 0 && unknownIndexing === pages.length) {
    findings.push({
      id: "indexing_unknown",
      severity: "watch",
      title: "Indexing state is unknown",
      detail:
        "No page reports whether it is indexable. Health stays partly unreadable until the site sends that with the inventory.",
      paths: [],
    });
  }

  if (findings.length === 0 && (rows.length > 0 || inventory.size > 0)) {
    findings.push({
      id: "healthy",
      severity: "healthy",
      title: "Nothing is working against us",
      detail: "No indexing, sitemap, canonical or visibility problem is visible in what Core holds.",
      paths: [],
    });
  }

  return findings;
}

/**
 * Readiness fields that genuinely affect whether a page can be found and
 * understood. No score, just presence or absence of the things that matter.
 */
export interface ReadinessField {
  label: string;
  present: boolean | null;
  note: string;
}

export function pageReadiness(page: WebsitePage | undefined, row: PageRow): ReadinessField[] {
  return [
    { label: "Title", present: Boolean(row.title && row.title !== row.path), note: "The page states what it is." },
    { label: "Canonical URL", present: page?.canonicalUrl ? true : null, note: "Set when the site reports one." },
    { label: "In sitemap", present: page?.inSitemap ?? null, note: "Helps search find it." },
    { label: "Indexable", present: page?.indexable ?? null, note: "Allowed into search results." },
    { label: "Primary next step", present: page?.primaryCta ? true : null, note: "What a reader is invited to do." },
    {
      label: "Freshness",
      present: page?.lastUpdatedAt ? true : null,
      note: page?.lastUpdatedAt
        ? `Last meaningful update ${new Date(page.lastUpdatedAt).toLocaleDateString()}.`
        : "No update date recorded.",
    },
  ];
}
