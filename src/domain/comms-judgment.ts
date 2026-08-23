/**
 * The communication-judgment contract.
 *
 * Reason first. Write second. Comms does not generate messages: it makes a
 * relationship-specific communication judgment over the governed evidence —
 * who this person is, what the thread actually said, what is owed, what Tai's
 * recorded voice sounds like — and then writes the one message that judgment
 * requires. The judgment is persisted on the draft's rationale, so every
 * draft carries its provenance: why it exists, what it was allowed to say,
 * and what it was told never to claim.
 *
 * A judgment is a concise product-level rationale, never hidden
 * chain-of-thought. A person can read it in three lines and decide whether
 * the draft deserves to exist.
 *
 * Pure and I/O-free: the server assembles and writes it, the composer reads
 * and renders it, and tests pin the rules.
 */

/* ---------------------------------------------------------- the judgment */

export interface CommunicationJudgment {
  /** What this message needs to accomplish now, in one plain sentence. */
  communicationJob: string;
  /** Concise state/temperature read of the relationship, grounded in evidence. */
  relationshipRead: string;
  /** What in their latest message actually deserves acknowledgement or answer. */
  responseObligation: string;
  /** How Tai should show up here, and why. */
  toneAndPosture: string;
  /** Whether there should be an ask at all; if yes, what is proportionate. */
  nextMove: { ask: boolean; what: string };
  /** Evidence the draft may reference as fact. */
  factsAllowed: string[];
  /** Inferred or unsupported claims the draft must not state. */
  factsAvoid: string[];
  /** The Voice DNA rules or examples that governed the draft. */
  voiceEvidenceUsed: string[];
}

const JUDGMENT_KEY = "communication_judgment";

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

/**
 * Read a model-produced (or stored) judgment into the contract. Anything
 * that cannot be read whole returns null — a partial judgment is not a
 * judgment, and the caller fails honestly rather than drafting blind.
 */
export function parseCommunicationJudgment(raw: unknown): CommunicationJudgment | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const communicationJob = String(value["communicationJob"] ?? "").trim();
  const relationshipRead = String(value["relationshipRead"] ?? "").trim();
  if (!communicationJob || !relationshipRead) return null;

  const moveRaw = value["nextMove"];
  let nextMove: CommunicationJudgment["nextMove"] = { ask: false, what: "" };
  if (moveRaw && typeof moveRaw === "object") {
    const move = moveRaw as Record<string, unknown>;
    const what = String(move["what"] ?? "").trim();
    nextMove = { ask: move["ask"] === true && Boolean(what), what };
  } else if (typeof moveRaw === "string" && moveRaw.trim()) {
    nextMove = { ask: true, what: moveRaw.trim() };
  }

  return {
    communicationJob,
    relationshipRead,
    responseObligation: String(value["responseObligation"] ?? "").trim(),
    toneAndPosture: String(value["toneAndPosture"] ?? "").trim(),
    nextMove,
    factsAllowed: stringList(value["factsAllowed"]),
    factsAvoid: stringList(value["factsAvoid"]),
    voiceEvidenceUsed: stringList(value["voiceEvidenceUsed"]),
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
 * The compact "Why this draft" read: one to three short lines a person can
 * scan in the composer. The job, the read, and the move — nothing else.
 */
export function judgmentSummaryLines(judgment: CommunicationJudgment): string[] {
  const lines = [judgment.communicationJob, judgment.relationshipRead].filter(Boolean);
  const move = judgment.nextMove.ask
    ? `The ask: ${judgment.nextMove.what}`
    : "No ask. The message stands on its own.";
  lines.push(move);
  return lines.slice(0, 3);
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
