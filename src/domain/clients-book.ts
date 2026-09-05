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
 */

import type { ClientTier } from "./commercial";
import type { ID, ISODateTime } from "./entities";

const DAY = 86_400_000;

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

export function formatDay(iso: ISODateTime | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}`;
}

function daysBetween(from: number, to: number): number {
  return Math.floor((to - from) / DAY);
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
  /** `Run · $3,500/mo`, or the honest absence of a recorded value. */
  commercialLine: string;
  /** `Next review Sep 19`, `Renews Oct 3`, or `No review scheduled`. */
  reviewLine: string;
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

export function deriveClientCard(input: ClientBookInput, now: Date): ClientCard {
  const at = now.getTime();
  const initials = initialsOfCompany(input.name);
  const logoUrl = input.logoUrl?.trim() ? input.logoUrl.trim() : null;

  if (isProposed(input)) {
    const amount = formatMoney(input.proposal?.amountCents ?? null);
    const tierLabel = input.proposal?.tier ? TIER_LABEL[input.proposal.tier] : null;
    const sentDays = input.proposal?.sentAt
      ? daysBetween(new Date(input.proposal.sentAt).getTime(), at)
      : null;
    return {
      id: input.id,
      name: input.name,
      kind: "proposed",
      tier: input.tier,
      initials,
      logoUrl,
      commercialLine: ["Proposed", tierLabel, amount].filter(Boolean).join(" · ") || "Proposed",
      reviewLine: "Becomes a client on signature",
      deliveryLine: null,
      warnings: [],
      needsAttention: false,
      soonestAt: input.proposal?.sentAt ?? null,
      proposalLine: ["Proposed", tierLabel, amount].filter(Boolean).join(" · ") || "Proposed",
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

  const reviewAt = input.nextReviewAt ? new Date(input.nextReviewAt).getTime() : null;
  const renewalAt = input.renewalAt ? new Date(input.renewalAt).getTime() : null;
  const reviewOverdue = reviewAt !== null && reviewAt < at;
  const reviewBooked = reviewAt !== null && reviewAt >= at;
  const renewalDays = renewalAt === null ? null : daysBetween(at, renewalAt);
  const renewalAtRisk =
    renewalDays !== null && renewalDays >= 0 && renewalDays <= RENEWAL_RISK_DAYS && !reviewBooked;

  const warnings: string[] = [];
  if (reviewOverdue) warnings.push(`Review overdue since ${formatDay(input.nextReviewAt)}`);
  if (renewalAtRisk) warnings.push(`Renews in ${renewalDays} days with no review booked`);
  if (input.delivery?.blocked) warnings.push("Delivery blocked");

  const reviewLine = reviewBooked
    ? `Next review ${formatDay(input.nextReviewAt)}`
    : reviewOverdue
      ? `Review overdue since ${formatDay(input.nextReviewAt)}`
      : renewalAt !== null
        ? `Renews ${formatDay(input.renewalAt)}`
        : "No review scheduled";

  const soonest = [reviewAt, renewalAt].filter((value): value is number => value !== null).sort();

  return {
    id: input.id,
    name: input.name,
    kind: "active",
    tier: input.tier,
    initials,
    logoUrl,
    commercialLine,
    reviewLine,
    deliveryLine: input.delivery?.line ?? null,
    warnings,
    needsAttention: warnings.length > 0,
    soonestAt: soonest[0] !== undefined ? new Date(soonest[0]).toISOString() : null,
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

/* ------------------------------------------------------------- the totals */

export type ClientsView = "all" | "run" | "build" | "diagnose" | "proposed";

export interface ClientsHeadline {
  runClients: number;
  reviewsDue: number;
  proposalsAwaiting: number;
  /** The sentence itself, so the page never assembles its own wording. */
  sentence: string;
}

export function clientsHeadline(cards: ClientCard[], now: Date): ClientsHeadline {
  const at = now.getTime();
  const active = cards.filter((card) => card.kind === "active");
  const runClients = active.filter((card) => card.tier === "run").length;
  const reviewsDue = active.filter((card) => {
    if (card.warnings.some((warning) => warning.startsWith("Review overdue"))) return true;
    if (!card.soonestAt) return false;
    const days = daysBetween(at, Date.parse(card.soonestAt));
    return days >= 0 && days <= REVIEW_DUE_DAYS;
  }).length;
  const proposalsAwaiting = cards.filter((card) => card.kind === "proposed").length;

  const parts = [
    `${runClients} Run client${runClients === 1 ? "" : "s"}`,
    `${reviewsDue} review${reviewsDue === 1 ? "" : "s"} due`,
    `${proposalsAwaiting} proposal${proposalsAwaiting === 1 ? "" : "s"} awaiting your decision`,
  ];

  return { runClients, reviewsDue, proposalsAwaiting, sentence: parts.join(" · ") };
}

/** Counts per view. Proposed companies are never counted as active clients. */
export function viewCounts(cards: ClientCard[]): Record<ClientsView, number> {
  const active = cards.filter((card) => card.kind === "active");
  return {
    all: active.length,
    run: active.filter((card) => card.tier === "run").length,
    build: active.filter((card) => card.tier === "build").length,
    diagnose: active.filter((card) => card.tier === "diagnose").length,
    proposed: cards.filter((card) => card.kind === "proposed").length,
  };
}

export function filterClientCards(cards: ClientCard[], view: ClientsView): ClientCard[] {
  if (view === "all") return cards;
  if (view === "proposed") return cards.filter((card) => card.kind === "proposed");
  return cards.filter((card) => card.kind === "active" && card.tier === view);
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

/** Every reason this client cannot be saved, in the person's language. */
export function validateNewClient(input: NewClientInput): string[] {
  const problems: string[] = [];
  if (!input.name || !input.name.trim()) problems.push("A client needs a company name.");
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
