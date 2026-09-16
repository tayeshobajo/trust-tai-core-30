/**
 * One client, the whole path, read from the rooms that own each stage.
 *
 * Eight people need the same answer without opening eight tabs: which stage is
 * this client at, what has to be true to enter it, what it produces, who owns
 * it, when it is due if a person confirmed a date, and what is in the way.
 *
 * Every line here is composed from a record another room already wrote. When a
 * room could not be read, that stage says so. An unread room is never rendered
 * as an empty one, and a stage is never marked accepted because the system
 * guessed. Dates appear only where a person recorded one.
 */

import { stageContract, type JourneyStage } from "./agency-journey";
import type { ID } from "./entities";
import type { ExecutionProject } from "./projects";
import { isOpenProject, type RoadmapOutcome, type RoomRead } from "./client-shell";

export type StageState =
  /** Nothing recorded for this stage yet. */
  | "not_started"
  /** Work exists and is moving. */
  | "in_progress"
  /** A person accepted the stage outcome. */
  | "accepted"
  /** Work exists but something named is stopping it. */
  | "blocked"
  /** The owning room could not be read. */
  | "unreadable";

export const STAGE_STATE_WORD: Record<StageState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  accepted: "Accepted",
  blocked: "Blocked",
  unreadable: "Could not be read",
};

export interface StageProgress {
  stage: JourneyStage;
  label: string;
  /** What must be true before this stage can do useful work. */
  entry: string;
  /** What the stage produces when it succeeds. */
  expected: string;
  /** Who decides the outcome happened. Always a person. */
  decidedBy: string;
  state: StageState;
  /** Plain sentence for why the state is what it is. */
  because: string;
  /** The next practical move, or null when the stage needs nothing. */
  nextAction: string | null;
  /** A named person, or null when nobody is recorded. */
  owner: string | null;
  /** Only a date a person confirmed. Never inferred. */
  dueAt: string | null;
  evidenceHref?: string;
  evidenceLabel?: string;
}

export interface ProposalFacts {
  id: ID;
  title: string;
  sentAt: string | null;
  outcome: "open" | "signed" | "declined" | null;
  amountCents: number | null;
}

export interface ClientJourneyInput {
  clientId: ID;
  /** Contactable people and last exchange, from Comms. */
  relationship: RoomRead<{ peopleCount: number; lastExchangeAt: string | null }> | null;
  roadmap: RoomRead<RoadmapOutcome | null> | null;
  proposals: RoomRead<ProposalFacts[]> | null;
  /** Commercial truth on the client row. */
  commercial: RoomRead<{
    tier: string | null;
    mrrCents: number | null;
    nextReviewAt: string | null;
    renewalAt: string | null;
    recordedAt: string | null;
  }> | null;
  projects: RoomRead<ExecutionProject[]> | null;
}

const STAGES: JourneyStage[] = [
  "qualify",
  "discovery",
  "roadmap",
  "proposal",
  "agreement",
  "delivery",
  "care",
];

type Answer = Pick<StageProgress, "state" | "because" | "nextAction" | "owner" | "dueAt"> &
  Partial<Pick<StageProgress, "evidenceHref" | "evidenceLabel">>;

const WAITING: Answer = {
  state: "not_started",
  because: "Still reading this room.",
  nextAction: null,
  owner: null,
  dueAt: null,
};

/** Keep "not asked yet", "read and empty" and "read and failed" apart. */
function answerFrom<T>(read: RoomRead<T> | null, when: (value: T) => Answer): Answer {
  if (read === null) return WAITING;
  if (!read.available) {
    return {
      state: "unreadable",
      because: read.because,
      nextAction: "Try this room again, or ask someone with access.",
      owner: null,
      dueAt: null,
    };
  }
  return when(read.value);
}

function qualify(input: ClientJourneyInput): Answer {
  return answerFrom(input.relationship, (relationship) =>
    relationship.peopleCount > 0
      ? {
          state: "accepted",
          because: `${relationship.peopleCount} contactable ${
            relationship.peopleCount === 1 ? "person" : "people"
          } on record.`,
          nextAction: null,
          owner: null,
          dueAt: null,
          evidenceHref: "/modules/comms/relationships",
          evidenceLabel: "Relationships",
        }
      : {
          state: "not_started",
          because: "No contactable person is recorded for this company.",
          nextAction: "Add the person you actually speak to, in Comms.",
          owner: null,
          dueAt: null,
          evidenceHref: "/modules/comms/relationships",
          evidenceLabel: "Relationships",
        },
  );
}

