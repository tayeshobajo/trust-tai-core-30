/**
 * Where an agreement stands, and where the money stands. Two separate things.
 *
 * Clients is the account-facing commercial view. This module holds the honest
 * reading behind it. It does not replace any finance or contract system: it
 * records what those systems say, or what a named person attested, and refuses
 * to fill the gap in between.
 *
 * Three rules:
 *
 * 1. Signed and paid are people's words, never ours. AI can prepare and
 *    suggest; it can never move an agreement to accepted or money to paid.
 * 2. Every state past "approved" needs either a reference in a real system or
 *    a named person saying so, with the time they said it.
 * 3. When we cannot read the finance system, that reads as unavailable. It
 *    never reads as paid, and it never reads as unpaid either.
 */

import type { ID, ISODateTime } from "./entities";

export type AgreementStage =
  | "proposed"
  | "approved"
  | "sent"
  | "client_accepted"
  | "declined";

export const AGREEMENT_STAGE_LABEL: Record<AgreementStage, string> = {
  proposed: "Proposed",
  approved: "Approved internally",
  sent: "Sent to the client",
  client_accepted: "Accepted by the client",
  declined: "Declined",
};

export type PaymentStage = "unpaid" | "invoiced" | "paid" | "unknown";

export const PAYMENT_STAGE_LABEL: Record<PaymentStage, string> = {
  unpaid: "Not invoiced yet",
  invoiced: "Invoiced",
  paid: "Paid",
  unknown: "Payment status unavailable",
};

/** Who is moving the state. Preparation is never a person. */
export type ActorKind = "person" | "preparation";

export type StateEvidence =
  | {
      kind: "reference";
      /** The system that holds the truth, for example the invoicing tool. */
      system: string;
      reference: string;
      observedAt: ISODateTime;
    }
  | {
      kind: "human_attested";
      by: ID;
      at: ISODateTime;
      note: string;
    };

export interface AgreementRecord {
  clientRef: string;
  stage: AgreementStage;
  evidence: StateEvidence | null;
  changedBy: ID | null;
  changedAt: ISODateTime | null;
}

export type StateChange<T> =
  | { changed: true; record: T }
  | { changed: false; because: string };

/** Stages that cannot be claimed without evidence behind them. */
const NEEDS_EVIDENCE: AgreementStage[] = ["sent", "client_accepted", "declined"];

/** Stages only a person can set. Preparation is refused outright. */
const PERSON_ONLY: AgreementStage[] = ["approved", "sent", "client_accepted", "declined"];

export function setAgreementStage(input: {
  record: AgreementRecord;
  stage: AgreementStage;
  actorKind: ActorKind;
  by: ID;
  at: ISODateTime;
  evidence?: StateEvidence;
}): StateChange<AgreementRecord> {
  if (input.actorKind !== "person" && PERSON_ONLY.includes(input.stage)) {
    return {
      changed: false,
      because: `Only a person can mark an agreement ${AGREEMENT_STAGE_LABEL[input.stage].toLowerCase()}.`,
    };
  }
  if (!input.by.trim()) {
    return { changed: false, because: "Say who is making this change." };
  }
  if (NEEDS_EVIDENCE.includes(input.stage) && !input.evidence) {
    return {
      changed: false,
      because: `Record a reference or say who confirmed it before marking this ${AGREEMENT_STAGE_LABEL[input.stage].toLowerCase()}.`,
    };
  }
  return {
    changed: true,
    record: {
      ...input.record,
      stage: input.stage,
      evidence: input.evidence ?? null,
      changedBy: input.by,
      changedAt: input.at,
    },
  };
}

/* ------------------------------------------------------------- the money */

export interface PaymentRecord {
  clientRef: string;
  stage: PaymentStage;
  evidence: StateEvidence | null;
  changedBy: ID | null;
  changedAt: ISODateTime | null;
}

export function setPaymentStage(input: {
  record: PaymentRecord;
  stage: PaymentStage;
  actorKind: ActorKind;
  by: ID;
  at: ISODateTime;
  evidence?: StateEvidence;
}): StateChange<PaymentRecord> {
  if (input.actorKind !== "person" && input.stage !== "unknown") {
    return { changed: false, because: "Only a person can change where the money stands." };
  }
  if (input.stage !== "unknown" && input.stage !== "unpaid" && !input.evidence) {
    return {
      changed: false,
      because: "Record the invoice or payment reference, or say who confirmed it.",
    };
  }
  return {
    changed: true,
    record: {
      ...input.record,
      stage: input.stage,
      evidence: input.evidence ?? null,
      changedBy: input.by,
      changedAt: input.at,
    },
  };
}

export interface ExternalRead {
  ok: boolean;
  /** Why the finance system could not be read, when it could not. */
  because?: string;
  readAt: ISODateTime;
}

export interface PaymentView {
  stage: PaymentStage;
  label: string;
  /** Plain words about where this reading came from. */
  basis: string;
}

/**
 * What the account view should show. A failed read is unavailable, never paid
 * and never quietly unpaid.
 */
export function paymentView(input: {
  record: PaymentRecord;
  externalRead?: ExternalRead;
}): PaymentView {
  if (input.externalRead && !input.externalRead.ok) {
    return {
      stage: "unknown",
      label: PAYMENT_STAGE_LABEL.unknown,
      basis: `Could not read the finance system${input.externalRead.because ? `: ${input.externalRead.because}` : "."}`,
    };
  }
  const evidence = input.record.evidence;
  const basis = !evidence
    ? "Nothing recorded yet."
    : evidence.kind === "reference"
      ? `From ${evidence.system}, reference ${evidence.reference}, read ${evidence.observedAt}.`
      : `Confirmed by ${evidence.by} on ${evidence.at}. ${evidence.note}`;
  return { stage: input.record.stage, label: PAYMENT_STAGE_LABEL[input.record.stage], basis };
}

/* ------------------------------------------------ value, cost and margin */

export interface CommercialFigures {
  currency: string | null;
  /** Our estimate, in minor units. Null means not estimated. */
  estimateMinor: number | null;
  /** What was agreed, in minor units. Null means nothing agreed yet. */
  agreedMinor: number | null;
  /** Recorded cost, in minor units. Null means not known. */
  costMinor: number | null;
}

export interface MarginRead {
  varianceMinor: number | null;
  marginMinor: number | null;
  marginNote: string;
  unknowns: string[];
}

/** Unknown effort or cost is never nought, and never counted as profit. */
export function marginRead(figures: CommercialFigures): MarginRead {
  const unknowns: string[] = [];
  if (figures.estimateMinor === null) unknowns.push("No estimate recorded.");
  if (figures.agreedMinor === null) unknowns.push("Nothing agreed yet.");
  if (figures.costMinor === null) unknowns.push("No cost recorded.");

  const varianceMinor =
    figures.estimateMinor === null || figures.agreedMinor === null
      ? null
      : figures.agreedMinor - figures.estimateMinor;

  const marginMinor =
    figures.agreedMinor === null || figures.costMinor === null
      ? null
      : figures.agreedMinor - figures.costMinor;

  const marginNote =
    marginMinor === null
      ? "Margin cannot be worked out yet. Missing figures are not nought."
      : "Margin is the agreed value less the recorded cost.";

  return { varianceMinor, marginMinor, marginNote, unknowns };
}
