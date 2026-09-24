/**
 * Studio · Audience — the rules for reading the website's newsletter list.
 *
 * Read-only. Trust Tai OS keeps no copy of the list, never changes anyone's
 * consent and never sends. The website owns the list; this module only turns
 * its answer into something a person can read honestly.
 *
 * Honesty rule: the website currently caps its answer (1000 rows) and its
 * counts describe only what it returned. Unless the website says its counts
 * cover the whole audience, we say "at least" and explain why. Unknown ≠ zero.
 */

export const AUDIENCE_STATUSES = ["pending", "confirmed", "unsubscribed"] as const;
export type AudienceStatus = (typeof AUDIENCE_STATUSES)[number];
export type AudienceFilter = AudienceStatus | "all";

export const AUDIENCE_PAGE_SIZE = 25;
/** The cap the website documents today. Answers this long are assumed cut off. */
export const KNOWN_SOURCE_CAP = 1000;

export interface AudienceSubscriber {
  email: string;
  status: AudienceStatus | "unknown";
  source: string | null;
  confirmedAt: string | null;
  createdAt: string | null;
  providerSyncState: string | null;
}

export interface AudienceCounts {
  pending: number | null;
  confirmed: number | null;
  unsubscribed: number | null;
  total: number | null;
}

/** Whether the counts are the whole audience or only what came back. */
export type CountScope = "whole_audience" | "returned_rows";

export interface AudienceFeed {
  subscribers: AudienceSubscriber[];
  counts: AudienceCounts;
  scope: CountScope;
  /** True when the answer is probably cut off at the website's cap. */
  likelyCapped: boolean;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function count(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}
/** Only real, parseable timestamps survive; anything else is unknown. */
export function safeTimestamp(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export class AudienceShapeError extends Error {
  constructor() {
    super("The website answered, but not in the shape Studio expects.");
    this.name = "AudienceShapeError";
  }
}

/**
 * Parse the website's answer. Accepts today's contract and a revised one that
 * adds `counts_scope: "all"` (or `complete: true`) when counts cover everyone.
 */
export function parseAudienceFeed(body: unknown): AudienceFeed {
  if (!body || typeof body !== "object") throw new AudienceShapeError();
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b["subscribers"])) throw new AudienceShapeError();
  const subscribers: AudienceSubscriber[] = [];
  for (const raw of b["subscribers"] as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const email = str(r["email"]);
    if (!email) continue;
    const status = str(r["status"]);
    subscribers.push({
      email,
      status: (AUDIENCE_STATUSES as readonly string[]).includes(status ?? "")
        ? (status as AudienceStatus)
        : "unknown",
      source: str(r["source"]),
      confirmedAt: safeTimestamp(r["confirmed_at"]),
      createdAt: safeTimestamp(r["created_at"]),
      providerSyncState: str(r["provider_sync_state"]),
    });
  }
  const c = (b["counts"] && typeof b["counts"] === "object" ? b["counts"] : {}) as Record<
    string,
    unknown
  >;
  const counts: AudienceCounts = {
    pending: count(c["pending"]),
    confirmed: count(c["confirmed"]),
    unsubscribed: count(c["unsubscribed"]),
    total: count(c["total"]),
  };
  const declaredWhole = b["counts_scope"] === "all" || b["complete"] === true;
  const likelyCapped = !declaredWhole && subscribers.length >= KNOWN_SOURCE_CAP;
  return {
    subscribers,
    counts,
    scope: declaredWhole ? "whole_audience" : "returned_rows",
    likelyCapped,
  };
}

export interface AudiencePage {
  rows: AudienceSubscriber[];
  page: number;
  pageCount: number;
  /** Rows matching the filter within what the website returned. */
  matching: number;
}

/** Filter and page within the returned rows. Pages count every matching row. */
export function pageAudience(
  subscribers: AudienceSubscriber[],
  filter: AudienceFilter,
  page: number,
  size = AUDIENCE_PAGE_SIZE,
): AudiencePage {
  const matching = filter === "all" ? subscribers : subscribers.filter((s) => s.status === filter);
  const pageCount = Math.max(1, Math.ceil(matching.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  return {
    rows: matching.slice((p - 1) * size, p * size),
    page: p,
    pageCount,
    matching: matching.length,
  };
}

/** How a count is shown: exact, "at least", or unknown — never a silent zero. */
export function describeCount(value: number | null, scope: CountScope, capped: boolean): string {
  if (value === null) return "Unknown";
  if (scope === "whole_audience") return value.toLocaleString("en-US");
  return capped ? `${value.toLocaleString("en-US")}+` : value.toLocaleString("en-US");
}

export function scopeNote(feed: Pick<AudienceFeed, "scope" | "likelyCapped" | "subscribers">): string {
  if (feed.scope === "whole_audience") return "Counts cover the whole audience.";
  if (feed.likelyCapped)
    return `The website returned its maximum of ${KNOWN_SOURCE_CAP.toLocaleString("en-US")} people, so these counts are a floor, not the whole audience.`;
  return `Counted from the ${feed.subscribers.length.toLocaleString("en-US")} people the website returned. The website hasn't confirmed these are everyone yet.`;
}

/** Why the list could not be read, in words a person can act on. */
export type AudienceFailure =
  | "not_signed_in"
  | "not_member"
  | "not_authorized"
  | "wrong_workspace"
  | "not_configured"
  | "source_rejected"
  | "source_unavailable"
  | "source_not_published"
  | "source_error"
  | "source_shape";

export const AUDIENCE_FAILURE_TEXT: Record<AudienceFailure, string> = {
  not_signed_in: "Your session ended. Sign in again to see the audience.",
  not_member: "You're not an active member of this workspace, so the audience stays hidden.",
  not_authorized: "Only workspace owners and admins can see the newsletter audience.",
  wrong_workspace: "This workspace isn't the one the trusttai.com audience belongs to.",
  not_configured:
    "The audience connection isn't finished on the server, so nothing was read.",
  source_rejected:
    "trusttai.com refused the connection (401). The shared access code on the two sides doesn't match.",
  source_unavailable:
    "trusttai.com says its audience list isn't switched on yet (503). Nothing was read.",
  source_not_published:
    "trusttai.com doesn't have the audience feed live yet (404). It appears once the website update is published.",
  source_error: "trusttai.com couldn't be reached just now. This is not an empty list — try again shortly.",
  source_shape: "trusttai.com answered, but not in the shape Studio expects. Nothing is shown rather than a wrong list.",
};

export function failureForUpstreamStatus(status: number): AudienceFailure {
  if (status === 401 || status === 403) return "source_rejected";
  if (status === 503) return "source_unavailable";
  if (status === 404) return "source_not_published";
  return "source_error";
}