function discovery(input: ClientJourneyInput): Answer {
  return answerFrom(input.relationship, (relationship) =>
    relationship.lastExchangeAt
      ? {
          state: "in_progress",
          because: `Last exchange ${relationship.lastExchangeAt.slice(0, 10)}.`,
          nextAction: null,
          owner: null,
          dueAt: null,
          evidenceHref: "/modules/comms/conversations",
          evidenceLabel: "Conversations",
        }
      : {
          state: "not_started",
          because: "No two-way exchange is recorded yet.",
          nextAction: "Open the conversation and record what they need.",
          owner: null,
          dueAt: null,
          evidenceHref: "/modules/comms/conversations",
          evidenceLabel: "Conversations",
        },
  );
}

function roadmapStage(input: ClientJourneyInput): Answer {
  return answerFrom(input.roadmap, (outcome) => {
    if (!outcome) {
      return {
        state: "not_started",
        because: "No roadmap exists for this client.",
        nextAction: "Draft the path from where they are to where they want to be.",
        owner: null,
        dueAt: null,
        evidenceHref: "/modules/roadmap",
        evidenceLabel: "Roadmap",
      };
    }
    const link = {
      evidenceHref: `/modules/roadmap/${outcome.roadmapId}`,
      evidenceLabel: outcome.title,
    };
    if (outcome.openDecisions > 0) {
      return {
        state: "blocked",
        because: `${outcome.openDecisions} decision${
          outcome.openDecisions === 1 ? "" : "s"
        } waiting on a person.`,
        nextAction: "Answer the open roadmap decisions.",
        owner: null,
        dueAt: null,
        ...link,
      };
    }
    return {
      state: outcome.destinationTier === "decided" ? "accepted" : "in_progress",
      because:
        outcome.destinationTier === "decided"
          ? "A person approved the destination."
          : "Drafted, but the destination is not approved yet.",
      nextAction: outcome.destinationTier === "decided" ? null : "Get the destination approved.",
      owner: null,
      dueAt: null,
      ...link,
    };
  });
}

function proposalStage(input: ClientJourneyInput): Answer {
  return answerFrom(input.proposals, (proposals) => {
    const mine = proposals.filter((proposal) => proposal.sentAt !== null);
    const latest = mine[0];
    if (!latest) {
      return {
        state: proposals.length > 0 ? "in_progress" : "not_started",
        because:
          proposals.length > 0
            ? "A proposal exists but nobody has recorded it as sent."
            : "No proposal recorded.",
        nextAction: "Record the proposal once a person has sent it.",
        owner: null,
        dueAt: null,
        evidenceHref: `/modules/clients/${input.clientId}?tab=commercial`,
        evidenceLabel: "Commercial",
      };
    }
    const link = {
      evidenceHref: `/modules/clients/${input.clientId}?tab=commercial`,
      evidenceLabel: latest.title,
    };
    if (latest.outcome === "signed") {
      return {
        state: "accepted",
        because: "A person recorded this proposal as accepted.",
        nextAction: null,
        owner: null,
        dueAt: null,
        ...link,
      };
    }
    if (latest.outcome === "declined") {
      return {
        state: "blocked",
        because: "Recorded as declined.",
        nextAction: "Decide whether this client is closed or reopened.",
        owner: null,
        dueAt: null,
        ...link,
      };
    }
    return {
      state: "in_progress",
      because: `Sent ${latest.sentAt?.slice(0, 10)}, no decision recorded.`,
      nextAction: "Record their answer when it arrives.",
      owner: null,
      dueAt: null,
      ...link,
    };
  });
}

