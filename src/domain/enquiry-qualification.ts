/**
 * An enquiry becomes a judged opportunity.
 *
 * The Website room owns the submission. Scout owns the prospect. This module
 * owns neither: it is the pure contract between them, the qualification packet
 * a person reads, and the single decision a named person takes on it.
 *
 * Three rules run through everything here:
 *
 * 1. Nothing is duplicated on a retry. The website's own submission id is the
 *    key, and identity is resolved by evidence or left for a person.
 * 2. What was read, what was concluded and what is not known stay separate,
 *    and an unknown is never a zero, a budget or an intent.
 * 3. Fit is explainable and editable. It is a reason a person can disagree
 *    with, never a confidence number used as decoration.
 */

import type { ID, ISODateTime } from "./entities";
import { matchProspect, type MatchCandidate } from "./website-matching";
import type { CandidateSourceKind } from "./scout";
import type { WebsiteSubmission } from "./website";

/* --------------------------------------------------------------- intake */

/** Sources an enquiry may legitimately arrive from today. */
export const SUPPORTED_ENQUIRY_SOURCES: CandidateSourceKind[] = ["website_intake", "live_website"];

export interface EnquiryContext {
  /** The website's own id. Repeating it never creates a second enquiry. */
  submissionId: string;
  organizationId: ID;
  sourceApp: string;
  sourceChannel: string;
  sourceKind: CandidateSourceKind;
  submittedAt: ISODateTime;
  receivedAt: ISODateTime;
  /** Carried exactly as captured. Never inferred, never defaulted to true. */
  consent: { marketingOptIn: boolean | null; privacyVersion: string | null };
  attribution: Record<string, string | null>;
}

export type EnquiryLink =
  | { state: "linked"; prospectId: ID; because: string }
  | { state: "create"; name: string; websiteUrl: string; because: string }
  | { state: "unlinked"; because: string }
  | { state: "duplicate"; prospectId?: ID; because: string };

export interface EnquiryIntake {
  key: string;
  context: EnquiryContext;
  link: EnquiryLink;
  /** True when this source is not one we can honestly work from. */
  unavailable: boolean;
  unavailableBecause?: string;
}

/** One enquiry per organization and submission, however many times it arrives. */
export function enquiryKey(organizationId: ID, submissionId: string): string {
  return `${organizationId}::enquiry::${submissionId}`;
}

export function enquiryContext(submission: WebsiteSubmission): EnquiryContext {
  return {
    submissionId: submission.submissionId,
    organizationId: submission.organizationId,
    sourceApp: submission.sourceApp,
    sourceChannel: submission.sourceChannel,
    sourceKind: "website_intake",
    submittedAt: submission.submittedAt,
    receivedAt: submission.receivedAt,
    consent: {
      marketingOptIn: submission.consent.marketingOptIn ?? null,
      privacyVersion: submission.consent.privacyVersion ?? null,
    },
    attribution: {
      source: submission.attribution.utm?.source ?? null,
      medium: submission.attribution.utm?.medium ?? null,
      campaign: submission.attribution.utm?.campaign ?? null,
      referrer: submission.attribution.entryReferrer ?? null,
    },
  };
}

/**
 * Take an enquiry in. A repeat of one already taken in returns the same
 * enquiry with its existing link, so a retry writes nothing new.
 */
