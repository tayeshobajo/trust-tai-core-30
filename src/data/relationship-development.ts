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
 *  - 60% ICP fit triggers deeper research, never outreach — and the actionable
 *    queue additionally requires a traceable founder or decision maker.
 *  - Text is a protected channel: recommended only on explicit text-route
 *    evidence, never from having met, an introduction, or a found number.
 *  - A brief with nothing real to notice fails closed.
 *  - Roadmap is recognized only from needs THEY revealed — counterparty words
 *    alone, with quoted history stripped, never from language Trust Tai
 *    introduced.
 */

import type { EvidenceRef } from "@/domain/confidence";
import type { Touch } from "@/domain/comms";
import type { StoredMailboxMessage } from "@/domain/comms-integrations";
import {
  emailNodesToText,
  parseEmailHtml,
  splitQuotedContent,
  splitQuotedNodes,
} from "@/domain/comms-email-body";
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
  type RelationshipResearchMarker,
  type TextChannelEvidence,
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
  /**
   * The only thing that can ever open the text channel: explicit evidence of
   * a legitimate personal text route — a number they shared for direct
   * contact, a prior SMS conversation, or an explicit text preference.
   * Meeting in person, being introduced, or a phone number found somewhere is
   * never text evidence, and a phone number is never inferred or scraped.
   */
  textEvidence?: TextChannelEvidence;
}

const TEXT_EVIDENCE_REASON: Record<TextChannelEvidence, string> = {
  exchanged_direct_number: "They shared a direct number for reaching them, so a short personal text is natural.",
  prior_sms_conversation: "You have texted before, so continuing on that thread is the natural step.",
  explicit_text_preference: "They asked to be texted, so text is the channel they chose.",
};

/**
 * Channels are not interchangeable. Email is the default professional route;
 * LinkedIn when the opening was LinkedIn-native; text is protected and opens
 * only on explicit text-route evidence — never from having met, an
 * introduction, or a found phone number.
 */