function agreement(input: ClientJourneyInput): Answer {
  return answerFrom(input.commercial, (commercial) =>
    commercial.tier
      ? {
          state: "accepted",
          because: `On the book as ${commercial.tier}${
            commercial.recordedAt ? `, recorded ${commercial.recordedAt.slice(0, 10)}` : ""
          }.`,
          nextAction: null,
          owner: null,
          dueAt: null,
          evidenceHref: `/modules/clients/${input.clientId}?tab=commercial`,
          evidenceLabel: "Commercial",
        }
      : {
          state: "not_started",
          because: "No tier or agreed commercial state is recorded.",
          nextAction: "Record the agreed scope and tier once a person has accepted it.",
          owner: null,
          dueAt: null,
          evidenceHref: `/modules/clients/${input.clientId}?tab=commercial`,
          evidenceLabel: "Commercial",
        },
  );
}

function delivery(input: ClientJourneyInput): Answer {
  return answerFrom(input.projects, (projects) => {
    if (projects.length === 0) {
      return {
        state: "not_started",
        because: "No delivery workspace exists for this client.",
        nextAction: "Open delivery from the approved scope.",
        owner: null,
        dueAt: null,
        evidenceHref: "/modules/projects",
        evidenceLabel: "Projects",
      };
    }
    const open = projects.filter(isOpenProject);
    const blocked = open.find((entry) => entry.state === "blocked");
    const project = blocked ?? open[0] ?? projects[0]!;
    const owner =
      typeof project.ownerLabel === "string" && project.ownerLabel.trim()
        ? project.ownerLabel
        : null;
    const link = {
      evidenceHref: `/modules/projects/${project.id}`,
      evidenceLabel: project.name,
    };
    /* A person agreed this date, so it is the only date shown. */
    const dueAt = typeof project.dueDate === "string" ? project.dueDate : null;
    if (blocked) {
      return {
        state: "blocked",
        because: blocked.blockedBecause?.trim() || "Delivery is recorded as blocked.",
        nextAction: owner ? "Clear the block with the named owner." : "Give the blocked work an owner.",
        owner,
        dueAt,
        ...link,
      };
    }
    return {
      state: open.length > 0 ? "in_progress" : "accepted",
      because:
        open.length > 0
          ? `${open.length} open ${open.length === 1 ? "project" : "projects"}.`
          : "All recorded delivery is closed.",
      nextAction: open.length > 0 && !owner ? "Give the open work a named owner." : null,
      owner,
      dueAt,
      ...link,
    };
  });
}

function care(input: ClientJourneyInput): Answer {
  return answerFrom(input.commercial, (commercial) => {
    const link = {
      evidenceHref: `/modules/clients/${input.clientId}?tab=commercial`,
      evidenceLabel: "Review cadence",
    };
    if (commercial.nextReviewAt) {
      return {
        state: "in_progress",
        because: `Next review recorded for ${commercial.nextReviewAt.slice(0, 10)}.`,
        nextAction: null,
        owner: null,
        dueAt: commercial.nextReviewAt,
        ...link,
      };
    }
    return {
      state: "not_started",
      because: "No review date is recorded.",
      nextAction: "Book the outcome review with the client owner.",
      owner: null,
      dueAt: null,
      ...link,
    };
  });
}

const ANSWERS: Record<JourneyStage, (input: ClientJourneyInput) => Answer> = {
  source: qualify,
  qualify,
  discovery,
  roadmap: roadmapStage,
  proposal: proposalStage,
  agreement,
  delivery,
  care,
};

/** The stage-by-stage read, always in the same order. */
export function clientJourneyProgress(input: ClientJourneyInput): StageProgress[] {
  return STAGES.map((stage) => {
    const contract = stageContract(stage);
    const answer = ANSWERS[stage](input);
    return {
      stage,
      label: contract.label,
      entry: contract.inputs.join(", "),
      expected: contract.outcome,
      decidedBy: contract.decisionOwner,
      ...answer,
    } satisfies StageProgress;
  });
}

/**
 * The stage a person should look at first: the earliest one that is blocked,
 * unreadable, or simply not finished. Null when every stage is accepted.
 */
export function currentJourneyStage(progress: StageProgress[]): StageProgress | null {
  return (
    progress.find((entry) => entry.state === "blocked" || entry.state === "unreadable") ??
    progress.find((entry) => entry.state !== "accepted") ??
    null
  );
}
