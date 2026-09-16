/**
 * What a conversation actually left us with.
 *
 * A brief is a short, grounded read of one client's conversation: the goal,
 * what is known, what is still open, what was said about who does what, and
 * the one next move. It changes nothing on its own.
 *
 * Three rules hold it honest:
 *
 * 1. Every line is grounded in a source from the same client. A line whose
 *    source belongs to another client is dropped, never quietly reused.
 * 2. Something someone proposed is not something anyone agreed. Only a named
 *    person turns a proposal into a commitment.
 * 3. Mail arriving, or being unread, is not a reply owed. A reply is owed when
 *    they asked us something we have not answered.
 */

import type { ID, ISODateTime } from "./entities";
import type { Obligation } from "./comms-obligations";

/* ---------------------------------------------------------------- sources */

/** Events a brief may legitimately be prepared from. */
export type BriefSourceKind = "email_thread" | "meeting_note" | "call_note";

export interface BriefSource {
  sourceId: string;
  kind: BriefSourceKind;
  /** The client this material belongs to. Grounding is checked against it. */
  clientRef: string;
  label: string;
  occurredAt: ISODateTime;
  /** Exactly as recorded. Never rewritten, always reachable from the brief. */
  rawText: string;
}

export type BriefLineTier = "fact" | "open_question" | "inference";

export interface BriefLine {
  tier: BriefLineTier;
  statement: string;
  /** Source ids this line rests on. An ungrounded line cannot exist. */
  groundedIn: string[];
}

/* ------------------------------------------------------------ commitments */

export type CommitmentState = "proposed" | "confirmed";

export interface Commitment {
  id: string;
  /** What someone would do. Written as work, not as a promise made. */
  statement: string;
  state: CommitmentState;
  /** Who it would fall to, when that was actually said. */
  ownerLabel: string | null;
  /** Only ever set by a person accepting it. */
  confirmedBy?: ID;
  confirmedByLabel?: string;
  confirmedAt?: ISODateTime;
  dueAt?: ISODateTime;
  groundedIn: string[];
}

export interface ConversationBrief {
  key: string;
  organizationId: ID;
  clientRef: string;
  /** What this conversation is trying to achieve, in one line. */
  goal: BriefLine | null;
  knownFacts: BriefLine[];
  openQuestions: BriefLine[];
  commitments: Commitment[];
  /** The single suggested next move. A suggestion, never a decision. */
  nextMove: BriefLine | null;
  sources: { sourceId: string; label: string; occurredAt: ISODateTime }[];
  preparedAt: ISODateTime;
  /** Named when something could not be grounded and was left out. */
  droppedBecause: string[];
}

export function briefKey(organizationId: ID, clientRef: string, sourceIds: string[]): string {
  return `${organizationId}::brief::${clientRef}::${[...sourceIds].sort().join("+")}`;
}

/** Sources that belong to this client and can honestly be read. */
export function eligibleSources(clientRef: string, sources: BriefSource[]) {
  const eligible = sources.filter(
    (source) => source.clientRef === clientRef && source.rawText.trim().length > 0,
  );
  const rejected = sources
    .filter((source) => !eligible.includes(source))
    .map((source) =>
      source.clientRef === clientRef
        ? `${source.label} has nothing recorded in it.`
        : `${source.label} belongs to another client and was not read.`,
    );
  return { eligible, rejected };
}

/**
 * Assemble a brief. Lines and commitments arrive already drafted; this keeps
 * only what is grounded in this client's own sources.
 */
