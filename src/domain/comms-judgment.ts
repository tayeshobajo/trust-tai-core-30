/**
 * The communication-judgment contract.
 *
 * Spirit first. Reason first. Write second. Comms does not generate messages:
 * it makes a relationship-specific communication judgment over the governed
 * evidence, who this person is, why Tai is writing now, what they are likely
 * carrying, what the thread actually said, what is owed, under Tai's
 * canonical relationship voice, and then writes the one message that judgment
 * requires. The judgment is persisted on the draft's rationale, so every
 * draft carries its provenance: why it exists, what it was allowed to say,
 * what it was told never to claim, and which voice shaped it.
 *
 * Conversation before conversion. The judgment reads the room before it
 * considers any next step: notice the human signal in the latest message,
 * understand what it says about the person, reflect it back so they feel
 * recognized rather than targeted, build on the most interesting thing they
 * offered, and only then decide whether an ask is earned. The operational
 * law: don't look for the fastest way to the next step; look for the most
 * human thing worth responding to. A relationship can be moving even when
 * there is no ask.
 *
 * A judgment is a concise product-level rationale, never hidden
 * chain-of-thought. A person can read it in a few lines, why now, what I
 * noticed, what it says about them, what to build on, and the ask decision, * and decide whether the draft deserves to exist.
 *
 * Pure and I/O-free: the server assembles and writes it, the composer reads
 * and renders it, and tests pin the rules.
 */

/* ---------------------------------------------------------- the judgment */

/**
 * Whether an ask belongs in this message at all, and why. An ask is earned
 * by the conversation or it does not exist: "whyNatural" must name the gate
 * condition the ask satisfies (they suggested talking, a real question needs
 * discussion, reciprocal exploration or curiosity, it makes their life
 * easier, the conversation arrived there). "Maintain momentum" and "stay
 * connected" fail the gate. When shouldAsk is false, whyNatural says why no
 * ask belongs, and the writing pass must not sneak one in.
 */
export interface AskDecision {
  shouldAsk: boolean;
  /** Why the ask feels natural to them right now, or why no ask belongs. */
  whyNatural: string;
  /** The proportionate ask. Empty when no ask belongs in this message. */
  what: string;
}

export interface CommunicationJudgment {
  /** Why Tai is writing now, in one plain sentence grounded in evidence. */
  whyNow: string;
  /** The human signal in their latest message: generosity, pride, curiosity,
      care, excitement, vulnerability, what they just revealed. */
  latestHumanSignal: string;
  /** The quality or meaning underneath the signal, what it says about them. */
  whatThisSaysAboutThem: string;
  /** The specific thing to reflect back so they feel recognized, not praised. */
  whatDeservesAcknowledgment: string;
  /** The most interesting thread they just offered to continue. May be empty
      when the right move is simply to close warmly. */
  threadToBuildOn: string;
  /** What Tai wants them to feel when they finish reading. */
  intendedEffect: string;
  /** Any question or point in their latest message that plainly requires an answer. */
  responseObligation: string;
  /** The ask gate, decided last, after the conversation has been read. */
  askDecision: AskDecision;
  /** Evidence the draft may reference as fact. */
  factsAllowed: string[];
  /** Inferred or unsupported claims the draft must not state. */
  factsAvoid: string[];
  /** Canonical relationship-voice / Voice DNA rules that governed the draft. */
  voiceEvidenceUsed: string[];
  /** Approved/sent examples or Tai edits that influenced style (never the baseline). */
  learnedExamplesUsed: string[];
}

const JUDGMENT_KEY = "communication_judgment";

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

function text(raw: unknown): string {
  return String(raw ?? "").trim();
}

/** Read the ask decision from the current shape or the legacy nextMove. */
function parseAskDecision(value: Record<string, unknown>): AskDecision {
  const noAsk: AskDecision = { shouldAsk: false, whyNatural: "", what: "" };
  const askRaw = value["askDecision"];
  if (askRaw && typeof askRaw === "object") {
    const ask = askRaw as Record<string, unknown>;
    const what = text(ask["what"]);
    return {
      shouldAsk: ask["shouldAsk"] === true && Boolean(what),
      whyNatural: text(ask["whyNatural"]),
      what,
    };
  }
  const moveRaw = value["nextMove"];
  if (moveRaw && typeof moveRaw === "object") {
    const move = moveRaw as Record<string, unknown>;
    const what = text(move["what"]);
    return {...noAsk, shouldAsk: move["ask"] === true && Boolean(what), what };
  }
  if (typeof moveRaw === "string" && moveRaw.trim()) {
    return {...noAsk, shouldAsk: true, what: moveRaw.trim() };
  }
  return noAsk;
}

