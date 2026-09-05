/**
 * The Clients book, derivation only.
 *
 * Rooms run the week; Clients explains the company. Nothing here owns state:
 * every card is derived from canonical client commercial state, the proposal
 * lineage on the roadmap, and a one-line delivery projection Projects owns.
 *
 * The card hierarchy is fixed and never negotiated per screen:
 *   company -> tier and commercial value -> review or renewal -> delivery.
 *
 * Warnings are exceptions, not decoration: a review that is overdue, a renewal
 * inside thirty days with no review booked, or delivery a person recorded as
 * blocked. A normal client carries no warning at all.
 *
 * Every day shown here is a day in the organization's own timezone. A review
 * booked for the 19th is the 19th to the people who booked it, whatever the
 * server's clock says.
 */

import { localDateOf, localDaysBetween } from "./business-week";
import type { ClientTier } from "./commercial";
import type { ID, ISODateTime } from "./entities";

/** A renewal closer than this, with no review booked, is a real exception. */
export const RENEWAL_RISK_DAYS = 30;

/** A review inside this window counts as due for the headline. */
export const REVIEW_DUE_DAYS = 7;

/* ------------------------------------------------------------------- input */

export interface ClientDeliveryProjection {
  /** One line, in Projects' words. */
  line: string;
  blocked: boolean;
}

export interface ClientProposalProjection {
  amountCents: number | null;
  sentAt: ISODateTime | null;
  /** The tier being proposed, when a person recorded one. */
  tier: ClientTier | null;
  /** Only an open proposal is awaiting a decision. */
  open: boolean;
}

export interface ClientBookInput {
  id: ID;
  name: string;
  tier: ClientTier | null;
  mrrCents: number | null;
  renewalAt: ISODateTime | null;
  nextReviewAt: ISODateTime | null;
  websiteUrl?: string | null;
  logoUrl?: string | null;
  delivery?: ClientDeliveryProjection | null;
  proposal?: ClientProposalProjection | null;
}

/* -------------------------------------------------------------- formatting */

export function formatMoney(cents: number | null | undefined): string | null {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return null;
  const dollars = Math.round(cents) / 100;
  const whole = Number.isInteger(dollars);
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `Sep 19`, as a calendar day in the organization's timezone. */
export function formatDay(iso: ISODateTime | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const local = localDateOf(iso, timeZone);
  if (!local) return null;
  return `${MONTHS[local.month - 1]} ${local.day}`;
}

/** `Sep 19, 2026`, for places where the year is not obvious from context. */
export function formatDayWithYear(
  iso: ISODateTime | null | undefined,
  timeZone: string,
): string | null {
  if (!iso) return null;
  const local = localDateOf(iso, timeZone);
  if (!local) return null;
  return `${MONTHS[local.month - 1]} ${local.day}, ${local.year}`;
}

export const TIER_LABEL: Record<ClientTier, string> = {
  diagnose: "Diagnose",
  build: "Build",
  run: "Run",
  none: "No tier",
};

/* --------------------------------------------------------------- the card */

export type ClientCardKind = "active" | "proposed";

export interface ClientCard {
  id: ID;
  name: string;
  kind: ClientCardKind;
  tier: ClientTier | null;
  /** Two initials, used when no canonical image exists. Never a stock photo. */
  initials: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  /** `Run · $3,500/mo`, or the honest absence of a recorded value. */
  commercialLine: string;
  /** `Next review Sep 19`, `Renews Oct 3`, or `No review scheduled`. */
  reviewLine: string;
  /** The recorded dates themselves, so a reader never has to parse a line. */
  nextReviewAt: ISODateTime | null;
  renewalAt: ISODateTime | null;
  /** One line owned by Projects, or null when Projects said nothing. */
  deliveryLine: string | null;
  /** True exceptions only. Empty on a normal card. */
  warnings: string[];
  needsAttention: boolean;
  /** Soonest dated obligation, used by the ordering rule. */
  soonestAt: ISODateTime | null;
  /** Proposed cards only. */
  proposalLine: string | null;
  proposalNote: string | null;
}

export function initialsOfCompany(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /[a-z0-9]/i.test(word));
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : (words[0]?.[1] ?? "");
  return `${first}${second}`.toUpperCase();
}

function isProposed(input: ClientBookInput): boolean {
  const noTier = input.tier === null || input.tier === "none";
  return noTier && Boolean(input.proposal?.open);
}

function daysFrom(now: Date, iso: ISODateTime | null | undefined, timeZone: string): number | null {
  if (!iso) return null;
  return localDaysBetween(now, iso, timeZone);
}