export function receiveEnquiry(input: {
  submission: WebsiteSubmission;
  candidates: MatchCandidate[];
  /** Enquiry keys already recorded, with the prospect they landed on. */
  alreadyReceived?: { key: string; prospectId?: ID }[];
}): EnquiryIntake {
  const context = enquiryContext(input.submission);
  const key = enquiryKey(context.organizationId, context.submissionId);

  const seen = (input.alreadyReceived ?? []).find((entry) => entry.key === key);
  if (seen) {
    return {
      key,
      context,
      link: {
        state: "duplicate",
        ...(seen.prospectId ? { prospectId: seen.prospectId } : {}),
        because: "This enquiry was already taken in. Nothing new was created.",
      },
      unavailable: false,
    };
  }

  if (!SUPPORTED_ENQUIRY_SOURCES.includes(context.sourceKind)) {
    return {
      key,
      context,
      link: { state: "unlinked", because: "This source is not connected." },
      unavailable: true,
      unavailableBecause: `Enquiries from ${context.sourceChannel} are not available yet.`,
    };
  }

  const outcome = matchProspect(
    {
      companyName: input.submission.company.name ?? null,
      companyWebsite: input.submission.company.website ?? null,
      personEmail: input.submission.person.email ?? null,
    },
    input.candidates,
  );

  if (outcome.kind === "matched") {
    return {
      key,
      context,
      link: { state: "linked", prospectId: outcome.prospectId, because: outcome.because },
      unavailable: false,
    };
  }
  if (outcome.kind === "create") {
    return {
      key,
      context,
      link: { state: "create", name: outcome.name, websiteUrl: outcome.websiteUrl, because: outcome.because },
      unavailable: false,
    };
  }
  return {
    key,
    context,
    link: {
      state: "unlinked",
      because: `${outcome.because} Kept as an enquiry for a person to place.`,
    },
    unavailable: false,
  };
}

/* ------------------------------------------------- the qualification packet */

export interface PacketEvidence {
  label: string;
  /** A real page, when the claim was read from one. */
  url?: string;
  /** When it was observed. Absent means we do not know, never today. */
  observedAt?: ISODateTime;
}

/** Something read. Never a conclusion. */
export interface PacketFact {
  statement: string;
  evidence: PacketEvidence[];
}

/** Something concluded from the facts, marked as such and always challengeable. */
export interface PacketInference {
  statement: string;
  because: string;
  restsOn: string[];
}

export interface FitRationale {
  /** Which ICP this was judged against. No ICP means no fit claim. */
  icpVersion: number | null;
  icpTitle: string | null;
  /** Each line pairs an ICP criterion with what was actually found. */
  lines: { criterion: string; found: string; state: "met" | "partial" | "unknown" | "mismatch" }[];
  /** Plain sentence a person can disagree with and rewrite. */
  summary: string;
  /** True once a person edited it. The machine never overwrites an edited read. */
  editedByPerson: boolean;
}

export interface QualificationPacket {
  enquiryKey: string;
  companyLabel: string;
  facts: PacketFact[];
  inferences: PacketInference[];
  /** Named gaps. Each is a question, never a zero. */
  unknowns: string[];
  /** What they said they need, quoted from their own words where possible. */
  businessNeed: { statement: string; quoted: boolean } | null;
  fit: FitRationale | null;
  /** One suggested opening move. A suggestion, nothing more. */
  suggestedFirstMove: string | null;
  preparedAt: ISODateTime;
}

const INVENTED_TERMS = [
  "budget",
  "spend",
  "contract value",
  "deal size",
  "ready to buy",
  "intent score",
  "will sign",
  "guaranteed",
];

/**
 * Keep invented commercial intent out of the packet.
 *
 * A claim about budget, spend or intent to buy is only allowed when it is
 * quoted from what they actually said. Anything else is dropped and named as
 * an unknown instead, so nobody reads a guess as a commitment.
 */
export function stripInventedIntent(packet: QualificationPacket, saidByThem: string[]): QualificationPacket {
  const said = saidByThem.map((entry) => entry.toLowerCase());
  const supported = (statement: string) => {
    const lower = statement.toLowerCase();
    const risky = INVENTED_TERMS.find((term) => lower.includes(term));
    if (!risky) return true;
    return said.some((entry) => entry.includes(risky));
  };

  const removed: string[] = [];
  const facts = packet.facts.filter((fact) => {
    if (supported(fact.statement)) return true;
    removed.push("What they can spend is not known.");
    return false;
  });
  const inferences = packet.inferences.filter((inference) => {
    if (supported(inference.statement)) return true;
    removed.push("Whether they intend to buy is not known.");
    return false;
  });

  return {
    ...packet,
    facts,
    inferences,
    unknowns: [...new Set([...packet.unknowns, ...removed])],
  };
}

