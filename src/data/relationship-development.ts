/**
 * Relationship development reads, computed from evidence Scout already holds.
 *
 * Pure and deterministic: the same stored evidence always produces the same
 * read, so every state can be proved in a test rather than eyeballed. Nothing
 * here fetches, sends, or mutates. The Intelligence Runtime may interpret
 * evidence elsewhere; this layer is the explainable backbone those reads must
 * never contradict.
 *
 * Laws enforced here:
 *  - Absence is unknown, never a negative.
 *  - Text is a protected channel: never recommended from a phone number alone.
 *  - A brief with nothing real to notice fails closed.
 *  - Roadmap is recognized from revealed need, never forced.
 */

import type { EvidenceRef } from "@/domain/confidence";
import type { Person } from "@/domain/people";
import {
  OPPORTUNITY_FACTOR_LABEL,
  RELATIONSHIP_RESEARCH_FIT_THRESHOLD,
  ROADMAP_NEED_LABEL,
  type ChannelRecommendation,
  type OpportunityFactor,
  type OpportunityFactorKey,
  type ProofOfCare,
  type RelationshipChannel,
  type RelationshipDevelopmentBrief,
  type RelationshipDevelopmentMarker,
  type RelationshipOpportunity,
  type RelationshipOpportunityState,
  type RelationshipResearchEligibility,
  type RoadmapNeed,
  type RoadmapNeedKind,
  type RoadmapOpportunitySignal,
} from "@/domain/relationship-development";
import type { ProspectCandidate } from "@/domain/scout";
import { EMPTY_INTEL, OPPORTUNITY_AREA_LABEL, type ScoutIntel } from "@/domain/scout-intel";

const DAY = 86_400_000;

/** A signal this old or newer counts as a recent reason to act. */
export const RECENT_SIGNAL_DAYS = 90;
/** Evidence older than this is no longer fresh. */
export const FRESH_EVIDENCE_DAYS = 45;
/** A reached-out relationship with no reply this long is cooling. */
export const COOLING_AFTER_DAYS = 21;

/* ------------------------------------------------------------------ people */

/**
 * The minimal person shape the opportunity read needs. Discovered intel
 * people and confirmed People-provider records both normalize into it, so the
 * read never depends on which table a person came from.
 */
export interface OpportunityPerson {
  fullName: string;
  roleTitle?: string;
  email?: string;
  linkedinUrl?: string;
  /** Confident decision-maker identification. */
  decisionMaker: boolean;
  /** The claim is confirmed (human-confirmed or observed on the company site). */
  confirmed: boolean;
  /** Email a person has verified, not merely found. */
  emailVerified: boolean;
}

function fromDiscovered(intel: ScoutIntel): OpportunityPerson[] {
  return intel.people.map((person) => ({
    fullName: person.fullName,
    ...(person.roleTitle ? { roleTitle: person.roleTitle } : {}),
    ...(person.email ? { email: person.email } : {}),
    ...(person.linkedinUrl ? { linkedinUrl: person.linkedinUrl } : {}),
    decisionMaker: person.decisionMakerLikelihood === "high",
    confirmed: person.decisionMakerLikelihood === "high" && Boolean(person.sourceUrl),
    emailVerified: false,
  }));
}

/** Confirmed People-provider records normalize in with their stronger truth. */
export function fromPersonRecords(people: Person[]): OpportunityPerson[] {
  return people.map((person) => ({
    fullName: person.fullName,
    ...(person.roleTitle ? { roleTitle: person.roleTitle } : {}),
    ...(person.email ? { email: person.email } : {}),
    ...(person.linkedinUrl ? { linkedinUrl: person.linkedinUrl } : {}),
    decisionMaker:
      person.seniority === "founder" || person.seniority === "owner" || person.seniority === "exec",
    confirmed: person.confidence === "human_confirmed" || person.confidence === "observed",
    emailVerified: person.emailStatus === "verified",
  }));
}

/**
 * The people this read runs on: confirmed records when they exist, discovered
 * intel people otherwise. The two never blend into duplicates; the stronger
 * source wins outright.
 */
