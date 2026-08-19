/**
 * Scout Research Workspace, pure logic.
 *
 * A company that came to us arrives with testimony. The workspace exists to
 * answer one honest question: how much of what they said have we actually
 * checked? Every function here is deterministic over a candidate, its people
 * and its activity history. Nothing calls a model, nothing writes state.
 *
 * Stated truth is never promoted to observed. Corroboration only records that
 * an observed signal happens to speak about the same thing a claim did.
 */

import type { ActivityEvent } from "@/domain/activity";
import type { ConfidenceLevel } from "@/domain/confidence";
import type { ProspectCandidate, ScoutSignal } from "@/domain/scout";
import {
  STATED_LANE_LABEL,
  STATED_LANE_ORDER,
  researchAuthorized,
  type FounderSignalPacket,
  type StatedClaim,
  type StatedLane,
} from "@/domain/stated";

/* ------------------------------------------------------------ evidence ---- */

/** How an observed signal stands against one stated claim. */
export type ClaimStanding = "corroborated" | "unverified";

export interface ReviewedClaim {
  lane: StatedLane;
  laneLabel: string;
  statement: string;
  standing: ClaimStanding;
  /** Observed signals that speak about the same subject. Never proof. */
  corroboration: ScoutSignal[];
}

export interface EvidenceReview {
  claims: ReviewedClaim[];
  lanes: { lane: StatedLane; laneLabel: string; claims: ReviewedClaim[] }[];
  totalClaims: number;
  corroboratedClaims: number;
  /** 0–1. Share of stated claims an observed signal speaks to. */
  coverage: number;
  /** Signals Scout actually read from public pages or a provider. */
  observed: ScoutSignal[];
  /** Signals that are only a restatement of what they told us. */
  stated: ScoutSignal[];
  researchAuthorized: boolean;
}

const STOPWORDS = new Set([
  "about", "after", "again", "their", "there", "these", "those", "which", "while",
  "with", "that", "this", "from", "have", "been", "they", "them", "into", "more",
  "than", "then", "when", "will", "would", "could", "should", "want", "wants",
  "need", "needs", "make", "making", "does", "doing", "just", "also", "very",
  "much", "some", "over", "under", "before", "because", "company", "business",
]);

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || STOPWORDS.has(raw)) continue;
    /* Cheap singularisation so "dashboards" meets "dashboard". */
    out.add(raw.endsWith("s") && raw.length > 4 ? raw.slice(0, -1) : raw);
  }
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) if (b.has(token)) count += 1;
  return count;
}

/** An observed signal is one Scout read, not one it echoed back from intake. */
export function isObservedSignal(signal: ScoutSignal): boolean {
  if (signal.id.startsWith("stated_")) return false;
  if (signal.provenance.appId === "website") return false;
  return signal.provenance.confidence !== "inferred" || Boolean(signal.sourceUrl);
}

/** Compare what they said against what we read. Two shared subject words. */
export function reviewStatedEvidence(candidate: ProspectCandidate): EvidenceReview {
  const packet = candidate.stated ?? null;
  const observed = candidate.signals.filter(isObservedSignal);
  const stated = candidate.signals.filter((signal) => !isObservedSignal(signal));
  const observedTokens = observed.map((signal) => ({ signal, tokens: tokens(signal.statement) }));

  const claims: ReviewedClaim[] = (packet?.claims ?? []).map((claim: StatedClaim) => {
    const claimTokens = tokens(claim.statement);
    const corroboration = observedTokens
      .filter((entry) => overlap(claimTokens, entry.tokens) >= 2)
      .map((entry) => entry.signal);
    return {
      lane: claim.lane,
      laneLabel: STATED_LANE_LABEL[claim.lane],
      statement: claim.statement,
      standing: corroboration.length > 0 ? "corroborated" : "unverified",
      corroboration,
    };
  });

  const corroboratedClaims = claims.filter((claim) => claim.standing === "corroborated").length;
  const lanes = STATED_LANE_ORDER.map((lane) => ({
    lane,
    laneLabel: STATED_LANE_LABEL[lane],
    claims: claims.filter((claim) => claim.lane === lane),
  })).filter((entry) => entry.claims.length > 0);

  return {
    claims,
    lanes,
    totalClaims: claims.length,
    corroboratedClaims,
    coverage: claims.length === 0 ? 0 : corroboratedClaims / claims.length,
    observed,
    stated,
    researchAuthorized: researchAuthorized(packet),
  };
}