export function deriveClientCard(input: ClientBookInput, now: Date, timeZone: string): ClientCard {
  const initials = initialsOfCompany(input.name);
  const logoUrl = input.logoUrl?.trim() ? input.logoUrl.trim() : null;
  const websiteUrl = input.websiteUrl?.trim() ? input.websiteUrl.trim() : null;

  if (isProposed(input)) {
    const amount = formatMoney(input.proposal?.amountCents ?? null);
    const tierLabel = input.proposal?.tier ? TIER_LABEL[input.proposal.tier] : null;
    const sentDaysAgo = input.proposal?.sentAt
      ? daysFrom(now, input.proposal.sentAt, timeZone)
      : null;
    const sentDays = sentDaysAgo === null ? null : Math.max(0, -sentDaysAgo);
    const line = ["Proposed", tierLabel, amount].filter(Boolean).join(" · ") || "Proposed";
    return {
      id: input.id,
      name: input.name,
      kind: "proposed",
      tier: input.tier,
      initials,
      logoUrl,
      websiteUrl,
      commercialLine: line,
      reviewLine: "Becomes a client on signature",
      deliveryLine: null,
      warnings: [],
      needsAttention: false,
      soonestAt: input.proposal?.sentAt ?? null,
      proposalLine: line,
      proposalNote:
        sentDays === null
          ? null
          : `Sent ${sentDays === 0 ? "today" : `${sentDays} day${sentDays === 1 ? "" : "s"} ago`} · your decision`,
    };
  }

  const value = formatMoney(input.mrrCents);
  const tierLabel = input.tier ? TIER_LABEL[input.tier] : "No tier";
  const commercialLine =
    input.tier === "run" && value
      ? `${tierLabel} · ${value}/mo`
      : value
        ? `${tierLabel} · ${value}`
        : `${tierLabel} · value not recorded`;

  const reviewDays = daysFrom(now, input.nextReviewAt, timeZone);
  const renewalDays = daysFrom(now, input.renewalAt, timeZone);
  // A review is overdue once its calendar day has passed in the organization's
  // zone. On the day itself it is still due, not late.
  const reviewOverdue = reviewDays !== null && reviewDays < 0;
  const reviewBooked = reviewDays !== null && reviewDays >= 0;
  const renewalAtRisk =
    renewalDays !== null && renewalDays >= 0 && renewalDays <= RENEWAL_RISK_DAYS && !reviewBooked;

  const warnings: string[] = [];
  if (reviewOverdue) {
    warnings.push(`Review overdue since ${formatDay(input.nextReviewAt, timeZone)}`);
  }
  if (renewalAtRisk) {
    warnings.push(
      renewalDays === 0
        ? "Renews today with no review booked"
        : `Renews in ${renewalDays} day${renewalDays === 1 ? "" : "s"} with no review booked`,
    );
  }
  if (input.delivery?.blocked) warnings.push("Delivery blocked");

  const reviewLine = reviewBooked
    ? `Next review ${formatDay(input.nextReviewAt, timeZone)}`
    : reviewOverdue
      ? `Review overdue since ${formatDay(input.nextReviewAt, timeZone)}`
      : input.renewalAt
        ? `Renews ${formatDay(input.renewalAt, timeZone)}`
        : "No review scheduled";

  const dated = [input.nextReviewAt, input.renewalAt]
    .map((iso) => (iso ? Date.parse(iso) : Number.NaN))
    .filter((at) => !Number.isNaN(at))
    .sort((a, b) => a - b);

  return {
    id: input.id,
    name: input.name,
    kind: "active",
    tier: input.tier,
    initials,
    logoUrl,
    websiteUrl,
    commercialLine,
    reviewLine,
    deliveryLine: input.delivery?.line ?? null,
    warnings,
    needsAttention: warnings.length > 0,
    soonestAt: dated[0] !== undefined ? new Date(dated[0]).toISOString() : null,
    proposalLine: null,
    proposalNote: null,
  };
}

/* -------------------------------------------------------------- the order */

/**
 * The ordering rule, stated once so it can be tested:
 *
 *   1. proposed companies always sit below active ones
 *   2. active cards needing attention come first
 *   3. then the soonest dated obligation
 *   4. cards with no date sit after dated ones
 *   5. ties break alphabetically, so the list never shuffles between reads
 */
export function sortClientCards(cards: ClientCard[]): ClientCard[] {
  return [...cards].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "active" ? -1 : 1;
    if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
    const at = a.soonestAt ? Date.parse(a.soonestAt) : null;
    const bt = b.soonestAt ? Date.parse(b.soonestAt) : null;
    if (at !== null && bt !== null && at !== bt) return at - bt;
    if (at !== null && bt === null) return -1;
    if (at === null && bt !== null) return 1;
    return a.name.localeCompare(b.name);
  });
}

