/**
 * The human path into commercial truth.
 *
 * This file turns what a person typed into a patch for the canonical client
 * row, or refuses it. It invents nothing: a field left blank is left alone,
 * money is only ever what a person typed, and a reason is always required so
 * every commercial fact carries provenance a human can read later.
 *
 * No agent, model, document or message ever reaches this function.
 */

import { isClientTier, type ClientTier } from "./commercial";

/** The smallest reason we accept. Short enough to be quick, long enough to mean something. */
export const MIN_COMMERCIAL_REASON = 4;

/** Exactly what the form holds, all as typed text. */
export interface CommercialFormInput {
  tier: string;
  /** Monthly recurring amount in whole currency units, as typed. Blank clears. */
  mrr: string;
  /** `YYYY-MM-DD`, as typed. Blank clears. */
  renewalAt: string;
  nextReviewAt: string;
  /** Only meaningful when the tier is moving into Build. */
  buildPhaseAmount: string;
  because: string;
}

/** Current stored state, used to decide what actually changed. */
export interface CommercialFormCurrent {
  tier: ClientTier | null;
  mrrCents: number | null;
  renewalAt: string | null;
  nextReviewAt: string | null;
}

export interface CommercialFormPatch {
  tier?: ClientTier;
  mrrCents?: number | null;
  renewalAt?: string | null;
  nextReviewAt?: string | null;
  buildPhaseAmountCents?: number | null;
  because: string;
}

export type CommercialFormResult =
  | { ok: true; patch: CommercialFormPatch; tierChanged: boolean }
  | { ok: false; because: string };

/** A day as typed, kept as a plain date so a timezone can never shift it. */
function readDay(value: string): { ok: true; day: string | null } | { ok: false } {
  const text = value.trim();
  if (!text) return { ok: true, day: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: false };
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return { ok: false };
  return { ok: true, day: text };
}

/** Money as a person types it, turned into cents. Never rounded away silently. */
export function readMoneyCents(value: string): { ok: true; cents: number | null } | { ok: false } {
  const text = value.trim().replace(/[,\s]/g, "").replace(/^[$£€]/, "");
  if (!text) return { ok: true, cents: null };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false };
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false };
  return { ok: true, cents: Math.round(amount * 100) };
}

function sameDay(entered: string | null, stored: string | null): boolean {
  const storedDay = stored ? stored.slice(0, 10) : null;
  return entered === storedDay;
}

/**
 * Read the form. Only fields a person genuinely changed become part of the
 * patch, so saving one fact never quietly rewrites another.
 */
export function readCommercialForm(
  input: CommercialFormInput,
  current: CommercialFormCurrent,
): CommercialFormResult {
  const because = input.because.trim();
  if (because.length < MIN_COMMERCIAL_REASON) {
    return {
      ok: false,
      because: "Say why this commercial state is true, so the record keeps the reason.",
    };
  }

  if (!isClientTier(input.tier)) {
    return { ok: false, because: "Choose the tier this company is actually on." };
  }
  const tier = input.tier;

  const mrr = readMoneyCents(input.mrr);
  if (!mrr.ok) {
    return { ok: false, because: "Enter the monthly recurring amount as a number, like 3500." };
  }

  const renewal = readDay(input.renewalAt);
  if (!renewal.ok) return { ok: false, because: "Enter the renewal date as a real day." };
  const review = readDay(input.nextReviewAt);
  if (!review.ok) return { ok: false, because: "Enter the next review date as a real day." };

  const tierChanged = tier !== current.tier;
  const patch: CommercialFormPatch = { because };
  if (tierChanged) patch.tier = tier;
  if (mrr.cents !== current.mrrCents) patch.mrrCents = mrr.cents;
  if (!sameDay(renewal.day, current.renewalAt)) patch.renewalAt = renewal.day;
  if (!sameDay(review.day, current.nextReviewAt)) patch.nextReviewAt = review.day;

  if (tierChanged && tier === "build") {
    const phase = readMoneyCents(input.buildPhaseAmount);
    if (!phase.ok || phase.cents === null) {
      return {
        ok: false,
        because: "Moving this company into Build needs the phase amount a person actually agreed.",
      };
    }
    patch.buildPhaseAmountCents = phase.cents;
  }

  const changedFacts = Object.keys(patch).filter((key) => key !== "because");
  if (changedFacts.length === 0) {
    return { ok: false, because: "Nothing changed, so nothing was recorded." };
  }

  return { ok: true, patch, tierChanged };
}

/** Fill the form from what is stored, never from a guess. */
export function commercialFormFrom(current: CommercialFormCurrent): CommercialFormInput {
  return {
    tier: current.tier ?? "none",
    mrr: current.mrrCents === null ? "" : (current.mrrCents / 100).toFixed(2).replace(/\.00$/, ""),
    renewalAt: current.renewalAt ? current.renewalAt.slice(0, 10) : "",
    nextReviewAt: current.nextReviewAt ? current.nextReviewAt.slice(0, 10) : "",
    buildPhaseAmount: "",
    because: "",
  };
}