export function opportunityPeople(intel: ScoutIntel, people: Person[] = []): OpportunityPerson[] {
  return people.length > 0 ? fromPersonRecords(people) : fromDiscovered(intel);
}

/** The best person to enter through: a confirmed decision maker with a route. */
export function bestEntryPerson(people: OpportunityPerson[]): OpportunityPerson | null {
  const ranked = [...people].sort((a, b) => score(b) - score(a));
  return ranked[0] ?? null;

  function score(person: OpportunityPerson): number {
    return (
      (person.decisionMaker ? 4 : 0) +
      (person.confirmed ? 2 : 0) +
      (person.emailVerified ? 2 : person.email ? 1 : 0) +
      (person.linkedinUrl ? 1 : 0)
    );
  }
}

/** A decision maker we could actually trace a route to. */
export function traceableDecisionMaker(people: OpportunityPerson[]): OpportunityPerson | null {
  return (
    people.find(
      (person) => person.decisionMaker && (Boolean(person.email) || Boolean(person.linkedinUrl)),
    ) ?? null
  );
}

/* -------------------------------------------------------------- eligibility */

/**
 * The 60% trigger. Strong fit plus a traceable founder/decision maker makes a
 * company eligible for deeper relationship-development research. Eligibility
 * is a read, not an action: nothing is sent and no Comms relationship is
 * created from it.
 */
export function relationshipResearchEligible(
  candidate: ProspectCandidate,
  people: OpportunityPerson[],
): RelationshipResearchEligibility {
  const { evaluation } = candidate;
  if (!evaluation.scoreable) {
    return {
      eligible: false,
      because: "This company has never been researched against the ICP, so fit is unknown.",
    };
  }
  if (evaluation.score < RELATIONSHIP_RESEARCH_FIT_THRESHOLD) {
    return {
      eligible: false,
      because: `Fit is ${evaluation.score}%, below the ${RELATIONSHIP_RESEARCH_FIT_THRESHOLD}% line for deeper relationship research.`,
    };
  }
  const decider = traceableDecisionMaker(people);
  if (!decider) {
    return {
      eligible: false,
      because:
        "Fit crosses the line, but no founder or decision maker with a contact route is on record yet.",
    };
  }
  return {
    eligible: true,
    because: `Fit is ${evaluation.score}% and ${decider.fullName} is on record with a way in. Deeper research is warranted; outreach still waits for a person.`,
  };
}

/* -------------------------------------------------------------- opportunity */

const FACTOR_WEIGHTS: Record<OpportunityFactorKey, number> = {
  decision_maker: 20,
  contact_route: 20,
  recent_signal: 20,
  specific_notice: 15,
  contribute_first: 10,
  natural_bridge: 10,
  freshness: 5,
  local_relevance: 0, // familiarity only; it never creates a reason on its own
};

function factor(
  key: OpportunityFactorKey,
  present: boolean,
  because: string,
): OpportunityFactor {
  return {
    key,
    label: OPPORTUNITY_FACTOR_LABEL[key],
    state: present ? "present" : "unknown",
    because,
    weight: FACTOR_WEIGHTS[key],
  };
}

function daysSince(value: string | undefined, now: Date): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.floor((now.getTime() - time) / DAY);
}

function isLocal(location: string | undefined): boolean {
  return Boolean(location && /\bnashville\b|\btennessee\b|\bTN\b/i.test(location));
}

export interface OpportunityInput {
  candidate: ProspectCandidate;
  intel?: ScoutIntel;
  people?: Person[];
  now?: Date;
}

/**
 * The second read beside ICP fit: do we have a legitimate, timely reason to
 * enter this person's world now? Absence lowers the state, never the company.
 */