/** Confidence is derived from evidence, and can never be raised past it. */
export function researchConfidence(review: EvidenceReview): {
  level: ConfidenceLevel;
  because: string;
} {
  if (review.observed.length === 0) {
    return {
      level: "unknown",
      because: "Nothing has been read yet. Everything on this page is what they told us.",
    };
  }
  if (review.observed.length >= 4 && review.coverage >= 0.5) {
    return {
      level: "high",
      because: `${review.corroboratedClaims} of ${review.totalClaims} stated claims are spoken to by ${review.observed.length} observed signals.`,
    };
  }
  if (review.observed.length >= 3 || review.coverage >= 0.3) {
    return {
      level: "moderate",
      because: `${review.observed.length} observed signals, but ${review.totalClaims - review.corroboratedClaims} stated claims are still unchecked.`,
    };
  }
  return {
    level: "low",
    because: `Only ${review.observed.length} observed signal${review.observed.length === 1 ? "" : "s"} stands behind what they said.`,
  };
}

/* ------------------------------------------------------ decision state ---- */

export type TaiDecision =
  | "read_them_first"
  | "research_needed"
  | "ready_to_route"
  | "routed"
  | "settled";

export const TAI_DECISION_LABEL: Record<TaiDecision, string> = {
  read_them_first: "Read what they said",
  research_needed: "Research before deciding",
  ready_to_route: "Ready for your decision",
  routed: "Handed to Comms",
  settled: "Settled",
};

export type DecisionActionKey =
  | "review_evidence"
  | "run_research"
  | "find_people"
  | "route_to_comms"
  | "sequence_in_roadmap"
  | "ask_conductor"
  | "pass";

export interface DecisionAction {
  key: DecisionActionKey;
  label: string;
  /** Why this move, in one sentence, grounded in what is on the page. */
  because: string;
  /** `conductor` actions ask for interpretation; `room` actions change state. */
  kind: "room" | "conductor";
  ready: boolean;
  /** Present only when `ready` is false. */
  blockedBecause?: string;
}

export interface DecisionTrailEntry {
  at: string;
  label: string;
  actor: string;
  /** True when a person, rather than the system, took the step. */
  byPerson: boolean;
}

export interface TaiDecisionStateView {
  state: TaiDecision;
  headline: string;
  because: string;
  confidence: ConfidenceLevel;
  confidenceBecause: string;
  coverage: number;
  actions: DecisionAction[];
  trail: DecisionTrailEntry[];
}

const TRAIL_NAMES = new Set([
  "website.intake_received",
  "website.intake_linked",
  "website.intake_held",
  "prospect.created",
  "prospect.discovered",
  "prospect.researched",
  "prospect.qualified",
  "prospect.status_changed",
  "prospect.handed_over",
  "prospect.commented",
  "prospect.decided",
]);

/** The decision trail is history that already happened, never a plan. */
export function decisionTrail(events: ActivityEvent[]): DecisionTrailEntry[] {
  return events
    .filter((event) => TRAIL_NAMES.has(event.name))
    .slice()
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .map((event) => ({
      at: event.occurredAt,
      label: event.summary || event.name.replace(/[._]/g, " "),
      actor: event.provenance.actor.label ?? (event.provenance.actor.type === "user" ? "A person" : "Trust Tai OS"),
      byPerson: event.provenance.actor.type === "user",
    }));
}