/** A packet is only worth reading when something in it was actually read. */
export function packetReadiness(packet: QualificationPacket): { ready: boolean; because: string } {
  if (packet.facts.length === 0) {
    return { ready: false, because: "Nothing was read about this company yet." };
  }
  if (!packet.fit) {
    return {
      ready: false,
      because: "There is no ICP to judge this against, so no fit is claimed.",
    };
  }
  return { ready: true, because: "Prepared for a person to judge." };
}

/* ------------------------------------------------------------- the decision */

export type QualificationOutcome = "qualified" | "passed" | "deferred";

export interface QualificationDecision {
  enquiryKey: string;
  outcome: QualificationOutcome;
  /** A named person. Never a service, never a job. */
  decidedBy: ID;
  decidedByLabel: string;
  decidedAt: ISODateTime;
  because: string;
  /** Present for a deferral, so it comes back for a reason. */
  reviewAgainBecause?: string;
}

export interface CommsPreparationRequest {
  /** One per enquiry. A repeated qualification updates it, never doubles it. */
  key: string;
  enquiryKey: string;
  prospectId?: ID;
  companyLabel: string;
  ownerUserId: ID;
  ownerLabel: string;
  /** Carried by reference and quotation, never re-typed as new claims. */
  context: { label: string; value: string; tier: "fact" | "inference" | "decision" }[];
  unknowns: string[];
  suggestedFirstMove: string | null;
  becauseQualified: string;
}

export type HandoffAttempt =
  | { created: true; request: CommsPreparationRequest }
  | { created: false; because: string };

/**
 * A qualified enquiry opens exactly one Comms preparation, with the context
 * already gathered and a named owner. A pass or a deferral opens nothing.
 */
export function commsPreparationFor(input: {
  intake: EnquiryIntake;
  packet: QualificationPacket;
  decision: QualificationDecision;
  owner: { userId: ID; label: string };
  /** Keys of preparations already opened for this enquiry. */
  existingKeys?: string[];
}): HandoffAttempt {
  if (input.decision.outcome !== "qualified") {
    return { created: false, because: "Only a qualified enquiry opens a conversation." };
  }
  if (input.intake.unavailable) {
    return { created: false, because: input.intake.unavailableBecause ?? "This source is not available." };
  }
  if (input.intake.link.state === "unlinked") {
    return {
      created: false,
      because: "Place this enquiry against a company first. Two companies cannot be merged on a guess.",
    };
  }
  const key = `${input.intake.key}::comms`;
  if ((input.existingKeys ?? []).includes(key)) {
    return { created: false, because: "A conversation is already being prepared for this enquiry." };
  }
  if (!input.owner.userId.trim()) {
    return { created: false, because: "Name who will own the conversation first." };
  }

  const prospectId =
    input.intake.link.state === "linked" || input.intake.link.state === "duplicate"
      ? input.intake.link.prospectId
      : undefined;

  const context: CommsPreparationRequest["context"] = [
    ...input.packet.facts.map((fact) => ({
      label: "Read",
      value: fact.statement,
      tier: "fact" as const,
    })),
    ...input.packet.inferences.map((inference) => ({
      label: "Our read",
      value: inference.statement,
      tier: "inference" as const,
    })),
    {
      label: "Decision",
      value: `${input.decision.decidedByLabel} qualified this: ${input.decision.because}`,
      tier: "decision" as const,
    },
    ...(input.packet.businessNeed
      ? [
          {
            label: input.packet.businessNeed.quoted ? "In their words" : "What they need",
            value: input.packet.businessNeed.statement,
            tier: "fact" as const,
          },
        ]
      : []),
  ];

  return {
    created: true,
    request: {
      key,
      enquiryKey: input.intake.key,
      ...(prospectId ? { prospectId } : {}),
      companyLabel: input.packet.companyLabel,
      ownerUserId: input.owner.userId,
      ownerLabel: input.owner.label,
      context,
      unknowns: input.packet.unknowns,
      suggestedFirstMove: input.packet.suggestedFirstMove,
      becauseQualified: input.decision.because,
    },
  };
}