/** The one sentence that tells a person how the grid is ordered. */
export const SORT_LABEL = "Sorted by what's soonest";

/* ------------------------------------------------------------- the totals */

/**
 * The views above the active grid. Proposed companies are not a view: they
 * are not clients yet, so they sit in their own quieter section below.
 */
export type ClientsView = "all" | "run" | "build" | "diagnose";

export const CLIENTS_VIEWS: ClientsView[] = ["all", "run", "build", "diagnose"];

export interface ClientsHeadline {
  runClients: number;
  reviewsDue: number;
  proposalsAwaiting: number;
  /** The sentence itself, so the page never assembles its own wording. */
  sentence: string;
}

export function clientsHeadline(cards: ClientCard[], now: Date, timeZone: string): ClientsHeadline {
  const active = cards.filter((card) => card.kind === "active");
  const runClients = active.filter((card) => card.tier === "run").length;
  const reviewsDue = active.filter((card) => {
    if (card.warnings.some((warning) => warning.startsWith("Review overdue"))) return true;
    if (!card.soonestAt) return false;
    const days = localDaysBetween(now, card.soonestAt, timeZone);
    return days !== null && days >= 0 && days <= REVIEW_DUE_DAYS;
  }).length;
  const proposalsAwaiting = cards.filter((card) => card.kind === "proposed").length;

  const parts = [
    `${runClients} Run client${runClients === 1 ? "" : "s"}`,
    `${reviewsDue} review${reviewsDue === 1 ? "" : "s"} due`,
    `${proposalsAwaiting} proposal${proposalsAwaiting === 1 ? "" : "s"} awaiting your decision`,
  ];

  return { runClients, reviewsDue, proposalsAwaiting, sentence: parts.join(" · ") };
}

/** Counts per view, active clients only. Proposed companies are never counted. */
export function viewCounts(cards: ClientCard[]): Record<ClientsView, number> {
  const active = cards.filter((card) => card.kind === "active");
  return {
    all: active.length,
    run: active.filter((card) => card.tier === "run").length,
    build: active.filter((card) => card.tier === "build").length,
    diagnose: active.filter((card) => card.tier === "diagnose").length,
  };
}

/** Case- and whitespace-insensitive match on the company name only. */
export function matchesClientSearch(card: ClientCard, query: string): boolean {
  const needle = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!needle) return true;
  return card.name.toLowerCase().replace(/\s+/g, " ").includes(needle);
}

/** The active grid: one view, one local search, order preserved. */
export function filterClientCards(cards: ClientCard[], view: ClientsView, query = ""): ClientCard[] {
  return cards.filter((card) => {
    if (card.kind !== "active") return false;
    if (view !== "all" && card.tier !== view) return false;
    return matchesClientSearch(card, query);
  });
}

/** The proposed section, searched by the same rule so it never disagrees. */
export function proposedCards(cards: ClientCard[], query = ""): ClientCard[] {
  return cards.filter((card) => card.kind === "proposed" && matchesClientSearch(card, query));
}

/* ------------------------------------------------------- manual creation */

export interface NewClientInput {
  name: string;
  websiteUrl?: string | null;
  logoUrl?: string | null;
  tier: ClientTier;
  mrrCents?: number | null;
  /** Required by the one-off revenue law when a client is created as Build. */
  buildPhaseAmountCents?: number | null;
  nextReviewAt?: ISODateTime | null;
  renewalAt?: ISODateTime | null;
}

function validCents(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Every reason this client cannot be saved, in the person's language. */
export function validateNewClient(input: NewClientInput): string[] {
  const problems: string[] = [];
  if (!input.name || !input.name.trim()) problems.push("A client needs a company name.");
  if (input.websiteUrl?.trim() && !validHttpUrl(input.websiteUrl.trim())) {
    problems.push("The website needs to be a full address, starting with https://.");
  }
  if (input.logoUrl?.trim() && !validHttpUrl(input.logoUrl.trim())) {
    problems.push("The logo needs to be a full image address, starting with https://.");
  }
  if (input.mrrCents !== null && input.mrrCents !== undefined && !validCents(input.mrrCents)) {
    problems.push("Monthly value must be a whole amount of zero or more.");
  }
  if (input.tier !== "run" && validCents(input.mrrCents)) {
    problems.push("Only a Run client carries a recurring monthly value.");
  }
  if (input.tier === "build" && !validCents(input.buildPhaseAmountCents)) {
    problems.push("Creating a client in Build needs the phase amount that was agreed.");
  }
  if (input.tier !== "build" && input.buildPhaseAmountCents) {
    problems.push("A phase amount belongs to a Build engagement only.");
  }
  return problems;
}
