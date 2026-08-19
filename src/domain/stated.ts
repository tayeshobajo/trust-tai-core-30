/**
 * Trust Tai OS, the `stated` lane.
 *
 * Scout already separates what it observed, what it inferred, and what it
 * suggests. An inbound company brings a fourth kind of truth that none of
 * those describe: what the founder said about themselves.
 *
 * Stated truth is not evidence and it is not inference. It is testimony. It
 * is never scored, never treated as verified, and never rewritten — but it is
 * usually the most useful thing on the page, so it gets its own lane.
 */

import type { ID, ISODateTime } from "./entities";
import type { WebsiteModality, WebsiteStructured, WebsiteSubmission } from "./website";

/** The parts of a founder's own account, in the order a person reads them. */
export type StatedLane =
  | "current_state"
  | "desired_future"
  | "pains"
  | "goals"
  | "constraints"
  | "existing_assets"
  | "ideas"
  | "open_questions";

export const STATED_LANE_LABEL: Record<StatedLane, string> = {
  current_state: "Point A, as they describe it",
  desired_future: "Point B, as they describe it",
  pains: "What is costing them",
  goals: "What they are trying to reach",
  constraints: "What limits them",
  existing_assets: "What they already have",
  ideas: "What they have considered",
  open_questions: "What they are unsure about",
};

export const STATED_LANE_ORDER: StatedLane[] = [
  "current_state",
  "desired_future",
  "pains",
  "goals",
  "constraints",
  "existing_assets",
  "ideas",
  "open_questions",
];

/** One thing a person said, kept exactly as they said it. */
export interface StatedClaim {
  lane: StatedLane;
  statement: string;
}

/**
 * Everything one submission stated about a company. Stored on the prospect so
 * Scout can read testimony without reaching into the Website room.
 */
export interface FounderSignalPacket {
  submissionId: string;
  submissionRowId?: ID | null;
  statedAt: ISODateTime;
  claims: StatedClaim[];
  /** The conversation itself, so a claim can always be traced to a sentence. */
  transcript: {
    questionText: string;
    answerText: string;
    modality: WebsiteModality;
    skipped: boolean;
  }[];
  /** What the website's own extraction believed about the conversation. */
  understanding: {
    frame?: string | null;
    frameConfidence?: number | null;
    objectiveCoverage?: number | null;
    completeness?: number | null;
    /** The founder's explicit permission for us to research them. */
    authorizesResearch?: boolean | null;
  };
  attribution: {
    landingPath?: string | null;
    utmSource?: string | null;
    utmCampaign?: string | null;
  };
}

const LANES: { lane: StatedLane; key: keyof WebsiteStructured }[] = [
  { lane: "current_state", key: "currentState" },
  { lane: "desired_future", key: "desiredFuture" },
  { lane: "pains", key: "pains" },
  { lane: "goals", key: "goals" },
  { lane: "constraints", key: "constraints" },
  { lane: "existing_assets", key: "existingAssets" },
  { lane: "ideas", key: "ideas" },
  { lane: "open_questions", key: "openQuestions" },
];

export function claimsFromStructured(structured: WebsiteStructured): StatedClaim[] {
  const claims: StatedClaim[] = [];
  for (const { lane, key } of LANES) {
    for (const statement of structured[key]) {
      const text = statement.trim();
      if (text) claims.push({ lane, statement: text });
    }
  }
  return claims;
}

export function claimsInLane(packet: FounderSignalPacket, lane: StatedLane): string[] {
  return packet.claims.filter((claim) => claim.lane === lane).map((claim) => claim.statement);
}

/** Build the packet Scout stores from the submission the Website room owns. */
export function packetFromSubmission(
  submission: Pick<
    WebsiteSubmission,
    "submissionId" | "submittedAt" | "structured" | "verbatim" | "signals" | "attribution"
  >,
  submissionRowId?: string | null,
): FounderSignalPacket {
  return {
    submissionId: submission.submissionId,
    submissionRowId: submissionRowId ?? null,
    statedAt: submission.submittedAt,
    claims: claimsFromStructured(submission.structured),
    transcript: submission.verbatim.map((answer) => ({
      questionText: answer.questionText,
      answerText: answer.answerText,
      modality: answer.modality,
      skipped: answer.skipped === true,
    })),
    understanding: {
      frame: submission.signals.frame ?? null,
      frameConfidence: submission.signals.frameConfidence ?? null,
      objectiveCoverage: submission.signals.objectiveCoverage ?? null,
      completeness: submission.signals.completeness ?? null,
      authorizesResearch: submission.signals.authorizesResearch ?? null,
    },
    attribution: {
      landingPath: submission.attribution.landingPath ?? null,
      utmSource: submission.attribution.utm?.source ?? null,
      utmCampaign: submission.attribution.utm?.campaign ?? null,
    },
  };
}

/** The metadata key the packet lives under on `prospects.metadata`. */
export const STATED_METADATA_KEY = "inbound_stated";

/** Read a stored packet back, tolerating rows written before this lane existed. */
export function readPacket(metadata: unknown): FounderSignalPacket | null {
  const bag = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const raw = bag[STATED_METADATA_KEY];
  if (!raw || typeof raw !== "object") return null;
  const packet = raw as Partial<FounderSignalPacket>;
  if (!packet.submissionId) return null;
  return {
    submissionId: String(packet.submissionId),
    submissionRowId: packet.submissionRowId ?? null,
    statedAt: String(packet.statedAt ?? ""),
    claims: Array.isArray(packet.claims) ? packet.claims : [],
    transcript: Array.isArray(packet.transcript) ? packet.transcript : [],
    understanding: packet.understanding ?? {},
    attribution: packet.attribution ?? {},
  };
}

/**
 * Research is a thing we do to someone. Do it only when they said yes, or
 * when a person in the workspace takes that decision themselves.
 */
export function researchAuthorized(packet: FounderSignalPacket | null): boolean {
  return packet?.understanding.authorizesResearch === true;
}
