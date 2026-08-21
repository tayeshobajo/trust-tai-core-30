/**
 * Website measurement, read side.
 *
 * Additive and optional. Each table is read on its own and a missing relation
 * means "not provisioned", not an error, so the room degrades honestly into
 * unknown rather than pretending it measured a zero.
 *
 * Schema lives in docs/website-analytics-schema.sql. Writes belong to the
 * signed server receivers and provider syncs, never to a browser.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import {
  EMPTY_CONTENT_INTENT,
  isPageType,
  type ContentIntent,
  type PageMetricsDay,
  type SearchMetricsDay,
  type WebsitePage,
} from "@/domain/website-analytics";

import { missingRelation, type Provisioned } from "./settings-service";
import type { Row } from "./schema";

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const bool = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);
const num = (value: unknown): number => (typeof value === "number" ? value : 0);

function toIntent(value: unknown): ContentIntent {
  const source = obj(value);
  if (Object.keys(source).length === 0) return EMPTY_CONTENT_INTENT;
  return {
    topic: text(source["topic"]),
    audience: text(source["audience"]),
    searchIntent: text(source["search_intent"]),
    purpose: text(source["purpose"]),
    relatedPillar: text(source["related_pillar"]),
    primaryNextStep: text(source["primary_next_step"]),
    relatedContent: Array.isArray(source["related_content"])
      ? (source["related_content"] as unknown[]).filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  };
}

/** The canonical inventory of public pages. */
export async function listWebsitePages(
  organizationId: string,
): Promise<Provisioned<WebsitePage[]>> {
  const result = await supabase
    .from("website_pages")
    .select("*")
    .eq("organization_id", organizationId)
    .limit(1000);

  if (result.error) {
    if (missingRelation(result.error)) return { provisioned: false, value: [] };
    throw new Error(result.error.message);
  }

  const value = ((result.data ?? []) as Row[]).map((row) => ({
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    path: String(row["path"] ?? "/"),
    url: text(row["url"]),
    title: String(row["title"] ?? row["path"] ?? ""),
    pageType: isPageType(row["page_type"]) ? row["page_type"] : ("page" as const),
    publishedAt: text(row["published_at"]),
    lastUpdatedAt: text(row["last_updated_at"]),
    indexable: bool(row["indexable"]),
    inSitemap: bool(row["in_sitemap"]),
    canonicalUrl: text(row["canonical_url"]),
    primaryCta: text(row["primary_cta"]),
    topic: text(row["topic"]),
    intent: toIntent(row["content_intent"]),
  }));

  return { provisioned: true, value };
}

/** Provider neutral daily page metrics. GA4 is one possible producer. */
export async function listPageMetrics(
  organizationId: string,
  sinceDate: string,
): Promise<Provisioned<PageMetricsDay[]>> {
  const result = await supabase
    .from("website_page_metrics_daily")
    .select("*")
    .eq("organization_id", organizationId)
    .gte("metric_date", sinceDate)
    .limit(20000);

  if (result.error) {
    if (missingRelation(result.error)) return { provisioned: false, value: [] };
    throw new Error(result.error.message);
  }

  const value = ((result.data ?? []) as Row[]).map((row) => ({
    date: String(row["metric_date"]),
    path: String(row["path"] ?? "/"),
    title: text(row["title"]),
    views: num(row["views"]),
    users: num(row["users"]),
    landingSessions: num(row["landing_sessions"]),
    engagedSessions: num(row["engaged_sessions"]),
    averageEngagementSeconds: num(row["average_engagement_seconds"]),
    source: text(row["source"]),
    medium: text(row["medium"]),
    device: text(row["device"]),
    country: text(row["country"]),
  }));

  return { provisioned: true, value };
}

/** Provider neutral daily search metrics. Search Console is one producer. */
export async function listSearchMetrics(
  organizationId: string,
  sinceDate: string,
): Promise<Provisioned<SearchMetricsDay[]>> {
  const result = await supabase
    .from("website_search_metrics_daily")
    .select("*")
    .eq("organization_id", organizationId)
    .gte("metric_date", sinceDate)
    .limit(20000);

  if (result.error) {
    if (missingRelation(result.error)) return { provisioned: false, value: [] };
    throw new Error(result.error.message);
  }

  const value = ((result.data ?? []) as Row[]).map((row) => ({
    date: String(row["metric_date"]),
    query: String(row["query"] ?? ""),
    path: String(row["path"] ?? "/"),
    clicks: num(row["clicks"]),
    impressions: num(row["impressions"]),
    position: num(row["average_position"]),
    device: text(row["device"]),
    country: text(row["country"]),
  }));

  return { provisioned: true, value };
}
