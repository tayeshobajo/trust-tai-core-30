/**
 * Trust Tai OS, relationship development contracts.
 *
 * Scout finds people worth knowing. Comms makes sure the right relationships
 * actually go somewhere. Roadmap appears when there is something worth
 * building. This module is the shared vocabulary for that loop.
 *
 * Governing laws:
 *  1. This is not a buying-probability score. The question is always "do we
 *     have a legitimate, timely reason to enter this person's world now?"
 *  2. Absence is unknown, never a negative.
 *  3. Conversation before conversion. An ask must be earned.
 *  4. Automation ends where relationship begins.
 *  5. Nothing here sends anything. A person approves every first move.
 */

import type { EvidenceRef } from "./confidence";
import type { ISODateTime } from "./entities";

/* -------------------------------------------------- relationship opportunity */

export type RelationshipOpportunityState =
  | "ready"
  | "watching"
  | "not_enough_signal"
  | "not_appropriate";

export const RELATIONSHIP_OPPORTUNITY_LABEL: Record<RelationshipOpportunityState, string> = {
  ready: "Ready to consider",
  watching: "Worth watching",
  not_enough_signal: "Not enough signal",
  not_appropriate: "Not appropriate now",
};

export type OpportunityFactorKey =
  | "decision_maker"
  | "contact_route"
  | "recent_signal"
  | "specific_notice"
  | "contribute_first"
  | "natural_bridge"
  | "local_relevance"
  | "freshness";

export const OPPORTUNITY_FACTOR_LABEL: Record<OpportunityFactorKey, string> = {
  decision_maker: "Decision maker identified",
  contact_route: "Socially appropriate route",
  recent_signal: "Recent meaningful signal",
  specific_notice: "Something real to notice",
  contribute_first: "A way to give before asking",
  natural_bridge: "A natural bridge",
  local_relevance: "Local connection",
  freshness: "Fresh evidence",
};

/** One factor in the opportunity read. Unknown never counts against. */
export interface OpportunityFactor {
  key: OpportunityFactorKey;
  label: string;
  state: "present" | "unknown";
  /** Plain-language account of what was read, or what was not found. */
  because: string;
  /** Points this factor contributes when present. */
  weight: number;
}

export interface RelationshipOpportunity {
  state: RelationshipOpportunityState;
  /** 0–100, internal ranking aid only. The explanation matters more. */
  score: number;
  /** One calm sentence naming the state and the strongest reason for it. */
  headline: string;
  factors: OpportunityFactor[];
  /** The freshest dated reason to act now, when one exists. */
  whyNow: string | null;
}

/* ------------------------------------------------------------- eligibility */

/**
 * The 60% trigger: strong fit plus a traceable decision maker makes a company
 * eligible for deeper relationship-development research. Eligibility never
 * means outreach is approved, and nothing is ever sent from it.
 */
export const RELATIONSHIP_RESEARCH_FIT_THRESHOLD = 60;

export interface RelationshipResearchEligibility {
  eligible: boolean;
  because: string;
}

/* ------------------------------------------------------------------ channel */

export type RelationshipChannel = "email" | "linkedin" | "text";

export const RELATIONSHIP_CHANNEL_LABEL: Record<RelationshipChannel, string> = {
  email: "Email",
  linkedin: "LinkedIn",
  text: "Text",
};

export interface ChannelRecommendation {
  channel: RelationshipChannel;
  /** Why this channel and not another, in plain language. */
  reason: string;
}

/* -------------------------------------------------------------- proof of care */

export type BridgeKind =
  | "observation"
  | "diagnostic"
  | "mockup"
  | "introduction"
  | "resource"
  | "pattern"
  | "idea";

export const BRIDGE_KIND_LABEL: Record<BridgeKind, string> = {
  observation: "A useful observation",
  diagnostic: "A small diagnostic",
  mockup: "A thoughtful mockup",
  introduction: "An introduction",
  resource: "A resource",
  pattern: "A pattern from their industry",
  idea: "A small idea",
};

