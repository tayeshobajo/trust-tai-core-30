/**
 * Trust Tai OS, the Website measurement contracts.
 *
 * Website owns attention, behaviour, intake, public site health and the
 * performance of content after it is published. Studio owns creation. Scout
 * owns qualification. Conductor owns governed action. Nothing in this file
 * creates delivery work.
 *
 * Everything here is provider neutral on purpose. GA4 and Search Console are
 * two possible sources of the same shapes; the room never imports a provider.
 */

import type { ID, ISODateTime } from "./entities";
import type { KnownNumber } from "./website";

/* ----------------------------------------------------------- page inventory */

export const PAGE_TYPES = ["page", "blog", "case_study", "landing_page"] as const;
export type WebsitePageType = (typeof PAGE_TYPES)[number];

export function isPageType(value: unknown): value is WebsitePageType {
  return (PAGE_TYPES as readonly string[]).includes(String(value));
}

/** What Studio can hand over when approved content is published. */
export interface ContentIntent {
  topic?: string | null;
  audience?: string | null;
  searchIntent?: string | null;
  purpose?: string | null;
  relatedPillar?: string | null;
  primaryNextStep?: string | null;
  relatedContent: string[];
}

export const EMPTY_CONTENT_INTENT: ContentIntent = { relatedContent: [] };

/** One public TrustTai.com page. The canonical inventory row. */
export interface WebsitePage {
  id: ID;
  organizationId: ID;
  /** Normalized path, always the join key. */
  path: string;
  url?: string | null;
  title: string;
  pageType: WebsitePageType;
  publishedAt?: ISODateTime | null;
  lastUpdatedAt?: ISODateTime | null;
  /** null means Core has not been told, which is not the same as false. */
  indexable: boolean | null;
  inSitemap: boolean | null;
  canonicalUrl?: string | null;
  primaryCta?: string | null;
  topic?: string | null;
  intent: ContentIntent;
}

/* --------------------------------------------------------- provider metrics */

/** GA4 shaped, provider neutral. One row per page per day per breakdown. */
export interface PageMetricsDay {
  date: string;
  path: string;
  title?: string | null;
  views: number;
  users: number;
  landingSessions: number;
  engagedSessions: number;
  averageEngagementSeconds: number;
  source?: string | null;
  medium?: string | null;
  device?: string | null;
  country?: string | null;
}

/** Search Console shaped, provider neutral. */
export interface SearchMetricsDay {
  date: string;
  query: string;
  path: string;
  clicks: number;
  impressions: number;
  position: number;
  device?: string | null;
  country?: string | null;
}

/* --------------------------------------------------------------- readiness */

export const WEBSITE_PROVIDERS = [
  "ga4",
  "search_console",
  "page_inventory",
  "first_party_events",
  "site_health",
] as const;

export type WebsiteProviderId = (typeof WEBSITE_PROVIDERS)[number];

/**
 * How a source is doing right now. "Not configured" and "quiet" are different
 * truths, and both are different from a zero.
 */
export type ProviderState =
  | "live"
  | "stale"
  | "quiet"
  | "not_configured"
  | "failed";

/** What a scheduled sync recorded the last time it ran. */
export interface ProviderSyncRecord {
  provider: WebsiteProviderId;
  configured: boolean;
  lastRunAt: ISODateTime | null;
  lastSuccessAt: ISODateTime | null;
  lastError: string | null;
  rowsWritten: number;
}

export interface ProviderReadiness {
  id: WebsiteProviderId;
  label: string;
  /** True only when rows have actually been observed. Never optimistic. */
  connected: boolean;
  /** Plain language, shown to a person. */
  note: string;
  rows: number;
  /**
   * The most recent moment this provider actually reported something. Null
   * when nothing has arrived, which is not the same as a sync at zero.
   */
  lastSyncedAt: ISODateTime | null;
  /** What stays unknown while this provider is silent. */
  covers: string;
  /** Freshness, once a sync record is available. */
  state?: ProviderState;
  /** The last failure this provider reported, in short plain words. */
  lastError?: string | null;
  /** When the scheduled job last attempted this provider. */
  lastRunAt?: ISODateTime | null;
  /**
   * True when the capability itself exists, whether or not it has produced a
   * row. A signed receiver that has heard nothing is quiet, not unconfigured.
   */
  capabilityAvailable?: boolean;
  /** Borrow freshness from another provider when this one is derived. */
  derivedFrom?: WebsiteProviderId;
}