/**
 * Read a model-produced (or stored) judgment into the contract. Anything
 * that cannot be read whole returns null, a partial judgment is not a
 * judgment, and the caller fails honestly rather than drafting blind.
 *
 * Judgments persisted before the conversation-first rename still read: the
 * legacy keys (whatNoticed/relationshipRead, nextMove, communicationJob,
 * toneAndPosture) fill latestHumanSignal, askDecision, whyNow, and
 * intendedEffect when the new keys are absent.
 */
export function parseCommunicationJudgment(raw: unknown): CommunicationJudgment | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const whyNow = text(value["whyNow"]) || text(value["communicationJob"]);
  const latestHumanSignal =
    text(value["latestHumanSignal"]) ||
    text(value["whatNoticed"]) ||
    text(value["relationshipRead"]);
  if (!whyNow || !latestHumanSignal) return null;

  return {
    whyNow,
    latestHumanSignal,
    whatThisSaysAboutThem: text(value["whatThisSaysAboutThem"]),
    whatDeservesAcknowledgment: text(value["whatDeservesAcknowledgment"]),
    threadToBuildOn: text(value["threadToBuildOn"]),
    intendedEffect: text(value["intendedEffect"]) || text(value["toneAndPosture"]),
    responseObligation: text(value["responseObligation"]),
    askDecision: parseAskDecision(value),
    factsAllowed: stringList(value["factsAllowed"]),
    factsAvoid: stringList(value["factsAvoid"]),
    voiceEvidenceUsed: stringList(value["voiceEvidenceUsed"]),
    learnedExamplesUsed: stringList(value["learnedExamplesUsed"]),
  };
}

/** Merge the judgment into a draft's rationale. Nothing else moves. */
export function writeCommunicationJudgment(
  rationale: Record<string, unknown> | null | undefined,
  judgment: CommunicationJudgment,
): Record<string, unknown> {
  return {...(rationale ?? {}), [JUDGMENT_KEY]: judgment };
}

/** The judgment a draft was prepared from, when one is on record. */
export function readCommunicationJudgment(
  rationale: Record<string, unknown> | null | undefined,
): CommunicationJudgment | null {
  return parseCommunicationJudgment(rationale?.[JUDGMENT_KEY]);
}

/**
 * The compact "Why this draft" read: a few short lines a person can scan in
 * the composer, why now, what I noticed, what it says about them, what to
 * build on, and the ask decision (or an honest "No ask" with its reason).
 */
export function judgmentSummaryLines(judgment: CommunicationJudgment): string[] {
  const lines = [
    judgment.whyNow ? `Why now: ${judgment.whyNow}`: "",
    judgment.latestHumanSignal ? `What I noticed: ${judgment.latestHumanSignal}`: "",
    judgment.whatThisSaysAboutThem
      ? `What it says about them: ${judgment.whatThisSaysAboutThem}`
: "",
    judgment.threadToBuildOn ? `What to build on: ${judgment.threadToBuildOn}`: "",
  ].filter(Boolean);
  if (judgment.askDecision.shouldAsk) {
    lines.push(
      judgment.askDecision.whyNatural
        ? `Ask: ${judgment.askDecision.what} (${judgment.askDecision.whyNatural})`
: `Ask: ${judgment.askDecision.what}`,
    );
  } else {
    lines.push(
      judgment.askDecision.whyNatural
        ? `No ask: ${judgment.askDecision.whyNatural}`
: "No ask needed.",
    );
  }
  return lines.slice(0, 5);
}

/* ------------------------------------------------------------ the ask gate */

/**
 * Phrases that constitute an ask for time, a call, a coffee, a meeting,
 * "finding time". Used to enforce the judgment's ask decision on the written
 * draft: when shouldAsk is false, none of these may appear. A mention of an
 * already-agreed plan ("see you Tuesday") is acknowledgment, not an ask, and
 * these patterns are shaped to miss it.
 */
const UNEARNED_ASK_PATTERNS: RegExp[] = [
  /\bwould you be open to\b/i,
  /\bopen to (a |an )?(quick |short )?(call|chat|coffee|meeting|catch[ -]?up)\b/i,
  /\bhop(ping)? on (a )?(quick |short )?(call|zoom|meet)\b/i,
  /\bgrab (a )?(coffee|call|lunch|drink)\b/i,
  /\b(schedule|set up|book|plan) (a |an )?(quick |short )?(call|meeting|chat|coffee|catch[ -]?up)\b/i,
  /\bfind (some )?time (to talk|to chat|to connect|to catch up|for a call|for us)\b/i,
  /\bquick (call|chat|coffee)\b/i,
  /\b(15|20|30|45)[ -]?(minute|min)s?\b[^.!?]*\b(call|chat|talk|coffee|meeting)\b/i,
  /\b(call|chat|talk|coffee|meeting)\b[^.!?]*\b(15|20|30|45)[ -]?(minute|min)s?\b/i,
  /\bdo you have (a few|15|15-20|twenty|thirty)( minutes| mins?)?\b/i,
  /\bare you free (for|to) (a )?(call|chat|coffee|meeting)\b/i,
  /\blove to (schedule|set up|book|grab|find time)\b/i,
];

