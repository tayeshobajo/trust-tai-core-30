/**
 * Deterministic transcript reading.
 *
 * A pure function from a normalized conversation to a set of proposals. No
 * model is called here. Every proposal points at the exact line it came from,
 * and anything the transcript did not say — who owns it, when it is due, which
 * project it belongs to — stays unresolved for a person to settle.
 *
 * Re-reading the same conversation produces the same ids, so confirming twice
 * can never create the promise twice.
 *
 * Restraint is the point. A real meeting is mostly conversation: greetings,
 * audio checks, coaching, rhetoric. Steward shows a person only the lines that
 * carry work. Ability ("I can hear you") and self-description ("I try to
 * manage my time") are never commitments.
 */

import type { EvidenceRef } from "@/domain/confidence";
import type {
  NormalizedConversation,
  Proposal,
  ProposalKind,
  TranscriptSegment,
} from "@/domain/steward";

export const EXTRACTOR_VERSION = "steward-extract-2";

/** Small stable hash. Same text in, same id out, on server and browser. */
export function stableKey(...parts: string[]): string {
  const input = parts.join("|").toLowerCase().replace(/\s+/g, " ").trim();
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

/** The key that makes one promise one promise, however often it is read. */
export function sourceKeyOf(conversation: NormalizedConversation, statement: string): string {
  const ref = conversation.sourceRef;
  const source = ref.externalId ?? ref.shareToken ?? ref.url;
  return `${ref.provider}:${source}:${stableKey(statement)}`;
}

/* --------------------------------------------------------- thought windows */

/**
 * One speaker's continuous thought, stitched from adjacent segments when a
 * segment clearly stops mid-sentence. Never crosses a speaker boundary and
 * never bridges a long pause. The first segment keeps the timestamp and the
 * whole span keeps its evidence.
 */
export interface ThoughtWindow {
  speaker: string;
  speakerEmail?: string;
  at: string;
  index: number;
  text: string;
  segments: TranscriptSegment[];
}

const MAX_GAP_SECONDS = 45;
const MAX_WINDOW_SEGMENTS = 6;
const MAX_WINDOW_CHARS = 700;

function seconds(at: string): number {
  const parts = at.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** True when the text stops mid-thought rather than at a sentence end. */
function endsMidSentence(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/[.?!…]["')\]]?$/.test(trimmed)) return false;
  return true;
}

export function stitchSegments(segments: TranscriptSegment[]): ThoughtWindow[] {
  const windows: ThoughtWindow[] = [];
  for (const segment of segments) {
    const current = windows[windows.length - 1];
    const joinable =
      current !== undefined &&
      current.speaker === segment.speaker &&
      current.segments.length < MAX_WINDOW_SEGMENTS &&
      current.text.length < MAX_WINDOW_CHARS &&
      endsMidSentence(current.text) &&
      seconds(segment.at) - seconds(current.segments[current.segments.length - 1]!.at) <=
        MAX_GAP_SECONDS;

    if (joinable && current) {
      current.text = `${current.text.trim()} ${segment.text.trim()}`.trim();
      current.segments.push(segment);
      continue;
    }

    windows.push({
      speaker: segment.speaker,
      ...(segment.speakerEmail ? { speakerEmail: segment.speakerEmail } : {}),
      at: segment.at,
      index: segment.index,
      text: segment.text.trim(),
      segments: [segment],
    });
  }
  return windows;
}

/* ------------------------------------------------------ owner reconciliation */

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function participantTokens(name: string, email?: string): string[] {
  const tokens = new Set<string>();
  for (const part of name.split(/[\s._@-]+/)) {
    const token = normalizeToken(part);
    if (token.length >= 3) tokens.add(token);
  }
  const local = email?.split("@")[0];
  if (local) {
    for (const part of local.split(/[._\-+\d]+/)) {
      const token = normalizeToken(part);
      if (token.length >= 3) tokens.add(token);
    }
  }
  return [...tokens];
}

/**
 * Reconcile a spoken speaker label against the participant list, which may
 * carry email addresses rather than display names. Fails closed: an ambiguous
 * or unmatched label stays unresolved.
 */
export function resolveSpeaker(
  speaker: string,
  conversation: NormalizedConversation,
): { name: string; resolved: boolean } {
  const spoken = speaker
    .split(/[\s._@-]+/)
    .map(normalizeToken)
    .filter((token) => token.length >= 3);
  if (spoken.length === 0) return { name: speaker, resolved: false };

  const matches = conversation.participants.filter((participant) => {
    const local = normalizeToken(participant.email?.split("@")[0] ?? "");
    const tokens = participantTokens(participant.name, participant.email);
    /* Every spoken token lives inside the address, e.g. arthuremmanuel270. */
    if (local && spoken.every((token) => local.includes(token))) return true;
    /* Or a whole name token matches exactly, e.g. henry@trust-tai.com. */
    return spoken.some((token) => tokens.includes(token));
  });

  return matches.length === 1
    ? { name: speaker, resolved: true }
    : { name: speaker, resolved: false };
}

/**
 * A participant named inside the sentence. Third parties who merely appear in
 * the words are never resolved into owners.
 */
function namedParticipant(
  text: string,
  conversation: NormalizedConversation,
): { name: string; resolved: boolean } | null {
  const found = conversation.participants.filter((participant) =>
    participantTokens(participant.name, participant.email).some((token) =>
      new RegExp(`\\b${token}\\b`, "i").test(text),
    ),
  );
  if (found.length !== 1) return null;
  const participant = found[0]!;
  return { name: participant.name, resolved: true };
}

/* ------------------------------------------------------------ language cues */

/** Verbs that move work. Ability and state verbs are deliberately absent. */
const ACTION_VERB =
  /\b(send|sends|sending|share|shares|sharing|email|emails|forward|write|writing|write up|draft|drafting|prepare|preparing|populate|populated|document|documenting|schedule|scheduling|book|booking|set up|create|creating|build|building|add|adding|update|updating|review|reviewing|check|checking|confirm|confirming|follow up|circle back|present|presenting|deliver|delivering|ship|fix|fixing|call|calling|reach out|put together|pull together|log|logging|submit|sign|pay|hire|plan|planning|define|map|block|record|publish|test|deploy|migrate|arrange|organise|organize|invite|assign|finalise|finalize|chase|escalate|onboard|hand over|handover|raise)\b/i;

/** Sharing-shaped work belongs in follow ups. */
const SHARE_VERB =
  /\b(send|share|email|forward|write up|follow up|circle back|present|document|report back|hand over|handover|invite|schedule|book)\b/i;

/** A promise about the future, in the speaker's own words. */
const PROMISE =
  /\b(i['’]?ll|i will|we['’]?ll|we will|i['’]?m going to|i am going to|we['’]?re going to|we are going to|i want us to|i need to|we need to|i plan to|we plan to|let me)\b/i;

/** Work handed to someone else. */
const REQUEST = /\b(can you|could you|would you|please|i need you to|i'd like you to)\b/i;

const DECISION =
  /\b(we (decided|agreed|have agreed)|let['’]?s go with|the decision is|we are going with|we['’]?re going with|decision:|agreed[,:])\b/i;

const HEDGE = /\b(maybe|perhaps|possibly|might|thereabout|i think we (could|might)|not sure)\b/i;

const BLOCKER =
  /\b(blocked|blocker|waiting on|waiting for|stuck on|can['’]?t (proceed|move|start)|held up|dependency on|depends on)\b/i;

/** "once X, then Y" — a real dependency, not ordinary sequencing. */
const CONDITIONAL =
  /\b(once|as soon as|after|until|when)\b[^.?!]{0,120}?\b(then|i['’]?ll|we['’]?ll|i will|we will|you can|we can|i can)\b/i;

/** Questions that leave work unresolved. */
const OPEN_QUESTION =
  /\b(who (owns|will own|is going to|should)|who['’]?s (going to|responsible)|what is the next step|what['’]?s the next step|when (will|do|are) (we|you)|do we need|should we|need to (check|confirm|decide)|open question|unclear|to be decided|tbd|not sure (who|when|what|how) )\b/i;

/** Conversation, not work. Audio checks, coaching, rhetoric, hypotheticals. */
const RHETORICAL =
  /(can you hear|do you hear|are you there|you know\?|right\?|okay\?|make sense\?|is that (ok|fine|clear)|do you mind|what if|would you take|is it (a|an) |don['’]?t you|isn['’]?t it|am i (right|clear)|did you get what i said)/i;

const TIMING =
  /\b(today|tomorrow|tonight|this (week|afternoon|morning)|next (week|month)|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|end of (day|week|month)|the \d{1,2}(st|nd|rd|th)?)|end of (day|week|month)|on (monday|tuesday|wednesday|thursday|friday))\b/i;

function timingOf(text: string): string | null {
  const match = text.match(TIMING);
  return match ? match[0] : null;
}

/**
 * The clause a promise or request introduces. Commitment lives there, so this
 * is where an actionable verb has to appear — not anywhere in the sentence.
 */
function commitmentClause(text: string, marker: RegExp): string | null {
  const match = text.match(marker);
  if (!match || match.index === undefined) return null;
  return text.slice(match.index + match[0].length, match.index + match[0].length + 160);
}

/** An actionable verb plus something to act on. */
function isActionable(clause: string | null): boolean {
  if (!clause) return false;
  const verb = clause.match(ACTION_VERB);
  if (!verb || verb.index === undefined) return false;
  const object = clause.slice(verb.index + verb[0].length).trim();
  return object.split(/\s+/).filter(Boolean).length >= 2;
}

interface Read {
  kind: ProposalKind;
  /** Owner came from the speaker's own promise rather than a named request. */
  firstPerson: boolean;
}

function classify(text: string): Read | null {
  /* A dependency is only a dependency when something waits on something. */
  if (BLOCKER.test(text)) return { kind: "blocker", firstPerson: false };
  if (CONDITIONAL.test(text) && ACTION_VERB.test(text)) {
    return { kind: "blocker", firstPerson: false };
  }

  if (DECISION.test(text) && !HEDGE.test(text)) return { kind: "decision", firstPerson: false };

  const rhetorical = RHETORICAL.test(text);
  const promised = isActionable(commitmentClause(text, PROMISE));
  if (promised && !rhetorical) {
    return { kind: SHARE_VERB.test(text) ? "follow_up" : "action", firstPerson: true };
  }

  const requested = isActionable(commitmentClause(text, REQUEST));
  if (requested && !rhetorical) {
    return { kind: SHARE_VERB.test(text) ? "follow_up" : "action", firstPerson: false };
  }

  if (OPEN_QUESTION.test(text) && !rhetorical) {
    return { kind: "question", firstPerson: false };
  }
  return null;
}

function trimStatement(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > 220 ? `${cleaned.slice(0, 217)}…` : cleaned;
}

function evidenceFor(
  conversation: NormalizedConversation,
  window: ThoughtWindow,
): EvidenceRef[] {
  return window.segments.slice(0, 3).map((segment) => {
    const label = `${conversation.title} · ${segment.speaker} at ${segment.at}`;
    const url = segment.url ?? conversation.sourceRef.url;
    return url ? { label, kind: "page" as const, url } : { label, kind: "page" as const };
  });
}

/**
 * Read a conversation. Returns proposals in transcript order.
 *
 * Truth tiers:
 *  - observed: the speaker committed in their own words.
 *  - inferred: Steward read intent into it, or a provider extracted it.
 */
export function extractProposals(conversation: NormalizedConversation): Proposal[] {
  const proposals: Proposal[] = [];
  const seen = new Set<string>();

  for (const window of stitchSegments(conversation.segments)) {
    const text = window.text.trim();
    if (text.length < 12) continue;
    const read = classify(text);
    if (!read) continue;

    const statement = trimStatement(text);
    const key = sourceKeyOf(conversation, statement);
    if (seen.has(key)) continue;
    seen.add(key);

    const speaker = resolveSpeaker(window.speaker, conversation);
    const named = read.firstPerson ? null : namedParticipant(text, conversation);
    const owner = read.firstPerson ? speaker : named;
    const dueText = timingOf(text);

    const tier: Proposal["tier"] = read.firstPerson ? "observed" : "inferred";
    const confidence: Proposal["confidence"] =
      read.firstPerson && owner?.resolved
        ? "high"
        : owner?.resolved || read.kind === "blocker"
          ? "moderate"
          : "low";

    proposals.push({
      id: key,
      kind: read.kind,
      statement,
      tier,
      confidence,
      ownerName: owner?.name ?? null,
      ownerResolved: Boolean(owner?.resolved),
      dueText,
      dueResolved: false,
      beneficiary: null,
      quote: text,
      at: window.at,
      segmentIndex: window.index,
      evidence: evidenceFor(conversation, window),
      status: "proposed",
    });
  }

  /* The provider's own action items are source material, not Steward's read. */
  for (const item of conversation.sourceActionItems) {
    const statement = trimStatement(item.description);
    const key = sourceKeyOf(conversation, statement);
    if (seen.has(key)) continue;
    seen.add(key);
    proposals.push({
      id: key,
      kind: "action",
      statement,
      tier: "inferred",
      confidence: item.assigneeName ? "moderate" : "low",
      ownerName: item.assigneeName ?? null,
      ownerResolved: false,
      dueText: timingOf(statement),
      dueResolved: false,
      beneficiary: null,
      quote: item.description,
      at: item.at ?? "00:00:00",
      segmentIndex: Number.MAX_SAFE_INTEGER,
      evidence: [
        {
          label: `Action item recorded by ${conversation.sourceRef.provider}`,
          kind: "provider",
          ...(item.url ?? conversation.sourceRef.url
            ? { url: item.url ?? conversation.sourceRef.url }
            : {}),
        },
      ],
      status: "proposed",
    });
  }

  return proposals;
}

/** Group proposals for the review screen, keeping transcript order inside each. */
export function groupProposals(proposals: Proposal[]): Record<ProposalKind, Proposal[]> {
  const grouped: Record<ProposalKind, Proposal[]> = {
    action: [],
    decision: [],
    follow_up: [],
    blocker: [],
    question: [],
  };
  for (const proposal of proposals) grouped[proposal.kind].push(proposal);
  return grouped;
}

/** Proposals a person must settle before anything can become canonical. */
export function unresolvedProposals(proposals: Proposal[]): Proposal[] {
  return proposals.filter(
    (proposal) =>
      (proposal.kind === "action" || proposal.kind === "follow_up") && !proposal.ownerResolved,
  );
}
