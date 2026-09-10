/**
 * Trust Tai OS, commercial truth contracts.
 *
 * One source of truth per concept:
 *   * recurring commercial state of a company -> the canonical `clients` row
 *   * a proposal                              -> the existing prospect -> roadmap
 *                                                lineage (`roadmaps`), never a
 *                                                parallel CRM pipeline
 *   * the kind of a logged meeting            -> the canonical touch record
 *   * what a week should look like            -> `organization_weekly_targets`
 *
 * The locked law this file encodes: **one-off revenue is an event, recurring
 * revenue is state.** Nothing here derives, infers or stores a weekly number.
 */

import type { ID, ISODateTime } from "./entities";

/* --------------------------------------------------------------- client tier */

/** Where a company sits commercially. `none` means no commercial engagement. */
export type ClientTier = "diagnose" | "build" | "run" | "none";

export const CLIENT_TIERS: ClientTier[] = ["diagnose", "build", "run", "none"];

export const CLIENT_TIER_LABELS: Record<ClientTier, string> = {
  diagnose: "Diagnose",
  build: "Build",
  run: "Run",
  none: "No tier",
};

export function isClientTier(value: unknown): value is ClientTier {
  return typeof value === "string" && (CLIENT_TIERS as string[]).includes(value);
}

/**
 * Recurring commercial state, read from the canonical client record. Every
 * field is nullable: a client with nothing entered yet is honest, not broken.
 */
export interface ClientCommercialState {
  tier: ClientTier | null;
  /** Recurring monthly revenue in cents. Never a weekly number. */
  mrrCents: number | null;
  renewalAt: ISODateTime | null;
  nextReviewAt: ISODateTime | null;
  tierChangedAt: ISODateTime | null;
  /** Who last changed commercial state, using the repo's provenance pattern. */
  commercialUpdatedBy: ID | null;
  commercialUpdatedAt: ISODateTime | null;
  commercialProvenance: Record<string, unknown> | null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

/** Read commercial state off a raw `clients` row without inventing anything. */
export function readClientCommercialState(row: Record<string, unknown>): ClientCommercialState {
  const provenance = row["commercial_provenance"];
  return {
    tier: isClientTier(row["tier"]) ? row["tier"] : null,
    mrrCents: asCents(row["mrr_cents"]),
    renewalAt: asText(row["renewal_at"]),
    nextReviewAt: asText(row["next_review_at"]),
    tierChangedAt: asText(row["tier_changed_at"]),
    commercialUpdatedBy: asText(row["commercial_updated_by"]),
    commercialUpdatedAt: asText(row["commercial_updated_at"]),
    commercialProvenance:
      provenance && typeof provenance === "object" && !Array.isArray(provenance)
        ? (provenance as Record<string, unknown>)
        : null,
  };
}

/* ------------------------------------------------------------------ proposal */

export type ProposalOutcome = "open" | "signed" | "declined";

export const PROPOSAL_OUTCOMES: ProposalOutcome[] = ["open", "signed", "declined"];

export function isProposalOutcome(value: unknown): value is ProposalOutcome {
  return typeof value === "string" && (PROPOSAL_OUTCOMES as string[]).includes(value);
}

/**
 * A proposal is commercial state on the existing lineage node, the roadmap,
 * which already carries `prospect_id`, `relationship_id` and `client_id`. It
 * is not a deal object and it does not own identity.
 */
export interface ProposalCommercialState {
  proposalSentAt: ISODateTime | null;
  proposalAmountCents: number | null;
  proposalOutcome: ProposalOutcome | null;
  /** When the outcome stopped being `open`. Needed so event truth has a date. */
  proposalOutcomeAt: ISODateTime | null;
  proposalUpdatedBy: ID | null;
}

export function readProposalCommercialState(
  row: Record<string, unknown>,
): ProposalCommercialState {
  return {
    proposalSentAt: asText(row["proposal_sent_at"]),
    proposalAmountCents: asCents(row["proposal_amount_cents"]),
    proposalOutcome: isProposalOutcome(row["proposal_outcome"]) ? row["proposal_outcome"] : null,
    proposalOutcomeAt: asText(row["proposal_outcome_at"]),
    proposalUpdatedBy: asText(row["proposal_updated_by"]),
  };
}

/* -------------------------------------------------------------- meeting kind */

/**
 * What a logged meeting was. Human-set only: never inferred from a title, a
 * calendar entry, Fathom, a transcript or message content.
 */
export type MeetingKind = "discovery" | "roadmap_review" | "delivery" | "other";

export const MEETING_KINDS: MeetingKind[] = ["discovery", "roadmap_review", "delivery", "other"];

export const MEETING_KIND_LABELS: Record<MeetingKind, string> = {
  discovery: "Discovery call",
  roadmap_review: "Roadmap review",
  delivery: "Delivery",
  other: "Other",
};

export function isMeetingKind(value: unknown): value is MeetingKind {
  return typeof value === "string" && (MEETING_KINDS as string[]).includes(value);
}

/** Read a stored `meeting_kind`. Anything unrecognised reads as unset. */
export function readMeetingKind(value: unknown): MeetingKind | null {
  return isMeetingKind(value) ? value : null;
}