export function computeRelationshipOpportunity(input: OpportunityInput): RelationshipOpportunity {
  const { candidate } = input;
  const intel = input.intel ?? candidate.intel ?? EMPTY_INTEL;
  const now = input.now ?? new Date();
  const people = opportunityPeople(intel, input.people ?? []);
  const entry = bestEntryPerson(people);
  const decider = traceableDecisionMaker(people);

  // Not appropriate now: a human passed, or the evidence says not our company.
  if (
    candidate.prospect.status === "passed" ||
    candidate.prospect.status === "archived" ||
    candidate.evaluation.light === "red"
  ) {
    return {
      state: "not_appropriate",
      score: 0,
      headline:
        candidate.evaluation.light === "red"
          ? "Fit says this is not our company right now."
          : "A person decided this is not for now.",
      factors: [],
      whyNow: null,
    };
  }

  const freshestSignalDays = intel.buyingSignals
    .map((signal) => daysSince(signal.observedAt, now))
    .filter((days): days is number => days !== null)
    .sort((a, b) => a - b)[0];
  const recentSignal =
    freshestSignalDays !== undefined && freshestSignalDays <= RECENT_SIGNAL_DAYS;
  const whyNowSignal = recentSignal
    ? intel.buyingSignals.find(
        (signal) => daysSince(signal.observedAt, now) === freshestSignalDays,
      )
    : undefined;

  const specificNotice =
    intel.opportunities.length > 0 || candidate.signals.length > 0 || Boolean(candidate.stated);
  const noticeSource =
    intel.opportunities[0]?.statement ?? candidate.signals[0]?.statement ?? null;

  const checkedDays = daysSince(candidate.lastCheckedAt, now);
  const fresh = checkedDays !== null && checkedDays <= FRESH_EVIDENCE_DAYS;

  const local = isLocal(candidate.profile?.location);

  const factors: OpportunityFactor[] = [
    factor(
      "decision_maker",
      Boolean(decider),
      decider
        ? `${decider.fullName} is on record${decider.roleTitle ? ` as ${decider.roleTitle}` : ""} with a way in.`
        : "No founder or decision maker with a contact route has been found yet.",
    ),
    factor(
      "contact_route",
      Boolean(entry && (entry.email || entry.linkedinUrl)),
      entry?.email
        ? `A business email is on record for ${entry.fullName}.`
        : entry?.linkedinUrl
          ? `A LinkedIn profile is on record for ${entry.fullName}.`
          : "No socially appropriate route has been found.",
    ),
    factor(
      "recent_signal",
      recentSignal,
      whyNowSignal
        ? `${whyNowSignal.statement} (${freshestSignalDays}d ago).`
        : intel.buyingSignals.length > 0
          ? "Signals exist but none are dated recently enough to act on."
          : "No meaningful recent signal has been observed.",
    ),
    factor(
      "specific_notice",
      specificNotice,
      noticeSource
        ? `There is something real to notice: ${noticeSource}`
        : candidate.stated
          ? "They told us about themselves directly through the intake."
          : "Nothing specific enough to genuinely notice has been read yet.",
    ),
    factor(
      "contribute_first",
      intel.opportunities.length > 0,
      intel.opportunities.length > 0
        ? "An observed gap gives us an honest way to be useful before asking for anything."
        : "No observed gap gives us an honest way to contribute first.",
    ),
    factor(
      "natural_bridge",
      intel.opportunities.length > 0 || Boolean(whyNowSignal) || local,
      intel.opportunities.length > 0
        ? "A diagnostic read of what we observed is a natural bridge."
        : whyNowSignal
          ? "The recent signal is a natural opening."
          : local
            ? "A genuine local connection exists."
            : "No natural bridge is visible yet.",
    ),
    factor(
      "freshness",
      fresh,
      fresh
        ? `Evidence was read ${checkedDays}d ago.`
        : checkedDays !== null
          ? `Evidence is ${checkedDays}d old; a fresh read would sharpen this.`
          : "Evidence has no reliable date.",
    ),
    factor(
      "local_relevance",
      local,
      local
        ? `${candidate.profile?.location} — a real local connection, to use only if it genuinely supports the conversation.`
        : "No evidenced local connection.",
    ),
  ];

  const score = factors
    .filter((item) => item.state === "present")
    .reduce((total, item) => total + item.weight, 0);

  const hasReasonToAct = recentSignal || specificNotice;
  let state: RelationshipOpportunityState;
  if (!candidate.evaluation.scoreable || (score < 30 && !specificNotice)) {
    state = "not_enough_signal";
  } else if (decider && entry && (entry.email || entry.linkedinUrl) && hasReasonToAct && score >= 60) {
    state = "ready";
  } else if (score >= 30 || specificNotice) {
    state = "watching";
  } else {
    state = "not_enough_signal";
  }

  const strongest =
    factors.find((item) => item.key === "recent_signal" && item.state === "present") ??
    factors.find((item) => item.key === "specific_notice" && item.state === "present") ??
    factors.find((item) => item.state === "present");

  const headline =
    state === "ready"
      ? `A legitimate, timely reason exists: ${strongest?.because ?? "the evidence lines up."}`
      : state === "watching"
        ? "Real potential, but no timely reason to enter their world yet."
        : "Not enough has been observed to know whether attention is warranted.";

  return {
    state,
    score,
    headline,
    factors,
    whyNow: whyNowSignal ? whyNowSignal.statement : null,
  };
}