export function assembleBrief(input: {
  organizationId: ID;
  clientRef: string;
  sources: BriefSource[];
  goal?: BriefLine | null;
  knownFacts?: BriefLine[];
  openQuestions?: BriefLine[];
  commitments?: Commitment[];
  nextMove?: BriefLine | null;
  preparedAt: ISODateTime;
}): ConversationBrief {
  const { eligible, rejected } = eligibleSources(input.clientRef, input.sources);
  const allowed = new Set(eligible.map((source) => source.sourceId));
  const dropped: string[] = [...rejected];

  const grounded = <T extends { groundedIn: string[] }>(items: T[], what: string): T[] =>
    items.filter((item) => {
      const ok = item.groundedIn.length > 0 && item.groundedIn.every((ref) => allowed.has(ref));
      if (!ok) dropped.push(`A ${what} was left out because it was not grounded in this client's own record.`);
      return ok;
    });

  const goalOk =
    input.goal && input.goal.groundedIn.length > 0 && input.goal.groundedIn.every((ref) => allowed.has(ref));
  const nextOk =
    input.nextMove &&
    input.nextMove.groundedIn.length > 0 &&
    input.nextMove.groundedIn.every((ref) => allowed.has(ref));

  return {
    key: briefKey(input.organizationId, input.clientRef, eligible.map((source) => source.sourceId)),
    organizationId: input.organizationId,
    clientRef: input.clientRef,
    goal: goalOk ? input.goal! : null,
    knownFacts: grounded(input.knownFacts ?? [], "fact"),
    openQuestions: grounded(input.openQuestions ?? [], "question"),
    commitments: grounded(input.commitments ?? [], "commitment").map((commitment) =>
      // Nothing arrives already confirmed. A person confirms it, later, by name.
      commitment.state === "confirmed" && !commitment.confirmedBy
        ? { ...commitment, state: "proposed" as const }
        : commitment,
    ),
    nextMove: nextOk ? input.nextMove! : null,
    sources: eligible.map((source) => ({
      sourceId: source.sourceId,
      label: source.label,
      occurredAt: source.occurredAt,
    })),
    preparedAt: input.preparedAt,
    droppedBecause: [...new Set(dropped)],
  };
}

/* ------------------------------------------------------- accepting the work */

export interface AcceptedTask {
  key: string;
  briefKey: string;
  commitmentId: string;
  /** The wording as prepared. The owner never retypes it to accept it. */
  statement: string;
  ownerUserId: ID;
  ownerLabel: string;
  acceptedAt: ISODateTime;
  dueAt?: ISODateTime;
  groundedIn: string[];
}

export type AcceptOutcome =
  | { accepted: true; task: AcceptedTask; commitment: Commitment }
  | { accepted: false; because: string };

/**
 * A named person takes a proposed commitment on. The wording, the sources and
 * the date come across untouched; the person supplies only their name.
 */
export function acceptCommitment(input: {
  brief: ConversationBrief;
  commitmentId: string;
  by: { userId: ID; label: string };
  at: ISODateTime;
  existingKeys?: string[];
}): AcceptOutcome {
  const commitment = input.brief.commitments.find((entry) => entry.id === input.commitmentId);
  if (!commitment) return { accepted: false, because: "That piece of work is not in this brief." };
  if (commitment.state === "confirmed") {
    return { accepted: false, because: "Someone has already taken this on." };
  }
  if (!input.by.userId.trim()) return { accepted: false, because: "Say who is taking this on." };

  const key = `${input.brief.key}::task::${commitment.id}`;
  if ((input.existingKeys ?? []).includes(key)) {
    return { accepted: false, because: "This work already exists." };
  }

  return {
    accepted: true,
    commitment: {
      ...commitment,
      state: "confirmed",
      confirmedBy: input.by.userId,
      confirmedByLabel: input.by.label,
      confirmedAt: input.at,
      ownerLabel: input.by.label,
    },
    task: {
      key,
      briefKey: input.brief.key,
      commitmentId: commitment.id,
      statement: commitment.statement,
      ownerUserId: input.by.userId,
      ownerLabel: input.by.label,
      acceptedAt: input.at,
      ...(commitment.dueAt ? { dueAt: commitment.dueAt } : {}),
      groundedIn: commitment.groundedIn,
    },
  };
}

/* ------------------------------------------------------------- reply owed */

export interface ReplyOwedRead {
  owed: boolean;
  because: string;
}

/**
 * A reply is owed when they asked something that is still unanswered. Arrival,
 * unread state and our own silence about nothing are not obligations.
 */
export function replyOwed(input: {
  theyWroteLast: boolean;
  unread: boolean;
  obligations: Obligation[];
  answeredObligationIds: string[];
  /** False when no completed review stands behind the answered list. */
  evaluated: boolean;
}): ReplyOwedRead {
  const outstanding = input.obligations.filter(
    (obligation) => !input.answeredObligationIds.includes(obligation.id),
  );
  if (input.obligations.length === 0) {
    return {
      owed: false,
      because: input.theyWroteLast
        ? "They wrote last, but they did not ask anything."
        : "Nothing was asked of us.",
    };
  }
  if (!input.evaluated) {
    return {
      owed: false,
      because: "Their asks have not been looked at yet, so we cannot say a reply is owed.",
    };
  }
  if (outstanding.length === 0) {
    return { owed: false, because: "Everything they asked has been answered." };
  }
  return {
    owed: true,
    because:
      outstanding.length === 1
        ? "One thing they asked is still unanswered."
        : `${outstanding.length} things they asked are still unanswered.`,
  };
}