export function recommendChannel(input: ChannelInput): ChannelRecommendation | null {
  const { person } = input;

  if (input.textEvidence) {
    return { channel: "text", reason: TEXT_EVIDENCE_REASON[input.textEvidence] };
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
  /** Explicit text-route evidence, when a person recorded it. See ChannelInput. */
  textEvidence?: TextChannelEvidence;
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
    ...(input.textEvidence ? { textEvidence: input.textEvidence } : {}),
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

/**
 * Need patterns are deliberately specific: each can only mean a real
 * operational tangle. Generic language — "growth", "next steps", "roadmap",
 * "stay connected", ordinary greetings, or Trust Tai's own vocabulary — never
 * matches, and detection only ever runs on counterparty-authored evidence
 * (see `counterpartyEvidence`).
 */
const NEED_PATTERNS: { kind: RoadmapNeedKind; pattern: RegExp }[] = [
  {
    kind: "competing_priorities",
    pattern:
      /competing priorities|pulled in (too )?many|everything at once|too many things (at once|competing)|can'?t prioritise|can'?t prioritize/i,
  },
  {
    kind: "founder_bottleneck",
    pattern:
      /bottleneck|everything (runs|goes|comes) through (me|the founder|him|her)|can'?t delegate|founder.{0,24}(approval|sign.?off|bottleneck)|decisions wait on me/i,
  },
  {
    kind: "unclear_sequencing",
    pattern:
      /what (comes|to do) first|don'?t know (what|where) to (start|do first)|sequenc|in what order|where to begin|what order/i,
  },
  {
    kind: "growth_outpacing_systems",
    pattern:
      /outgrow|outpac|growing faster than|systems can'?t keep up|scaling (pains|issues)|held together with/i,
  },
  {
    kind: "disconnected_tools",
    pattern:
      /disconnected|siloed|tools don'?t talk|spreadsheets everywhere|manual handoffs?|patchwork|duct.?tape/i,
  },
  {
    kind: "unclear_next_build",
    pattern:
      /what to build next|next (build|phase) (is|isn'?t) (clear|unclear)|unclear what to build|no clear next step (for|on) the (product|platform|site)/i,
  },
];

/**
 * The tightest honest excerpt: the sentence the match actually lives in, not
 * the whole message. A person reading the panel should see their words, not a
 * wall of surrounding email.
 */
function needExcerpt(text: string, matched: string): string {
  const clamp = (value: string): string =>
    value.length > 200 ? `${value.slice(0, 197)}…` : value;
  const at = text.indexOf(matched);
  if (at === -1) return clamp(text.trim());
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  let offset = 0;
  for (const sentence of sentences) {
    const end = offset + sentence.length;
    if (at >= offset && at <= end) return clamp(sentence.trim());
    offset = end + 1;
  }
  return clamp(text.trim());
}

/**
 * Recognize a Roadmap opportunity from what the COUNTERPARTY actually
 * revealed. The caller is responsible for passing only their words (see
 * `counterpartyEvidence`); this function never creates a roadmap, never
 * inserts a pitch, and never nudges anyone. Tai decides.
 */
export function detectRoadmapOpportunity(
  texts: { text: string; source?: string }[],
): RoadmapOpportunitySignal {
  const needs: RoadmapNeed[] = [];
  for (const entry of texts) {
    const text = entry.text?.trim();
    if (!text) continue;
    for (const { kind, pattern } of NEED_PATTERNS) {
      if (needs.some((need) => need.kind === kind)) continue;
      const match = pattern.exec(text);
      if (!match) continue;
      needs.push({
        kind,
        label: ROADMAP_NEED_LABEL[kind],
        evidence: needExcerpt(text, match[0]),
        ...(entry.source ? { source: entry.source } : {}),
      });
    }
  }

  if (needs.length === 0) {
    return {
      emerging: false,
      needs: [],
      because:
        "Nothing they have actually said reveals a concrete need a strategic map would answer.",
      confidence: "low",
    };
  }

  return {
    emerging: true,
    needs,
    because: `They revealed ${needs
      .map((need) => need.label.toLowerCase())
      .join(
        ", ",
      )} in their own words — the kind of tangle a sequenced roadmap genuinely helps with. Tai decides whether to propose one.`,
    confidence: needs.length >= 3 ? "high" : needs.length === 2 ? "moderate" : "low",
  };
}

/* ------------------------------------------- counterparty-only evidence */

type CounterpartyMessage = Pick<
  StoredMailboxMessage,
  "direction" | "subject" | "snippet" | "bodyText" | "bodyHtml"
>;
type CounterpartyTouch = Pick<Touch, "direction" | "summary" | "body" | "provenance">;

/**
 * Their words from one inbound email, with quoted history and signatures
 * stripped first — an inbound reply quoting our own earlier email must never
 * read our language back as their need. Reuses the one shared quoted-content
 * logic; there is no second parser.
 */
function counterpartyEmailText(message: CounterpartyMessage): string {
  if (message.bodyHtml) {
    const { main } = splitQuotedNodes(parseEmailHtml(message.bodyHtml));
    const text = emailNodesToText(main).trim();
    if (text) return text;
  }
  if (message.bodyText) return splitQuotedContent(message.bodyText).main;
  return message.snippet ?? "";
}

/**
 * The only words Roadmap recognition may ever read:
 *  - INBOUND email/SMS: subject plus quoted-stripped body.
 *  - INBOUND recorded interactions (a call where they spoke, a text from
 *    them).
 *  - Interactions a person explicitly marked as their quoted words.
 * Outbound mail, our drafts, our notes, our hypotheses, and anything the
 * system generated are excluded — our own language can never manufacture a
 * Roadmap signal.
 */
export function counterpartyEvidence(input: {
  messages?: CounterpartyMessage[];
  touches?: CounterpartyTouch[];
}): { text: string; source?: string }[] {
  const texts: { text: string; source?: string }[] = [];

  for (const message of input.messages ?? []) {
    if (message.direction !== "inbound") continue;
    const body = counterpartyEmailText(message);
    const text = [message.subject ?? "", body]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n");
    if (text) texts.push({ text, source: "Their email" });
  }

  for (const touch of input.touches ?? []) {
    const theirWords =
      touch.direction === "inbound" || touch.provenance?.["their_words"] === true;
    if (!theirWords) continue;
    const text = [touch.summary, touch.body ?? ""]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n");
    if (!text) continue;
    texts.push({
      text,
      source:
        touch.direction === "inbound"
          ? "Their words"
          : "Their words, recorded by a person here",
    });
  }

  return texts;
}

/* ---------------------------------------------------- preparation planning */

/**
 * Briefs carry a version so a future read can tell what it is looking at,
 * and a staleness window so an old brief is refreshed rather than trusted
 * forever. Automatic preparation stays bounded: it runs when eligibility is
 * newly reached, when the underlying evidence moved, or when the brief went
 * stale — never on every render.
 */
export const RELATIONSHIP_BRIEF_VERSION = 1;
export const RELATIONSHIP_BRIEF_STALE_DAYS = 30;

/** The timestamp of the evidence a brief would be built from right now. */
export function relationshipEvidenceAt(candidate: ProspectCandidate): string | undefined {
  return candidate.intel?.collectedAt ?? candidate.lastCheckedAt;
}

export interface RelationshipPreparationPlan {
  /** What should happen next. "none" means the stored marker is already right. */
  action: "prepare" | "refresh" | "mark_ineligible" | "none";
  eligible: boolean;
  because: string;
}

/**
 * Decide whether deeper relationship-development research should be prepared
 * for this prospect. The gate is the full eligibility read — 60% fit AND a
 * traceable founder/decision maker — and the output is research only. It
 * never sends, never creates a Comms relationship, and never approves
 * outreach.
 */
export function planRelationshipPreparation(input: {
  candidate: ProspectCandidate;
  people?: Person[];
  now?: Date;
  force?: boolean;
}): RelationshipPreparationPlan {
  const { candidate } = input;
  const intel = candidate.intel ?? EMPTY_INTEL;
  const people = opportunityPeople(intel, input.people ?? []);
  const eligibility = relationshipResearchEligible(candidate, people);
  const marker = candidate.development?.research;

  if (!eligibility.eligible) {
    return marker && marker.state !== "not_eligible"
      ? { action: "mark_ineligible", eligible: false, because: eligibility.because }
      : { action: "none", eligible: false, because: eligibility.because };
  }

  if (input.force) {
    return {
      action: marker?.state === "prepared" ? "refresh" : "prepare",
      eligible: true,
      because: "A person here asked for a fresh read.",
    };
  }

  if (!marker || marker.state !== "prepared" || !marker.brief) {
    return { action: "prepare", eligible: true, because: eligibility.because };
  }

  const evidenceAt = relationshipEvidenceAt(candidate);
  if (evidenceAt && evidenceAt !== marker.evidenceAt) {
    return {
      action: "refresh",
      eligible: true,
      because: "The underlying evidence moved on since this brief was prepared.",
    };
  }

  const age = daysSince(marker.preparedAt, input.now ?? new Date());
  if (age !== null && age > RELATIONSHIP_BRIEF_STALE_DAYS) {
    return {
      action: "refresh",
      eligible: true,
      because: `This brief is ${age} days old; a fresh read would sharpen it.`,
    };
  }

  return { action: "none", eligible: true, because: "The prepared brief is current." };
}

/* -------------------------------------------------- worth-knowing membership */

export type WorthKnowingMembership = "actionable" | "needs_person" | "outside";

/**
 * Where a candidate belongs in Worth Knowing. The actionable queue is people,
 * never anonymous companies: 60%+ fit AND a traceable founder or decision
 * maker. A strong-fit company with no person on record yet is kept quietly as
 * "needs a person" — visible, but never presented as ready for relationship
 * development.
 */
export function worthKnowingMembership(
  candidate: ProspectCandidate,
  people: Person[] = [],
): WorthKnowingMembership {
  const { evaluation, prospect } = candidate;
  if (prospect.status === "passed" || prospect.status === "archived") return "outside";
  if (!evaluation.scoreable || evaluation.score < RELATIONSHIP_RESEARCH_FIT_THRESHOLD) {
    return "outside";
  }
  const intel = candidate.intel ?? EMPTY_INTEL;
  const eligibility = relationshipResearchEligible(candidate, opportunityPeople(intel, people));
  return eligibility.eligible ? "actionable" : "needs_person";
}

/* -------------------------------------------------------------- watch state */

type Row = Record<string, unknown>;

function readResearchMarker(block: Row): RelationshipResearchMarker | undefined {
  const raw = block["research"];
  if (!raw || typeof raw !== "object") return undefined;
  const marker = raw as Row;
  const state = marker["state"];
  if (state !== "research_needed" && state !== "prepared" && state !== "not_eligible") {
    return undefined;
  }
  return {
    state,
    because: typeof marker["because"] === "string" ? marker["because"] : "",
    version: typeof marker["version"] === "number" ? marker["version"] : 0,
    ...(typeof marker["eligible_since"] === "string"
      ? { eligibleSince: marker["eligible_since"] }
      : {}),
    ...(typeof marker["prepared_at"] === "string" ? { preparedAt: marker["prepared_at"] } : {}),
    ...(typeof marker["evidence_at"] === "string" ? { evidenceAt: marker["evidence_at"] } : {}),
    ...(marker["brief"] && typeof marker["brief"] === "object"
      ? { brief: marker["brief"] as RelationshipDevelopmentBrief }
      : {}),
  };
}

/**
 * Read the relationship-development state off the prospect metadata: the
 * person's pacing decision and the governed research marker, side by side.
 */
export function readRelationshipDevelopment(metadata: unknown): RelationshipDevelopmentMarker {
  const meta = (metadata && typeof metadata === "object" ? metadata : {}) as Row;
  const block = (meta["relationship_development"] ?? {}) as Row;
  const watch = block["watch"];
  const research = readResearchMarker(block);
  return {
    watch: watch === "watching" || watch === "not_now" ? watch : null,
    ...(typeof block["by"] === "string" ? { by: block["by"] } : {}),
    ...(typeof block["at"] === "string" ? { at: block["at"] } : {}),
    ...(research ? { research } : {}),
  };
}

/**
 * The storage shape of a marker: the UI reads camelCase, the row stores
 * snake_case. Kept in one place so writers and readers never drift.
 */
export function researchMarkerToRow(marker: RelationshipResearchMarker): Row {
  return {
    state: marker.state,
    because: marker.because,
    version: marker.version,
    ...(marker.eligibleSince ? { eligible_since: marker.eligibleSince } : {}),
    ...(marker.preparedAt ? { prepared_at: marker.preparedAt } : {}),
    ...(marker.evidenceAt ? { evidence_at: marker.evidenceAt } : {}),
    ...(marker.brief ? { brief: marker.brief as unknown as Row } : {}),
  };
}

/**
 * Serialize the whole relationship-development block for a metadata patch,
 * preserving whichever parts (watch, research) are present. The stored
 * metadata merge is shallow, so writers must always write the full block —
 * never one piece of it — or the sibling piece would be silently dropped.
 */
export function relationshipDevelopmentRow(marker: RelationshipDevelopmentMarker): Row {
  return {
    watch: marker.watch,
    ...(marker.by ? { by: marker.by } : {}),
    ...(marker.at ? { at: marker.at } : {}),
    ...(marker.research ? { research: researchMarkerToRow(marker.research) } : {}),
  };
}
