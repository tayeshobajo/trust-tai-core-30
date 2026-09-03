/**
 * Scout, the recommended next move.
 *
 * The company page answers one question at a time: what should happen next?
 * This is the single canonical read behind that answer, one move, one clear
 * reason, one primary action, computed from evidence Scout already holds.
 * Pure and deterministic, so every state can be proved in a test. Nothing
 * here fetches, sends, drafts, or mutates.
 *
 * Laws enforced here:
 *  - 60%+ ICP fit triggers deeper research, never outreach.
 *  - The page never turns an internal eligibility rule into a riddle. A
 *    strong-fit company with nobody on record is "find the founder"; a known
 *    founder with no route is "find a way in"; a known person whose decision
 *    role is unestablished is "confirm who decides". Three different missing
 *    steps, three different human actions, never one collapsed "find the
 *    person".
 *  - A traceable person with a missing or stale brief is "understand them
 *    first", drafting never skips the governed research step.
 *  - A found-but-unverified address is "verify the way in": the one action
 *    is the governed confirmation itself, never a generic link elsewhere.
 *  - A ready brief with no dated signal is "worth knowing, no urgency".
 *    Urgency is never manufactured.
 *  - A blocked first message never instructs outreach: the headline names
 *    the gate, and the one action is resolving the blockers, never
 *    "prepare a message" that cannot honestly be sent.
 *  - Once a company is in Comms, Scout stops behaving like outbound.
 *  - Text is a protected channel: it can never be recommended here, because
 *    Scout holds no explicit text-route evidence and none is ever inferred.
 */

import type { EvidenceRef } from "@/domain/confidence";
import type { Person } from "@/domain/people";
import {
  RELATIONSHIP_RESEARCH_FIT_THRESHOLD,
  type ChannelRecommendation,
  type RelationshipDevelopmentBrief,
  type WatchState,
} from "@/domain/relationship-development";
import type { ProspectCandidate } from "@/domain/scout";
import { EMPTY_INTEL } from "@/domain/scout-intel";

import {
  bestEntryPerson,
  computeRelationshipOpportunity,
  opportunityPeople,
  planRelationshipPreparation,
  recommendChannel,
  relationshipResearchEligible,
} from "../relationship-development";
import { personReadiness } from "./person-readiness";

export type RecommendedMoveState =
  /** Handed over; the relationship develops in Comms now. */
  | "in_comms"
  /** Strong fit, but no named founder/decision maker is known at all. */
  | "find_person"
  /** A decision maker is known, but no legitimate professional route exists. */
  | "find_route"
  /** A person is known, but their decision-maker role is not established. */
  | "confirm_decider"
  /** A route exists, but the address on record is not verified. */
  | "verify_route"
  /** A person is on record, but the governed brief is missing or stale. */
  | "research_first"
  /** Eligible, brief ready, no dated reason to act. Urgency is not manufactured. */
  | "no_urgency"
  /** Eligible, brief ready, and a real dated signal exists. */
  | "act_now"
  /** Below the line, unread, or set aside, no relationship move is honest yet. */
  | "not_ready";

export type RecommendedMoveAction =
  | "open_in_comms"
  | "find_person"
  | "find_contact_route"
  | "confirm_decision_maker"
  | "confirm_email"
  | "prepare_research"
  | "prepare_first_message"
  | "resolve_blockers"
  | "research_company"
  | "none";

/** Where this relationship stands: Match → Person → Research → First message. */
export type MoveStageKey = "match" | "person" | "research" | "first_message";

export interface MoveStage {
  key: MoveStageKey;
  label: string;
  state: "complete" | "current" | "upcoming";
}

