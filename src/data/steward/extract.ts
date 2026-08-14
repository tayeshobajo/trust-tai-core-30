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
 */

import type { EvidenceRef } from "@/domain/confidence";
import type {
  NormalizedConversation,
  Proposal,
  ProposalKind,
  TranscriptSegment,
} from "@/domain/steward";

export const EXTRACTOR_VERSION = "steward-extract-1";

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

const FIRST_PERSON = /\b(i['’]?ll|i will|i'?m going to|i am going to|i can|we['’]?ll|we will)\b/i;
const REQUEST = /\b(can you|could you|would you|please)\b/i;
const DECISION = /\b(we (decided|agreed)|let['’]?s go with|the decision is|we are going with|we['’]?re going with|agreed[,:])\b/i;
const FOLLOW_UP = /\b(send|share|email|write up|follow up|circle back|forward)\b/i;
const BLOCKER = /\b(blocked|blocker|waiting on|stuck on|can['’]?t (proceed|move|start)|held up|dependency on)\b/i;
const QUESTION = /\b(not sure|unclear|need to (check|confirm)|who owns|open question|we should decide|tbd)\b/i;
const TIMING =
  /\b(today|tomorrow|tonight|this (week|afternoon|morning)|next (week|month)|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|end of (day|week|month)|the \d{1,2}(st|nd|rd|th)?)|end of (day|week|month)|on (monday|tuesday|wednesday|thursday|friday))\b/i;

/** A name that actually appears in the participant list. Never a new person. */
function namedParticipant(text: string, conversation: NormalizedConversation): string | null {
  for (const participant of conversation.participants) {
    const first = participant.name.trim().split(/\s+/)[0];
    if (!first || first.length < 3) continue;
    const pattern = new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(text)) return participant.name;
  }
  return null;
}

function timingOf(text: string): string | null {
  const match = text.match(TIMING);
  return match ? match[0] : null;
}

function classify(text: string): ProposalKind | null {
  if (BLOCKER.test(text)) return "blocker";
  if (DECISION.test(text)) return "decision";
  if (FIRST_PERSON.test(text) || REQUEST.test(text)) {
    return FOLLOW_UP.test(text) ? "follow_up" : "action";
  }
  if (QUESTION.test(text) || /\?\s*$/.test(text)) return "question";
  return null;
}

function trimStatement(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > 220 ? `${cleaned.slice(0, 217)}…` : cleaned;
}

function evidenceFor(
  conversation: NormalizedConversation,
  segment: TranscriptSegment,
): EvidenceRef[] {
  const label = `${conversation.title} · ${segment.speaker} at ${segment.at}`;
  const url = segment.url ?? conversation.sourceRef.url;
  return url ? [{ label, kind: "page", url }] : [{ label, kind: "page" }];
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

  for (const segment of conversation.segments) {
    const text = segment.text.trim();
    if (text.length < 12) continue;
    const kind = classify(text);
    if (!kind) continue;

    const statement = trimStatement(text);
    const key = sourceKeyOf(conversation, statement);
    if (seen.has(key)) continue;
    seen.add(key);

    const firstPerson = FIRST_PERSON.test(text);
    const requested = REQUEST.test(text);
    const named = requested ? namedParticipant(text, conversation) : null;
    const ownerName = firstPerson ? segment.speaker : named;
    const dueText = timingOf(text);

    const tier: Proposal["tier"] =
      kind === "decision" || (!firstPerson && kind !== "blocker") ? "inferred" : "observed";
    const confidence: Proposal["confidence"] =
      firstPerson && kind !== "decision"
        ? "high"
        : named || kind === "blocker"
          ? "moderate"
          : "low";

    proposals.push({
      id: key,
      kind,
      statement,
      tier,
      confidence,
      ownerName: ownerName ?? null,
      ownerResolved: Boolean(ownerName),
      dueText,
      dueResolved: false,
      beneficiary: null,
      quote: text,
      at: segment.at,
      segmentIndex: segment.index,
      evidence: evidenceFor(conversation, segment),
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
      ownerResolved: Boolean(item.assigneeName),
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