/** Queue ordering: state first, then the opportunity score, then fit. */
export function worthKnowingSort(
  a: { opportunity: RelationshipOpportunity; fitScore: number },
  b: { opportunity: RelationshipOpportunity; fitScore: number },
): number {
  const rank: Record<RelationshipOpportunityState, number> = {
    ready: 0,
    watching: 1,
    not_enough_signal: 2,
    not_appropriate: 3,
  };
  const state = rank[a.opportunity.state] - rank[b.opportunity.state];
  if (state !== 0) return state;
  const score = b.opportunity.score - a.opportunity.score;
  if (score !== 0) return score;
  return b.fitScore - a.fitScore;
}

/* ------------------------------------------------------------------ channel */

export interface ChannelInput {
  person: OpportunityPerson | null;
  /** Where the opening signal actually came from. */
  signalOrigin?: "linkedin" | "web" | "intake" | "unknown";
  /** Tai has met this person, or numbers were exchanged, or an introduction was made. */
  priorRelationship?: boolean;
}

/**
 * Channels are not interchangeable. Email is the default professional route;
 * LinkedIn when the opening was LinkedIn-native; text is protected and only
 * ever follows existing relationship evidence, never a found phone number.
 */
export function recommendChannel(input: ChannelInput): ChannelRecommendation | null {
  const { person } = input;

  if (input.priorRelationship) {
    return {
      channel: "text",
      reason:
        "There is existing relationship evidence here — a meeting, an introduction, or exchanged numbers — so a personal channel is appropriate.",
    };
  }

  if (input.signalOrigin === "linkedin" && person?.linkedinUrl) {
    return {
      channel: "linkedin",
      reason:
        "The opening came from LinkedIn — a post, announcement, or discussion there — so meeting them in the same place is the natural move.",
    };
  }

  if (person?.email) {
    return {
      channel: "email",
      reason: `A legitimate business email is on record for ${person.fullName} and there is something worth saying.`,
    };
  }

  if (person?.linkedinUrl) {
    return {
      channel: "linkedin",
      reason: `No business email is on record; ${person.fullName}'s LinkedIn profile is the honest route.`,
    };
  }

  return null;
}

/* -------------------------------------------------------------- proof of care */

/**
 * Bridge ideas grounded in what was actually observed. Each is genuinely
 * useful, proportionate, and valuable even if they never hire Trust Tai.
 */