export interface RecommendedNextMove {
  state: RecommendedMoveState;
  /** The calm state label, e.g. "Worth knowing, no urgency". */
  label: string;
  /** The move itself, e.g. "Start with email to Claire Meneely". */
  headline: string;
  /** One clear reason, in plain human language. */
  reason: string;
  /** Who this is about, when a person is on record. */
  person: { fullName: string; roleTitle?: string } | null;
  /**
   * The socially natural channel, only when one is legitimately on record.
   * Never text: Scout holds no explicit text-route evidence, and a found
   * phone number is not social permission.
   */
  channel: ChannelRecommendation | null;
  /** The one primary action. "none" means the page offers no relationship move. */
  primary: { kind: RecommendedMoveAction; label: string };
  /**
   * True when the way in is still gated. The headline then names the gate,
   * and the primary action resolves it, a confirmation, or the guided
   * blocker flow, never "prepare a message" that cannot honestly be sent.
   */
  blocked: boolean;
  /**
   * True when the prepare-research action should force a fresh read (the
   * stored brief is ungrounded). Otherwise the governed planner decides.
   */
  prepareForce: boolean;
  /** The person's own pacing decision, when one exists. */
  watch: WatchState | null;
  /** The real dated reason to act now, when one exists. */
  whyNow: string | null;
  /** The evidence the read rests on. */
  evidence: EvidenceRef[];
  /**
   * The quiet progress strip: Match → Person → Research → First message.
   * Exactly one stage is current unless every stage is complete.
   */
  progress: MoveStage[];
}

const CHANNEL_MOVE: Record<string, (name: string) => string> = {
  email: (name) => `Start with email to ${name}`,
  linkedin: (name) => `Start on LinkedIn with ${name}`,
};

/**
 * The headline when the first message is still gated. It names the gate,
 * never instructs outreach. Email calls the gate by its name; any other
 * route speaks about the person instead.
 */
function blockedHeadline(channel: ChannelRecommendation | null, name: string): string {
  if (channel?.channel === "email") return "Email looks like the right way in, verify it first";
  return `${name.split(/\s+/)[0]} is worth knowing, verify the way in first`;
}

function blockerLabel(count: number): string {
  return `Resolve ${count} blocker${count === 1 ? "": "s"}`;
}

function personRef(
  person: { fullName: string; roleTitle?: string } | null,
): RecommendedNextMove["person"] {
  if (!person) return null;
  return {
    fullName: person.fullName,
...(person.roleTitle ? { roleTitle: person.roleTitle }: {}),
  };
}

/**
 * The quiet "where am I" strip. Stages are read independently from the same
 * evidence as the move, a verified-way-in gap leaves Person current even
 * when Research already completed, and exactly one stage is current unless
 * the relationship has been handed to Comms.
 */
function buildMoveProgress(input: {
  inComms: boolean;
  strongFit: boolean;
  personReady: boolean;
  briefReady: boolean;
}): MoveStage[] {
  const complete = input.inComms;
  const match: MoveStage["state"] = complete ? "complete": input.strongFit ? "complete": "current";
  const person: MoveStage["state"] = complete
    ? "complete"
: !input.strongFit
      ? "upcoming"
: input.personReady
        ? "complete"
: "current";
  const research: MoveStage["state"] = complete
    ? "complete"
: input.briefReady
      ? "complete"
: input.strongFit && input.personReady
        ? "current"
: "upcoming";
  const firstMessage: MoveStage["state"] = complete
    ? "complete"
: input.personReady && input.briefReady
      ? "current"
: "upcoming";
  return [
    { key: "match", label: "Match", state: match },
    { key: "person", label: "Person", state: person },
    { key: "research", label: "Research", state: research },
    { key: "first_message", label: "First message", state: firstMessage },
  ];
}

function base(
  partial: Omit<RecommendedNextMove, "blocked" | "prepareForce" | "watch" | "whyNow" | "evidence"> &
    Partial<Pick<RecommendedNextMove, "blocked" | "prepareForce" | "watch" | "whyNow" | "evidence">>,
): RecommendedNextMove {
  return {
    blocked: false,
    prepareForce: false,
    watch: null,
    whyNow: null,
    evidence: [],
...partial,
  };
}

/**
 * The one recommended next move for a company, derived from the eligibility
 * read, the person-readiness read, the governed preparation plan, and the
 * stored brief. The same stored evidence always produces the same move.
 *
 * `firstMessage` is the readiness read of the handoff draft behind "Prepare
 * first message". When it says the way in is gated, the move names the gate
 * instead of instructing outreach. Omitting it preserves the historical
 * read: an unexamined handoff is treated as open.
 */
