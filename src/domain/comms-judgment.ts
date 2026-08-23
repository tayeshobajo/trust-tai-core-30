/**
 * The communication-judgment contract.
 *
 * Spirit first. Reason first. Write second. Comms does not generate messages:
 * it makes a relationship-specific communication judgment over the governed
 * evidence — who this person is, why Tai is writing now, what they are likely
 * carrying, what the thread actually said, what is owed — under Tai's
 * canonical relationship voice, and then writes the one message that judgment
 * requires. The judgment is persisted on the draft's rationale, so every
 * draft carries its provenance: why it exists, what it was allowed to say,
 * what it was told never to claim, and which voice shaped it.
 *
 * A judgment is a concise product-level rationale, never hidden
 * chain-of-thought. A person can read it in four lines — why now, what I
 * noticed, intended effect, next move — and decide whether the draft
 * deserves to exist.
 *
 * Pure and I/O-free: the server assembles and writes it, the composer reads
 * and renders it, and tests pin the rules.
 */

/* ---------------------------------------------------------- the judgment */

export interface CommunicationJudgment {
  /** Why Tai is writing now, in one plain sentence grounded in evidence. */
  whyNow: string;
  /** What the person is likely carrying or caring about, from evidence only. */
  whatNoticed: string;
  /** What Tai wants them to feel when they finish reading. */
  intendedEffect: string;
  /** What in their latest message actually deserves acknowledgement or answer. */
  responseObligation: string;
  /** Whether there should be an ask at all; if yes, what is proportionate. */
  nextMove: { ask: boolean; what: string };
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

/**
 * Read a model-produced (or stored) judgment into the contract. Anything
 * that cannot be read whole returns null — a partial judgment is not a
 * judgment, and the caller fails honestly rather than drafting blind.
 *
 * Judgments persisted before the spirit-first rename still read: the legacy
 * keys (communicationJob, relationshipRead, toneAndPosture) fill whyNow,
 * whatNoticed, and intendedEffect when the new keys are absent.
 */
export function parseCommunicationJudgment(raw: unknown): CommunicationJudgment | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const whyNow = text(value["whyNow"]) || text(value["communicationJob"]);
  const whatNoticed = text(value["whatNoticed"]) || text(value["relationshipRead"]);
  if (!whyNow || !whatNoticed) return null;

  const moveRaw = value["nextMove"];
  let nextMove: CommunicationJudgment["nextMove"] = { ask: false, what: "" };
  if (moveRaw && typeof moveRaw === "object") {
    const move = moveRaw as Record<string, unknown>;
    const what = text(move["what"]);
    nextMove = { ask: move["ask"] === true && Boolean(what), what };
  } else if (typeof moveRaw === "string" && moveRaw.trim()) {
    nextMove = { ask: true, what: moveRaw.trim() };
  }

  return {
    whyNow,
    whatNoticed,
    intendedEffect: text(value["intendedEffect"]) || text(value["toneAndPosture"]),
    responseObligation: text(value["responseObligation"]),
    nextMove,
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
  return { ...(rationale ?? {}), [JUDGMENT_KEY]: judgment };
}

/** The judgment a draft was prepared from, when one is on record. */
export function readCommunicationJudgment(
  rationale: Record<string, unknown> | null | undefined,
): CommunicationJudgment | null {
  return parseCommunicationJudgment(rationale?.[JUDGMENT_KEY]);
}

/**
 * The compact "Why this draft" read: four short lines a person can scan in
 * the composer — why now, what I noticed, intended effect, and the next move
 * (or an honest "No ask needed").
 */
export function judgmentSummaryLines(judgment: CommunicationJudgment): string[] {
  const lines = [
    judgment.whyNow ? `Why now: ${judgment.whyNow}` : "",
    judgment.whatNoticed ? `What I noticed: ${judgment.whatNoticed}` : "",
    judgment.intendedEffect ? `Intended effect: ${judgment.intendedEffect}` : "",
  ].filter(Boolean);
  lines.push(
    judgment.nextMove.ask ? `Next move: ${judgment.nextMove.what}` : "No ask needed.",
  );
  return lines.slice(0, 4);
}

/* ---------------------------------------------------- grounding sufficiency */

export type DraftKind = "reply" | "proactive";

export interface DraftGroundingInput {
  /** A known identity: a name or an email on record. */
  hasIdentity: boolean;
  /** The thread holds at least one inbound message — a reply is owed. */
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
 * relationship itself — so Comms fails honestly and names what is missing.
 */
export function assessDraftGrounding(input: DraftGroundingInput): DraftGrounding {
  if (!input.hasIdentity) {
    return {
      grounded: false,
      kind: null,
      missing: ["who this person is — no name or email is on record"],
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
  /** True on the newest message from each side — what most deserves an answer. */
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
 * dropped — a long message is shortened, a short one is whole.
 */
export function threadContextForJudgment(
  messages: ThreadSourceMessage[],
  limit = THREAD_ENTRY_LIMIT,
): ThreadJudgmentEntry[] {
  const ordered = [...messages].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
  const recent = ordered.slice(-Math.max(1, limit));
  const lastInbound = recent.map((m) => m.direction).lastIndexOf("inbound");
  const lastOutbound = recent.map((m) => m.direction).lastIndexOf("outbound");
  return recent.map((message, index) => ({
    direction: message.direction,
    ...(message.subject?.trim() ? { subject: message.subject.trim() } : {}),
    text: trimMessageText(message.bodyText ?? message.snippet ?? ""),
    occurredAt: message.occurredAt,
    latestForSide: index === lastInbound || index === lastOutbound,
  }));
}
