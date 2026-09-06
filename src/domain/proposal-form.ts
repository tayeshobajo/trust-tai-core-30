/**
 * The human path into proposal truth.
 *
 * A proposal is commercial truth, not inferred truth. This file turns what a
 * person typed into an instruction for the existing roadmap lineage node, or
 * refuses it in words a person can act on. It invents nothing: no amount is
 * suggested, no date is defaulted to today behind a person's back, and an
 * answer that has already been recorded is never quietly rewritten.
 *
 * No agent, model, document or message reaches these functions.
 */

import { readMoneyCents } from "./client-commercial-form";
import type { ProposalOutcome } from "./commercial";

/** What the sending form holds, all as typed text. */
export interface ProposalSentFormInput {
  /** Amount in whole currency units, as typed. */
  amount: string;
  /** `YYYY-MM-DD`, the day the proposal actually went out. */
  sentOn: string;
}

/** The proposal state already recorded on this lineage node. */
export interface ProposalFormCurrent {
  sentAt: string | null;
  amountCents: number | null;
  outcome: ProposalOutcome | null;
  /** The day the answer actually happened, never the moment a button was pressed. */
  outcomeAt: string | null;
}

export interface ProposalSentIntent {
  amountCents: number;
  sentAt: string;
}

/** What a person said about the answer: which answer, and the day it happened. */
export interface ProposalOutcomeIntent {
  outcome: "signed" | "declined";
  at: string;
}

export type ProposalSentResult =
  { ok: true; intent: ProposalSentIntent } | { ok: false; because: string };

export type ProposalOutcomeResult =
  { ok: true; intent: ProposalOutcomeIntent } | { ok: false; because: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A proposal that has already been answered is closed to further sending. */
export function answered(current: ProposalFormCurrent): boolean {
  return current.outcome === "signed" || current.outcome === "declined";
}

/**
 * Read the sending form. Midday UTC keeps a stated day the same day in every
 * reasonable timezone, so a proposal sent on the 6th is never read as the 5th.
 */
export function readProposalSentForm(
  input: ProposalSentFormInput,
  current: ProposalFormCurrent,
): ProposalSentResult {
  if (answered(current)) {
    return {
      ok: false,
      because: `That proposal was already recorded as ${current.outcome}. Recording it as sent again would erase the answer.`,
    };
  }

  const money = readMoneyCents(input.amount);
  if (!money.ok || money.cents === null) {
    return {
      ok: false,
      because: "A sent proposal needs the amount a person actually put in it, like 3500.",
    };
  }
  if (money.cents <= 0) {
    return { ok: false, because: "A proposal for nothing is not a proposal. Enter the amount." };
  }

  const day = input.sentOn.trim();
  if (!DAY.test(day) || Number.isNaN(new Date(`${day}T00:00:00Z`).getTime())) {
    return { ok: false, because: "Say the day this proposal actually went out." };
  }

  return { ok: true, intent: { amountCents: money.cents, sentAt: `${day}T12:00:00.000Z` } };
}

/**
 * Why an answer cannot be recorded, or null when it can. Reasons are the same
 * ones the service enforces, said before a person presses anything.
 */
export function proposalOutcomeRefusal(
  current: ProposalFormCurrent,
  outcome: ProposalOutcome,
): string | null {
  if (!current.sentAt) return "A proposal has to have been sent before it can be answered.";
  if (current.outcome === outcome) return null;
  if (answered(current)) {
    return `That proposal was already recorded as ${current.outcome}. Changing a recorded answer is not something this system does on its own.`;
  }
  if (outcome !== "signed" && outcome !== "declined") {
    return "A proposal is answered as signed or declined.";
  }
  return null;
}

/**
 * Read the answering form. The day a proposal was signed or declined decides
 * which week the revenue belongs to, so it is asked for and never defaulted to
 * the moment somebody pressed a button.
 */
export function readProposalOutcomeForm(
  input: { answeredOn: string },
  current: ProposalFormCurrent,
  outcome: "signed" | "declined",
): ProposalOutcomeResult {
  const because = proposalOutcomeRefusal(current, outcome);
  if (because) return { ok: false, because };

  const day = input.answeredOn.trim();
  if (!DAY.test(day) || Number.isNaN(new Date(`${day}T00:00:00Z`).getTime())) {
    return { ok: false, because: "Say the day this proposal was actually answered." };
  }

  return { ok: true, intent: { outcome, at: `${day}T12:00:00.000Z` } };
}
