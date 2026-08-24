/**
 * Scout, the recommended next move.
 *
 * The company page answers one question at a time: what should happen next?
 * This is the single canonical read behind that answer — one move, one clear
 * reason, one primary action — computed from evidence Scout already holds.
 * Pure and deterministic, so every state can be proved in a test. Nothing
 * here fetches, sends, drafts, or mutates.
 *
 * Laws enforced here:
 *  - 60%+ ICP fit triggers deeper research, never outreach.
 *  - A strong-fit company with no traceable founder/decision maker is "find
 *    the person first", never "prepare a message".
 *  - A traceable person with a missing or stale brief is "understand them
 *    first" — drafting never skips the governed research step.
 *  - A ready brief with no dated signal is "worth knowing — no urgency".
 *    Urgency is never manufactured.
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

export type RecommendedMoveState =
  /** Handed over; the relationship develops in Comms now. */
  | "in_comms"
  /** Strong fit, but no traceable founder/decision maker with a way in. */
  | "find_person"
  /** A person is on record, but the governed brief is missing or stale. */
  | "research_first"
  /** Eligible, brief ready, no dated reason to act. Urgency is not manufactured. */
  | "no_urgency"
  /** Eligible, brief ready, and a real dated signal exists. */
  | "act_now"
  /** Below the line, unread, or set aside — no relationship move is honest yet. */
  | "not_ready";

export type RecommendedMoveAction =
  | "open_in_comms"
  | "find_person"
  | "prepare_research"
  | "prepare_first_message"
  | "research_company"
  | "none";

export interface RecommendedNextMove {
  state: RecommendedMoveState;
  /** The calm state label, e.g. "Worth knowing — no urgency". */
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
}

const CHANNEL_MOVE: Record<string, (name: string) => string> = {
  email: (name) => `Start with email to ${name}`,
  linkedin: (name) => `Start on LinkedIn with ${name}`,
};

function personRef(
  person: { fullName: string; roleTitle?: string } | null,
): RecommendedNextMove["person"] {
  if (!person) return null;
  return {
    fullName: person.fullName,
    ...(person.roleTitle ? { roleTitle: person.roleTitle } : {}),
  };
}

function base(
  partial: Omit<RecommendedNextMove, "prepareForce" | "watch" | "whyNow" | "evidence"> &
    Partial<Pick<RecommendedNextMove, "prepareForce" | "watch" | "whyNow" | "evidence">>,
): RecommendedNextMove {
  return {
    prepareForce: false,
    watch: null,
    whyNow: null,
    evidence: [],
    ...partial,
  };
}

/**
 * The one recommended next move for a company, derived from the eligibility
 * read, the governed preparation plan, and the stored brief. The same stored
 * evidence always produces the same move.
 */