export function taiDecisionState(input: {
  candidate: ProspectCandidate;
  review: EvidenceReview;
  peopleCount: number;
  events: ActivityEvent[];
}): TaiDecisionStateView {
  const { candidate, review, peopleCount } = input;
  const status = candidate.prospect.status;
  const confidence = researchConfidence(review);
  const inbound = Boolean(candidate.stated);
  const trail = decisionTrail(input.events);
  const readByPerson = trail.some((entry) => entry.byPerson);

  let state: TaiDecision;
  let because: string;
  if (status === "passed" || status === "archived") {
    state = "settled";
    because = "Someone here already decided this one is not for now.";
  } else if (status === "ready_for_comms") {
    state = "routed";
    because = "The relationship now lives in Comms. Scout has nothing left to decide.";
  } else if (inbound && !readByPerson) {
    state = "read_them_first";
    because = "They told us their own Point A. Nobody here has read it yet.";
  } else if (review.observed.length === 0 || confidence.level === "low") {
    state = "research_needed";
    because = confidence.because;
  } else {
    state = "ready_to_route";
    because = `${review.corroboratedClaims} of ${review.totalClaims || 0} stated claims are backed by something we read, and fit reads ${candidate.evaluation.score}/100.`;
  }

  const canResearch = !inbound || review.researchAuthorized;
  const actions: DecisionAction[] = [];

  if (inbound) {
    actions.push({
      key: "review_evidence",
      label: "Review what they said",
      because: `${review.totalClaims} stated claim${review.totalClaims === 1 ? "" : "s"} to read in their own words.`,
      kind: "room",
      ready: review.totalClaims > 0,
      ...(review.totalClaims > 0 ? {} : { blockedBecause: "This intake carried no claims." }),
    });
  }

  actions.push({
    key: "run_research",
    label: "Read their public pages",
    because: canResearch
      ? "Turn testimony into something we have checked ourselves."
      : "They did not give us permission to research them.",
    kind: "room",
    ready: canResearch && Boolean(candidate.prospect.websiteUrl || candidate.prospect.domain),
    ...(canResearch
      ? candidate.prospect.websiteUrl || candidate.prospect.domain
        ? {}
        : { blockedBecause: "No website or domain is recorded for this company." }
      : { blockedBecause: "Research consent was not given on the intake." }),
  });

  actions.push({
    key: "find_people",
    label: "Find the decision maker",
    because:
      peopleCount > 0
        ? `${peopleCount} person${peopleCount === 1 ? "" : "s"} on file. Confirm who actually decides.`
        : "No named person yet, so no message can be honest about who it is for.",
    kind: "room",
    ready: true,
  });

  actions.push({
    key: "route_to_comms",
    label: "Hand this to Comms",
    because: "Comms owns the relationship once a real conversation starts.",
    kind: "room",
    ready: state === "ready_to_route" && peopleCount > 0,
    ...(state === "ready_to_route" && peopleCount > 0
      ? {}
      : {
          blockedBecause:
            peopleCount === 0
              ? "Nobody is named yet at this company."
              : "The evidence behind this company is still too thin to reach out on.",
        }),
  });

  actions.push({
    key: "sequence_in_roadmap",
    label: "Sequence in Roadmap",
    because: "Roadmap owns direction. Only sequence a company we intend to pursue.",
    kind: "room",
    ready: state === "ready_to_route" || state === "routed",
    ...(state === "ready_to_route" || state === "routed"
      ? {}
      : { blockedBecause: "Decide whether this company deserves attention first." }),
  });

  actions.push({
    key: "ask_conductor",
    label: "Ask the Conductor",
    because: "Interpretation and any bounded next step still need your authorization.",
    kind: "conductor",
    ready: true,
  });

  actions.push({
    key: "pass",
    label: "Pass for now",
    because: "A clear no is a decision too, and it stays on the trail.",
    kind: "room",
    ready: status !== "passed",
    ...(status !== "passed" ? {} : { blockedBecause: "Already passed." }),
  });

  return {
    state,
    headline: TAI_DECISION_LABEL[state],
    because,
    confidence: confidence.level,
    confidenceBecause: confidence.because,
    coverage: review.coverage,
    actions,
    trail,
  };
}

/** The question Scout hands the Conductor about one company. */
export function scoutConductorAsk(
  candidate: ProspectCandidate,
  decision: TaiDecisionStateView,
): { signal: string; app: string; entity: string; ask: string } {
  const name = candidate.prospect.name;
  return {
    signal: `scout:prospect:${candidate.prospect.id}`,
    app: "scout",
    entity: name,
    ask: candidate.stated
      ? `${name} came to us through the TrustTai.com roadmap intake. ${decision.because} What deserves attention here, and what is the smallest next step?`
      : `${name} is in Scout. ${decision.because} What deserves attention here, and what is the smallest next step?`,
  };
}

/** Only inbound companies have a stated lane worth a workspace of its own. */
export function hasResearchWorkspace(candidate: ProspectCandidate): boolean {
  return Boolean(candidate.stated) || candidate.source.kind === "website_intake";
}

export type { FounderSignalPacket };