export function suggestProofOfCare(candidate: ProspectCandidate, intel?: ScoutIntel): ProofOfCare[] {
  const resolved = intel ?? candidate.intel ?? EMPTY_INTEL;
  const bridges: ProofOfCare[] = [];

  const opportunity = resolved.opportunities[0];
  if (opportunity) {
    bridges.push({
      kind: "diagnostic",
      label: "A small diagnostic",
      idea: `A short, honest read of their ${OPPORTUNITY_AREA_LABEL[opportunity.area].toLowerCase()} — what we saw, and what it might be worth to them.`,
      why: opportunity.evidence,
    });
  }

  const signal = resolved.buyingSignals[0];
  if (signal) {
    bridges.push({
      kind: "observation",
      label: "A useful observation",
      idea: `A genuine note on what changed for them: ${signal.statement}`,
      why: signal.sourceUrl ? `Observed on a public page: ${signal.sourceUrl}` : signal.statement,
    });
  }

  if (candidate.profile?.industry) {
    bridges.push({
      kind: "pattern",
      label: "A pattern from their industry",
      idea: `A pattern we keep seeing across ${candidate.profile.industry} companies at their stage, and the one move that tends to matter.`,
      why: "Grounded in Trust Tai's delivery history, offered with no obligation.",
    });
  }

  if (bridges.length === 0 && candidate.signals.length > 0) {
    bridges.push({
      kind: "observation",
      label: "A useful observation",
      idea: `A genuine note on something specific they are building: ${candidate.signals[0]!.statement}`,
      why: candidate.signals[0]!.sourceUrl
        ? `Observed on a public page: ${candidate.signals[0]!.sourceUrl}`
        : "Observed on their public site.",
    });
  }

  return bridges.slice(0, 3);
}

/* ------------------------------------------------------------------- brief */

export interface BriefInput extends OpportunityInput {
  people?: Person[];
  signalOrigin?: ChannelInput["signalOrigin"];
  priorRelationship?: boolean;
}

/**
 * Assemble the Relationship Development Brief from stored evidence. Judgment
 * first, prose never — this brief is the structure a later draft must honor.
 * Fail closed: with nothing real to notice there is no trustworthy first move.
 */