/**
 * The excerpt of a snuck-in ask, or null when the body honors a no-ask
 * judgment. Deterministic: the model proposes, this decides.
 */
export function unearnedAskInBody(body: string): string | null {
  for (const pattern of UNEARNED_ASK_PATTERNS) {
    const match = body.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/* ---------------------------------------------------- grounding sufficiency */

export type DraftKind = "reply" | "proactive";

export interface DraftGroundingInput {
  /** A known identity: a name or an email on record. */
  hasIdentity: boolean;
  /** The thread holds at least one inbound message, a reply is owed. */
  threadHasInbound: boolean;
  /** Real prior interactions: thread messages plus observed/decided memory. */
  priorInteractionCount: number;
  /** A stated reason to write: a purpose, a next action, or an open commitment. */
  hasReason: boolean;
}

export interface DraftGrounding {
  grounded: boolean;
  kind: DraftKind | null;
  /** Plain-language gaps, when drafting would require inventing them. */
  missing: string[];
}

/**
 * Whether a trustworthy draft is possible at all.
 *
 * The bar is deliberately low but hard: a real thread plus a known identity
 * grounds a reply; a known identity plus one real prior interaction plus a
 * reason grounds a proactive note. Extra memory, commitments, Scout context,
 * and approved examples improve the draft but are never mandatory. Below the
 * bar, drafting would require inventing the reason, the facts, or the
 * relationship itself, so Comms fails honestly and names what is missing.
 */
export function assessDraftGrounding(input: DraftGroundingInput): DraftGrounding {
  if (!input.hasIdentity) {
    return {
      grounded: false,
      kind: null,
      missing: ["who this person is, no name or email is on record"],
    };
  }
  if (input.threadHasInbound) {
    return { grounded: true, kind: "reply", missing: [] };
  }
  const missing: string[] = [];
  if (input.priorInteractionCount === 0) missing.push("a real prior interaction");
  if (!input.hasReason) missing.push("a reason to write now");
  if (missing.length > 0) return { grounded: false, kind: null, missing };
  return { grounded: true, kind: "proactive", missing: [] };
}

/* --------------------------------------------------- grounding confidence */

export type GroundingLevel = "strong" | "grounded" | "thin";

/**
 * The plain-language account of what a draft stands on, persisted with the
 * draft so the composer can show it before anything sends. Basis names the
 * evidence used; wouldStrengthen names what is missing without blocking, * the gate already decided the draft may exist, this says how firmly.
 */
export interface DraftGroundingSummary {
  kind: DraftKind;
  level: GroundingLevel;
  /** What the draft stands on, in plain language. */
  basis: string[];
  /** What would sharpen the next draft. Empty when nothing obvious is missing. */
  wouldStrengthen: string[];
}

export interface DraftGroundingFacts {
  kind: DraftKind;
  threadCount: number;
  /** Observed + decided memory lines. */
  recordedFactCount: number;
  openCommitmentCount: number;
  voiceExampleCount: number;
  hasPurpose: boolean;
}

function plural(count: number, singular: string): string {
  return count === 1 ? `${count} ${singular}`: `${count} ${singular}s`;
}

export function summarizeDraftGrounding(facts: DraftGroundingFacts): DraftGroundingSummary {
  const basis: string[] = [];
  if (facts.kind === "reply") basis.push("Their latest message is in the thread");
  if (facts.threadCount > 0) {
    basis.push(`Live thread · ${plural(facts.threadCount, "message")}`);
  }
  if (facts.recordedFactCount > 0) {
    basis.push(`${plural(facts.recordedFactCount, "recorded fact")} from memory`);
  }
  if (facts.openCommitmentCount > 0) {
    basis.push(`${plural(facts.openCommitmentCount, "open commitment")} on record`);
  }
  if (facts.voiceExampleCount > 0) {
    basis.push(`${plural(facts.voiceExampleCount, "approved draft")} as style reference`);
  }
  if (facts.hasPurpose) basis.push("Your stated reason for writing");

  const wouldStrengthen: string[] = [];
  if (facts.recordedFactCount === 0) {
    wouldStrengthen.push("Record what you know about them, even one note sharpens the draft");
  }
  if (facts.voiceExampleCount === 0) {
    wouldStrengthen.push("Approve or send a draft so the voice learns from real wording");
  }

  /* A reply on a real thread is never thin: answering what they actually
     wrote is adequate grounding by itself. Proactive notes earn their level
     from supporting signals alone. */
  const level: GroundingLevel =
    basis.length >= 4 ? "strong": basis.length >= 3 || facts.kind === "reply" ? "grounded": "thin";
  return { kind: facts.kind, level, basis, wouldStrengthen };
}

const GROUNDING_KEY = "draft_grounding";

/** Merge the grounding summary into a draft's rationale. Nothing else moves. */
export function writeDraftGrounding(
  rationale: Record<string, unknown> | null | undefined,
  grounding: DraftGroundingSummary | null | undefined,
): Record<string, unknown> {
  if (!grounding) return {...(rationale ?? {}) };
  return {...(rationale ?? {}), [GROUNDING_KEY]: grounding };
}

/** The grounding summary a draft was prepared with, when one is on record. */
export function readDraftGrounding(
  rationale: Record<string, unknown> | null | undefined,
): DraftGroundingSummary | null {
  const raw = rationale?.[GROUNDING_KEY];
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const kindRaw = value["kind"];
  const levelRaw = value["level"];
  const kind = kindRaw === "reply" || kindRaw === "proactive" ? kindRaw: null;
  const level =
    levelRaw === "strong" || levelRaw === "grounded" || levelRaw === "thin" ? levelRaw: null;
  const basis = stringList(value["basis"]);
  if (!kind || !level || basis.length === 0) return null;
  return { kind, level, basis, wouldStrengthen: stringList(value["wouldStrengthen"]) };
}

/* --------------------------------------------------------- name handling */

/**
 * The name a salutation may use, or "" when nothing is safe.
 *
 * Human-safe by construction: "Vinyard, Larry" (surname-first export format)
 * resolves to "Larry", never "Vinyard,". A bare token is used as-is. Punctuation
 * is stripped so no salutation can ever carry a trailing comma into prose.
 */
export function salutationName(fullName: string): string {
  const clean = fullName.trim().replace(/,+\s*$/, "").trim();
  if (!clean) return "";
  // Surname-first format: everything after the first comma is the given name.
  const given = clean.includes(",")
    ? clean.slice(clean.indexOf(",") + 1).trim()
: clean;
  const token = given.split(/\s+/)[0] ?? "";
  return token.replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}'-]+$/gu, "");
}

/* -------------------------------------------------------- thread context */

/** One message as the judgment is allowed to see it: bounded and attributed. */
export interface ThreadJudgmentEntry {
  direction: "inbound" | "outbound";
  subject?: string;
  text: string;
  occurredAt: string;
  /** True on the newest message from each side, what most deserves an answer. */
  latestForSide: boolean;
}

interface ThreadSourceMessage {
  direction: "inbound" | "outbound";
  subject?: string | undefined;
  snippet?: string | undefined;
  bodyText?: string | undefined;
  occurredAt: string;
}

/** Hard bounds so one long thread can never flood the reasoning packet. */
const THREAD_ENTRY_LIMIT = 8;
const THREAD_MESSAGE_CHARS = 900;

function trimMessageText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= THREAD_MESSAGE_CHARS) return clean;
  return `${clean.slice(0, THREAD_MESSAGE_CHARS).trimEnd()}…`;
}

/**
 * The recent conversation as drafting evidence, newest last. Comms never
 * drafts blind to the thread: the latest message from each side is marked so
 * the judgment can name what is actually owed. Text is trimmed, never
 * dropped, a long message is shortened, a short one is whole.
 */
export function threadContextForJudgment(
  messages: ThreadSourceMessage[],
  limit = THREAD_ENTRY_LIMIT,
): ThreadJudgmentEntry[] {
  const ordered = [...messages].sort((a, b) => (a.occurredAt < b.occurredAt ? -1: 1));
  const recent = ordered.slice(-Math.max(1, limit));
  const lastInbound = recent.map((m) => m.direction).lastIndexOf("inbound");
  const lastOutbound = recent.map((m) => m.direction).lastIndexOf("outbound");
  return recent.map((message, index) => ({
    direction: message.direction,
...(message.subject?.trim() ? { subject: message.subject.trim() }: {}),
    text: trimMessageText(message.bodyText ?? message.snippet ?? ""),
    occurredAt: message.occurredAt,
    latestForSide: index === lastInbound || index === lastOutbound,
  }));
}