export function buildRecommendedNextMove(input: {
  candidate: ProspectCandidate;
  people?: Person[];
  now?: Date;
}): RecommendedNextMove {
  const { candidate } = input;
  const intel = candidate.intel ?? EMPTY_INTEL;
  const people = opportunityPeople(intel, input.people ?? []);
  const watch = candidate.development?.watch ?? null;
  const { evaluation, prospect } = candidate;

  // Already handed over: Scout stops behaving like outbound. The relationship
  // develops in Comms; Scout keeps the research.
  if (prospect.status === "ready_for_comms") {
    return base({
      state: "in_comms",
      label: "Relationship developing in Comms",
      headline: `${prospect.name} is in Comms now`,
      reason:
        "The brief was carried across with its context intact. The relationship develops there — a person writes and sends every message. Scout keeps the research.",
      person: personRef(bestEntryPerson(people)),
      channel: null,
      primary: { kind: "open_in_comms", label: "Open in Comms" },
      watch,
    });
  }

  // Set aside by a person, or the fit read says this is not our company.
  if (prospect.status === "passed" || prospect.status === "archived") {
    return base({
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
    return base({
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

  const eligibility = relationshipResearchEligible(candidate, people);
  const entry = bestEntryPerson(people);

  // Never read against the ICP: there is no honest read to act on yet.
  if (!evaluation.scoreable) {
    const canResearch = Boolean(prospect.websiteUrl || prospect.domain);
    return base({
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

  // Strong fit, but the actionable queue is people — never anonymous companies.
  if (evaluation.score >= RELATIONSHIP_RESEARCH_FIT_THRESHOLD && !eligibility.eligible) {
    return base({
      state: "find_person",
      label: "Find the person first",
      headline: "Find the person first",
      reason: `Fit is ${evaluation.score}% — strong. But no founder or decision maker with a legitimate way in is on record, so there is nobody to write to yet.`,
      person: null,
      channel: null,
      primary: { kind: "find_person", label: "Find the person" },
      watch,
    });
  }

  // Below the line: watching for new evidence is the honest move.
  if (!eligibility.eligible) {
    return base({
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
  const preparation = planRelationshipPreparation({
    candidate,
    ...(input.people ? { people: input.people } : {}),
    ...(input.now ? { now: input.now } : {}),
  });
  const research = candidate.development?.research;
  const brief: RelationshipDevelopmentBrief | undefined =
    research?.state === "prepared" ? research.brief : undefined;

  // The governed research step is never skipped: a missing or stale brief
  // means understand them first. An ungrounded brief — nothing real to
  // notice — fails closed into a forced fresh read.
  if (preparation.action === "prepare" || preparation.action === "refresh") {
    return base({
      state: "research_first",
      label: "Understand them first",
      headline: "Understand them first",
      reason: `${entry!.fullName} is on record${entry!.roleTitle ? ` as ${entry!.roleTitle}` : ""}, but the relationship brief ${
        research?.state === "prepared"
          ? "is stale and needs a fresh read"
          : "has not been prepared yet"
      }. Understand them first — drafting waits for that governed read.`,
      person: personRef(entry),
      channel: null,
      primary: { kind: "prepare_research", label: "Prepare research" },
      watch,
    });
  }

  if (brief && !brief.grounded) {
    return base({
      state: "research_first",
      label: "Understand them first",
      headline: "Understand them first",
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
    ...(input.people ? { people: input.people } : {}),
    ...(input.now ? { now: input.now } : {}),
  });
  const name = entry!.fullName;
  const headline = channel
    ? (CHANNEL_MOVE[channel.channel] ?? ((n: string) => `Reach out to ${n}`))(name)
    : `Reach out to ${name}`;
  const notice =
    brief?.whatTaiCanNotice ?? intel.opportunities[0]?.statement ?? candidate.signals[0]?.statement ?? null;
  const evidence = brief?.evidenceUsed ?? [];

  // A real dated signal: worth knowing now, with the signal cited.
  if (opportunity.whyNow) {
    return base({
      state: "act_now",
      label: "Worth knowing now",
      headline,
      reason: `${opportunity.whyNow} — a real, dated reason to reach out.${
        channel ? ` ${channel.reason}` : ""
      } Keep it useful; the goal is the next natural exchange, not a meeting.`,
      person: personRef(entry),
      channel,
      primary: { kind: "prepare_first_message", label: "Prepare first message" },
      watch,
      whyNow: opportunity.whyNow,
      evidence,
    });
  }

  // No dated urgency: say so honestly and keep the posture light.
  return base({
    state: "no_urgency",
    label: "Worth knowing — no urgency",
    headline,
    reason: `${name} is a credible person with a useful opening${
      notice ? ` — ${notice}` : ""
    }.${channel ? ` ${channel.reason}` : ""} Nothing is time-sensitive, so keep the first message light and useful: earn the next exchange, not a call.`,
    person: personRef(entry),
    channel,
    primary: { kind: "prepare_first_message", label: "Prepare first message" },
    watch,
    evidence,
  });
}