export function buildRecommendedNextMove(input: {
  candidate: ProspectCandidate;
  people?: Person[];
  now?: Date;
  /** Readiness of the handoff behind "Prepare first message". */
  firstMessage?: {
    ready: boolean;
    blockers: string[];
    /**
     * The governed People record behind a lone unverified-address blocker,
     * when that is the only thing in the way. Comes from the canonical
     * handoff blockers, the move stays the decision read, this only lets it
     * offer the governed confirmation as the one action.
     */
    confirmEmailPersonId?: string;
  };
}): RecommendedNextMove {
  const { candidate } = input;
  const intel = candidate.intel ?? EMPTY_INTEL;
  const people = opportunityPeople(intel, input.people ?? []);
  const watch = candidate.development?.watch ?? null;
  const { evaluation, prospect } = candidate;

  const eligibility = relationshipResearchEligible(candidate, people);
  const entry = bestEntryPerson(people);
  const readiness = personReadiness(people);

  // The progress strip reads the same evidence the move does.
  const preparation = planRelationshipPreparation({
    candidate,
...(input.people ? { people: input.people }: {}),
...(input.now ? { now: input.now }: {}),
  });
  const research = candidate.development?.research;
  const brief: RelationshipDevelopmentBrief | undefined =
    research?.state === "prepared" ? research.brief: undefined;
  const strongFit =
    evaluation.scoreable &&
    evaluation.light !== "red" &&
    evaluation.score >= RELATIONSHIP_RESEARCH_FIT_THRESHOLD;
  const briefReady = Boolean(brief && brief.grounded) && preparation.action === "none";
  const progress = buildMoveProgress({
    inComms: prospect.status === "ready_for_comms",
    strongFit,
    personReady: readiness.state === "ready",
    briefReady,
  });

  const finish = (
    partial: Omit<
      RecommendedNextMove,
      "blocked" | "prepareForce" | "watch" | "whyNow" | "evidence" | "progress"
    > &
      Partial<Pick<RecommendedNextMove, "blocked" | "prepareForce" | "watch" | "whyNow" | "evidence">>,
  ): RecommendedNextMove => base({...partial, progress });

  // Already handed over: Scout stops behaving like outbound. The relationship
  // develops in Comms; Scout keeps the research.
  if (prospect.status === "ready_for_comms") {
    return finish({
      state: "in_comms",
      label: "Relationship developing in Comms",
      headline: `${prospect.name} is in Comms now`,
      reason:
        "The brief was carried across with its context intact. The relationship develops there, a person writes and sends every message. Scout keeps the research.",
      person: personRef(bestEntryPerson(people)),
      channel: null,
      primary: { kind: "open_in_comms", label: "Open in Comms" },
      watch,
    });
  }

  // Set aside by a person, or the fit read says this is not our company.
  if (prospect.status === "passed" || prospect.status === "archived") {
    return finish({
      state: "not_ready",
      label: "Set aside",
      headline: "Set aside by a person",
      reason: "A person decided this is not for now. The history is preserved and nothing is owed.",
      person: null,
      channel: null,
      primary: { kind: "none", label: "" },
      watch,
    });
  }
  if (evaluation.scoreable && evaluation.light === "red") {
    return finish({
      state: "not_ready",
      label: "Not our company right now",
      headline: "Fit says this is not our company right now",
      reason:
        "The evidence says this company is not a Trust Tai fit at the moment. Keeping the history is enough.",
      person: null,
      channel: null,
      primary: { kind: "none", label: "" },
      watch,
    });
  }

  // Never read against the ICP: there is no honest read to act on yet.
  if (!evaluation.scoreable) {
    const canResearch = Boolean(prospect.websiteUrl || prospect.domain);
    return finish({
      state: "not_ready",
      label: "Not yet read",
      headline: "Read the company first",
      reason:
        "Scout has not read this company's public pages yet, so there is no honest read to act on.",
      person: null,
      channel: null,
      primary: canResearch
        ? { kind: "research_company", label: "Research this company" }
: { kind: "none", label: "" },
      watch,
    });
  }

  // Strong fit, and the missing step is on the Person stage. The read names
  // the REAL missing step, never one collapsed "find the person".
  if (evaluation.score >= RELATIONSHIP_RESEARCH_FIT_THRESHOLD && !eligibility.eligible) {
    // A founder/decision maker is known, but there is no legitimate way in.
    if (readiness.state === "no_route" && readiness.person) {
      return finish({
        state: "find_route",
        label: "Find a way in",
        headline: `Find a way to reach ${readiness.person.fullName}`,
        reason:
          "We know who matters. What is missing is a legitimate professional route, a business email or a profile link, found through an approved source or added by a person.",
        person: personRef(readiness.person),
        channel: null,
        primary: { kind: "find_contact_route", label: "Find contact route" },
        watch,
      });
    }
    // A person is known, but their relationship to this decision is not.
    if (readiness.state === "role_unestablished" && readiness.person) {
      return finish({
        state: "confirm_decider",
        label: "Confirm who decides",
        headline: `Confirm whether ${readiness.person.fullName} is the right person`,
        reason: `${readiness.person.fullName} is on record${
          readiness.person.roleTitle ? ` as ${readiness.person.roleTitle}`: ""
        }, but their relationship to this decision is not established. Confirming who decides comes before any research or message.`,
        person: personRef(readiness.person),
        channel: null,
        primary: { kind: "confirm_decision_maker", label: "Confirm decision maker" },
        watch,
      });
    }
    // Nobody named at all: find the founder.
    return finish({
      state: "find_person",
      label: "Find the founder",
      headline: "Find the founder or decision maker",
      reason: `Fit is ${evaluation.score}%, a strong company match, but we do not yet know who matters. Scout never writes to a company anonymously.`,
      person: null,
      channel: null,
      primary: { kind: "find_person", label: "Find the founder" },
      watch,
    });
  }

  // Below the line: watching for new evidence is the honest move.
  if (!eligibility.eligible) {
    return finish({
      state: "not_ready",
      label: "Below the line",
      headline: "Keep this on the board",
      reason: `Fit is ${evaluation.score}%, below the ${RELATIONSHIP_RESEARCH_FIT_THRESHOLD}% line for relationship development. Watching for new evidence is the honest move.`,
      person: personRef(entry),
      channel: null,
      primary: { kind: "none", label: "" },
      watch,
    });
  }

  // Eligible from here: 60%+ fit AND a traceable founder/decision maker.
  const firstMessage = input.firstMessage;

  // The way in exists but is unverified, and that is the ONLY thing in the
  // way: the one action is the governed confirmation itself, a person's
  // click that makes the address safely reachable, never a generic link.
  if (
    readiness.state === "route_unverified" &&
    readiness.person?.recordId &&
    firstMessage &&
    !firstMessage.ready &&
    firstMessage.blockers.length === 1 &&
    firstMessage.confirmEmailPersonId === readiness.person.recordId
  ) {
    const name = readiness.person.fullName;
    return finish({
      state: "verify_route",
      label: "The way in is unverified",
      headline: "Verify the way in",
      reason: `A business email is on record for ${name}, but no person has confirmed it is real yet. That confirmation is what makes it safely reachable, and nothing is ever sent from Scout.`,
      person: personRef(readiness.person),
      channel: null,
      primary: { kind: "confirm_email", label: "Confirm this address" },
      blocked: true,
      watch,
      evidence: [
        { label: `ICP fit ${evaluation.score}%`, kind: "computed" },
        {
          label: `${name} identified${readiness.person.roleTitle ? ` as ${readiness.person.roleTitle}`: " as a decision maker"}`,
          kind: "computed",
        },
        { label: "Business email found but unverified", kind: "computed" },
      ],
    });
  }

  // The governed research step is never skipped: a missing or stale brief
  // means understand them first. An ungrounded brief, nothing real to
  // notice, fails closed into a forced fresh read.
  if (preparation.action === "prepare" || preparation.action === "refresh") {
    return finish({
      state: "research_first",
      label: "Understand them first",
      headline: `Understand ${entry!.fullName.split(/\s+/)[0]} before writing`,
      reason: `${entry!.fullName} is on record${entry!.roleTitle ? ` as ${entry!.roleTitle}`: ""}, but the relationship brief ${
        research?.state === "prepared"
          ? "is stale and needs a fresh read"
: "has not been prepared yet"
      }. Understand them first, drafting waits for that governed read.`,
      person: personRef(entry),
      channel: null,
      primary: { kind: "prepare_research", label: "Prepare research" },
      watch,
    });
  }

  if (brief && !brief.grounded) {
    return finish({
      state: "research_first",
      label: "Understand them first",
      headline: `Understand ${entry!.fullName.split(/\s+/)[0]} before writing`,
      reason:
        "The prepared brief found nothing real enough to notice yet. A fresh read of the public evidence comes before anyone drafts a word.",
      person: personRef(entry),
      channel: null,
      primary: { kind: "prepare_research", label: "Prepare research" },
      prepareForce: true,
      watch,
    });
  }

  // Brief ready. The channel comes only from what is legitimately on record;
  // text is never recommended here.
  const channel = recommendChannel({ person: entry });
  const opportunity = computeRelationshipOpportunity({
    candidate,
    intel,
...(input.people ? { people: input.people }: {}),
...(input.now ? { now: input.now }: {}),
  });
  const name = entry!.fullName;
  const notice =
    brief?.whatTaiCanNotice ?? intel.opportunities[0]?.statement ?? candidate.signals[0]?.statement ?? null;

  // Concise supporting evidence, facts, not another prose interpretation:
  // the fit, the person, what was noticed, the way in, and the urgency read.
  const evidence: EvidenceRef[] = [
    { label: `ICP fit ${evaluation.score}%`, kind: "computed" },
    {
      label: `${name} identified${entry!.roleTitle ? ` as ${entry!.roleTitle}`: " as a decision maker"}`,
      kind: "computed",
    },
  ];
  if (notice) evidence.push({ label: notice, kind: "computed" });
  if (channel?.channel === "email") {
    evidence.push({
      label: entry!.emailVerified
        ? "Business email verified"
: "Business email found but unverified",
      kind: "computed",
    });
  }
  if (!opportunity.whyNow) {
    evidence.push({ label: "No dated signal on record", kind: "computed" });
  }
  for (const item of brief?.evidenceUsed ?? []) {
    if (!evidence.some((existing) => existing.label === item.label)) evidence.push(item);
  }

  // Readiness of the handoff behind the first message. A gated way in never
  // reads as "start outreach", the move names the gate and the one action
  // is resolving what stands in the way.
  const blocked = Boolean(firstMessage && !firstMessage.ready);
  const blockers = firstMessage?.blockers ?? [];
  const blockerSentence =
    blockers.length > 0 ? ` Still in the way: ${blockers.join(" ")}`: "";
  const resolution =
    blockers.length > 0
      ? ` Clear ${blockers.length === 1 ? "it": blockers.length === 2 ? "both": `all ${blockers.length}`} and the first message opens up.`
: "";
  const primary = blocked
    ? { kind: "resolve_blockers" as const, label: blockerLabel(blockers.length) }
: { kind: "prepare_first_message" as const, label: "Prepare first message" };
  const headline = blocked
    ? blockedHeadline(channel, name)
: channel
      ? (CHANNEL_MOVE[channel.channel] ?? ((n: string) => `Reach out to ${n}`))(name)
: `Reach out to ${name}`;

  // A real dated signal: worth knowing now, with the signal cited.
  if (opportunity.whyNow) {
    return finish({
      state: "act_now",
      label: "Worth knowing now",
      headline,
      reason: `${opportunity.whyNow}, a real, dated reason to reach out.${
        channel ? ` ${channel.reason}`: ""
      }${blocked ? `${blockerSentence}${resolution}`: " Keep it useful; the goal is the next natural exchange, not a meeting."}`,
      person: personRef(entry),
      channel,
      primary,
      blocked,
      watch,
      whyNow: opportunity.whyNow,
      evidence: evidence.slice(0, 5),
    });
  }

  // No dated urgency: say so honestly and keep the posture light.
  return finish({
    state: "no_urgency",
    label: "Worth knowing, no urgency",
    headline,
    reason: `${name} is a credible person with a useful opening${
      notice ? `, ${notice}`: ""
    }.${channel ? ` ${channel.reason}`: ""}${
      blocked
        ? `${blockerSentence}${resolution}`
: " Nothing is time-sensitive, so keep the first message light and useful: earn the next exchange, not a call."
    }`,
    person: personRef(entry),
    channel,
    primary,
    blocked,
    watch,
    evidence: evidence.slice(0, 5),
  });
}