/**
 * Referrals we can attribute to a named assistant. Deliberately narrow: it is
 * a grouping of referrer hosts we recognise, never a claim about how often a
 * model read or cited the site.
 */
export interface AiReferralRow {
  host: string;
  label: string;
  visits: number;
  submissions: number;
}

export interface AiReferralSummary {
  rows: AiReferralRow[];
  visits: number;
  submissions: number;
  /** Page views carrying a referrer we could read at all. */
  attributableVisits: number;
  /** True when no first party events have been received in the window. */
  unmeasured: boolean;
}


/* ------------------------------------------------------------- joined reads */

export interface PageRow {
  path: string;
  title: string;
  pageType: WebsitePageType;
  publishedAt?: ISODateTime | null;
  lastUpdatedAt?: ISODateTime | null;
  indexable: boolean | null;
  inSitemap: boolean | null;
  canonicalUrl?: string | null;
  primaryCta?: string | null;
  /** True when the path was seen in metrics but is not in the inventory. */
  unlisted: boolean;

  views: KnownNumber;
  users: KnownNumber;
  landingSessions: KnownNumber;
  engagedSessions: KnownNumber;
  engagementRate: KnownNumber;
  averageEngagementSeconds: KnownNumber;

  clicks: KnownNumber;
  impressions: KnownNumber;
  ctr: KnownNumber;
  averagePosition: KnownNumber;

  intakeStarts: KnownNumber;
  intakeSubmissions: KnownNumber;
  qualified: KnownNumber;
  contentReads: KnownNumber;
}

export type ContentClassification =
  | "breakout"
  | "sleeping_asset"
  | "needs_refresh"
  | "conversion_winner";

export interface ContentRow extends PageRow {
  topic?: string | null;
  intent: ContentIntent;
  classifications: ContentClassification[];
  /** Why each label was applied. Deterministic and inspectable. */
  reasons: string[];
}

/* --------------------------------------------------------- search intelligence */

export interface QueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  averagePosition: number;
  /** Clicks in the later half minus the earlier half. Null without history. */
  change: KnownNumber;
  topPath: string | null;
}

export interface CompetingQuery {
  query: string;
  paths: { path: string; impressions: number }[];
}

export interface ContentOpportunity {
  query: string;
  impressions: number;
  averagePosition: number;
  ctr: number;
  reason: string;
  coverage: "none" | "thin" | "existing";
  /** The page to refresh first, when one already covers the demand. */
  refreshPath: string | null;
}

/* ------------------------------------------------------------------- health */

export type HealthSeverity = "attention" | "watch" | "healthy";

export interface HealthFinding {
  id: string;
  severity: HealthSeverity;
  title: string;
  detail: string;
  paths: string[];
}

/* ------------------------------------------------------------- observations */

export type ObservationLane = "working" | "changing" | "attention" | "next_move";

export interface WebsiteObservation {
  id: string;
  lane: ObservationLane;
  statement: string;
  /** The rows behind the statement, so a person can check it. */
  evidence: string[];
}

/* --------------------------------------------------------------- referrals */

/**
 * Assistant referrers we can recognise in a referrer host. This is a source
 * grouping only. It never means we can see how often a model cited us.
 */
export const AI_REFERRER_HOSTS = [
  "chat.openai.com",
  "chatgpt.com",
  "perplexity.ai",
  "copilot.microsoft.com",
  "gemini.google.com",
  "claude.ai",
] as const;