/**
 * A Proof of Care: something genuinely useful to them, grounded in their
 * world, proportionate, with no obligation attached. Valuable even if they
 * never hire Trust Tai. Never a lead magnet.
 */
export interface ProofOfCare {
  kind: BridgeKind;
  label: string;
  idea: string;
  /** The evidence that makes this honest rather than flattery. */
  why: string;
}

/* ------------------------------------------------------------------- brief */

/**
 * The Relationship Development Brief: a structured judgment, assembled before
 * any prose. When `grounded` is false there is no trustworthy first move and
 * nothing should be drafted.
 */
export interface RelationshipDevelopmentBrief {
  /** Why this person, why now. Null when there is no honest reason. */
  whyNow: string | null;
  /** The most human thing the evidence actually shows. */
  humanSignal: string | null;
  /** What is objectively interesting or impressive about what they are building. */
  whatIsInteresting: string | null;
  /** The specific thing Tai could authentically notice. */
  whatTaiCanNotice: string | null;
  /** Things not to assume. Public professional evidence only. */
  risksOrAssumptions: string[];
  bestChannel: RelationshipChannel | null;
  channelReason: string | null;
  bridgeIdeas: ProofOfCare[];
  /** The suggested soft-introduction posture. Never a CTA by default. */
  firstMovePosture: string;
  shouldActNow: boolean;
  evidenceUsed: EvidenceRef[];
  /** False when the system cannot ground a trustworthy first move. */
  grounded: boolean;
  generatedAt: ISODateTime;
}

/* -------------------------------------------------------- roadmap recognition */

export type RoadmapNeedKind =
  | "competing_priorities"
  | "founder_bottleneck"
  | "unclear_sequencing"
  | "growth_outpacing_systems"
  | "disconnected_tools"
  | "unclear_next_build";

export const ROADMAP_NEED_LABEL: Record<RoadmapNeedKind, string> = {
  competing_priorities: "Competing priorities",
  founder_bottleneck: "Founder bottleneck",
  unclear_sequencing: "Unclear sequencing",
  growth_outpacing_systems: "Growth outpacing systems",
  disconnected_tools: "Disconnected operations or tools",
  unclear_next_build: "Unclear next build",
};

/** One concrete need the conversation or research actually revealed. */
export interface RoadmapNeed {
  kind: RoadmapNeedKind;
  label: string;
  /** The exact evidence the need was read from. */
  evidence: string;
  source?: string;
}

/**
 * A recommendation signal, not a conversion. It never auto-creates a Roadmap
 * and never inserts a pitch into a draft. Tai explicitly chooses whether to
 * propose one.
 */
export interface RoadmapOpportunitySignal {
  emerging: boolean;
  needs: RoadmapNeed[];
  /** What was revealed and why a Roadmap may now be useful. */
  because: string;
  confidence: "low" | "moderate" | "high";
}

/* ----------------------------------------------------------- development stage */

/**
 * Human-facing relationship development states, derived from the one existing
 * relationship record. Never a second pipeline.
 */
export type DevelopmentStage =
  | "ready_for_first_move"
  | "waiting_for_reply"
  | "conversation_open"
  | "needs_tai"
  | "cooling"
  | "developing";

export const DEVELOPMENT_STAGE_LABEL: Record<DevelopmentStage, string> = {
  ready_for_first_move: "Ready for first move",
  waiting_for_reply: "Waiting for reply",
  conversation_open: "Conversation open",
  needs_tai: "Needs Tai",
  cooling: "Cooling",
  developing: "Developing",
};

/* -------------------------------------------------------------- watch state */

/** A person's own pacing decision on the prospect record. */
export type WatchState = "watching" | "not_now";

export interface RelationshipDevelopmentMarker {
  watch: WatchState | null;
  by?: string;
  at?: ISODateTime;
}