export function buildRelationshipBrief(input: BriefInput): RelationshipDevelopmentBrief {
  const { candidate } = input;
  const intel = input.intel ?? candidate.intel ?? EMPTY_INTEL;
  const people = opportunityPeople(intel, input.people ?? []);
  const entry = bestEntryPerson(people);
  const decider = traceableDecisionMaker(people);
  const opportunity = computeRelationshipOpportunity(input);
  const bridges = suggestProofOfCare(candidate, intel);
  const channel = recommendChannel({
    person: entry,
    ...(input.signalOrigin ? { signalOrigin: input.signalOrigin } : {}),
    ...(input.priorRelationship ? { priorRelationship: input.priorRelationship } : {}),
  });

  const whatTaiCanNotice =
    intel.opportunities[0]?.statement ?? candidate.signals[0]?.statement ?? null;
  const whatIsInteresting = candidate.fit.whyItFits || null;

  const risks: string[] = [];
  if (decider && !decider.confirmed) {
    risks.push(`${decider.fullName}'s role has not been confirmed by a person or their own site.`);
  }
  if (entry?.email && !entry.emailVerified) {
    risks.push(`${entry.fullName}'s email has not been verified; nobody should write to it yet.`);
  }
  if (!entry) risks.push("No named person is on record; do not address the company generically.");
  for (const unknown of intel.unknowns.slice(0, 3)) risks.push(unknown);

  const evidenceUsed: EvidenceRef[] = [
    ...intel.buyingSignals.slice(0, 3).map((signal) => ({
      label: signal.statement,
      ...(signal.sourceUrl ? { url: signal.sourceUrl } : {}),
      kind: "page" as const,
    })),
    ...intel.opportunities.slice(0, 2).map((item) => ({
      label: item.statement,
      ...(item.sourceUrl ? { url: item.sourceUrl } : {}),
      kind: "page" as const,
    })),
    {
      label: `ICP fit ${candidate.evaluation.scoreable ? `${candidate.evaluation.score}%` : "unscored"} (deterministic evaluator)`,
      kind: "computed" as const,
    },
  ];

  // Fail closed: nothing real to notice, or nobody to notice it to.
  const grounded = Boolean(whatTaiCanNotice) && Boolean(entry);

  const firstMovePosture = grounded
    ? [
        `Step into ${entry!.fullName}'s world: name the specific thing you noticed and why it caught your attention.`,
        "Make them feel interesting, not praised. Reflect something real, then stop.",
        "No call, no pitch, no roadmap. The only goal is to earn the next natural exchange.",
        bridges[0] ? `If a bridge belongs, offer it freely: ${bridges[0].label.toLowerCase()}.` : null,
      ]
        .filter(Boolean)
        .join(" ")
    : "There is no trustworthy first move yet. Research more before anyone writes a word.";

  return {
    whyNow: opportunity.whyNow,
    humanSignal: opportunity.whyNow ?? whatTaiCanNotice,
    whatIsInteresting,
    whatTaiCanNotice,
    risksOrAssumptions: risks,
    bestChannel: channel?.channel ?? null,
    channelReason: channel?.reason ?? null,
    bridgeIdeas: bridges,
    firstMovePosture,
    shouldActNow: grounded && opportunity.state === "ready",
    evidenceUsed,
    grounded,
    generatedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------- roadmap recognition */

const NEED_PATTERNS: [RoadmapNeedKind, RegExp][] = [
  [
    "competing_priorities",
    /competing priorities|pulled in (too )?many|everything at once|too many things (at once|competing)|can'?t prioritise|can'?t prioritize/i,
  ],
  [
    "founder_bottleneck",
    /bottleneck|everything (runs|goes|comes) through (me|the founder|him|her)|can'?t delegate|founder.{0,24}(approval|sign.?off|bottleneck)|decisions wait on me/i,
  ],
  [
    "unclear_sequencing",
    /what (comes|to do) first|don'?t know (what|where) to (start|do first)|sequenc|in what order|where to begin|what order/i,
  ],
  [
    "growth_outpacing_systems",
    /outgrow|outpac|growing faster than|systems can'?t keep up|scaling (pains|issues)|held together with/i,
  ],
  [
    "disconnected_tools",
    /disconnected|siloed|tools don'?t talk|spreadsheets everywhere|manual handoffs?|patchwork|duct.?tape/i,
  ],
  [
    "unclear_next_build",
    /what to build next|next (build|phase) (is|isn'?t) (clear|unclear)|unclear what to build|no clear next step (for|on) the (product|platform|site)/i,
  ],
];

/**
 * Recognize a Roadmap opportunity from what the conversation or research
 * actually revealed. Pure: it detects and explains, and it never creates a
 * roadmap or inserts a pitch anywhere.
 */
export function detectRoadmapOpportunity(
  texts: { text: string; source?: string }[],
): RoadmapOpportunitySignal {
  const needs: RoadmapNeed[] = [];
  for (const entry of texts) {
    const text = entry.text?.trim();
    if (!text) continue;
    for (const [kind, pattern] of NEED_PATTERNS) {
      if (needs.some((need) => need.kind === kind)) continue;
      const match = pattern.exec(text);
      if (!match) continue;
      needs.push({
        kind,
        label: ROADMAP_NEED_LABEL[kind],
        evidence: text.length > 220 ? `${text.slice(0, 217)}…` : text,
        ...(entry.source ? { source: entry.source } : {}),
      });
    }
  }

  if (needs.length === 0) {
    return {
      emerging: false,
      needs: [],
      because:
        "Nothing in the conversation or research reveals a concrete need a strategic map would answer.",
      confidence: "low",
    };
  }

  return {
    emerging: true,
    needs,
    because: `The conversation revealed ${needs
      .map((need) => need.label.toLowerCase())
      .join(
        ", ",
      )} — the kind of tangle a sequenced roadmap genuinely helps with. Tai decides whether to propose one.`,
    confidence: needs.length >= 3 ? "high" : needs.length === 2 ? "moderate" : "low",
  };
}

/* -------------------------------------------------------------- watch state */

type Row = Record<string, unknown>;

/** Read the person's pacing decision off the prospect metadata. */
export function readRelationshipDevelopment(metadata: unknown): RelationshipDevelopmentMarker {
  const meta = (metadata && typeof metadata === "object" ? metadata : {}) as Row;
  const block = (meta["relationship_development"] ?? {}) as Row;
  const watch = block["watch"];
  return {
    watch: watch === "watching" || watch === "not_now" ? watch : null,
    ...(typeof block["by"] === "string" ? { by: block["by"] } : {}),
    ...(typeof block["at"] === "string" ? { at: block["at"] } : {}),
  };
}
