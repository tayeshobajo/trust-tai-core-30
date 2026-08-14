/**
 * Candidate detection.
 *
 * The deterministic reader is demoted to a scout: it finds passages that might
 * carry work and hands each one to interpretation with enough of the
 * surrounding conversation to resolve a pronoun or a reference. It never
 * decides what becomes a commitment.
 *
 * High recall on purpose. Precision is interpretation's job.
 */

import type { CandidatePassage } from "@/domain/steward-semantic";
import type { NormalizedConversation, Proposal } from "@/domain/steward";

import { extractProposals, sourceKeyOf, stitchSegments } from "./extract";

/** Turns of surrounding conversation carried with each candidate. */
export const CONTEXT_TURNS_BEFORE = 3;
export const CONTEXT_TURNS_AFTER = 2;

const CUE_OF: Record<Proposal["kind"], CandidatePassage["cue"]> = {
  action: "promise",
  follow_up: "promise",
  decision: "decision",
  blocker: "dependency",
  question: "question",
};

/**
 * Candidate passages for one conversation, in transcript order, followed by
 * any provider action items marked as provider interpretation.
 */
export function detectCandidates(conversation: NormalizedConversation): CandidatePassage[] {
  const windows = stitchSegments(conversation.segments);
  const byIndex = new Map(windows.map((window, position) => [window.index, position]));
  const proposals = extractProposals(conversation);
  const candidates: CandidatePassage[] = [];
  const seen = new Set<string>();

  for (const proposal of proposals) {
    if (proposal.segmentIndex === Number.MAX_SAFE_INTEGER) continue;
    const position = byIndex.get(proposal.segmentIndex);
    if (position === undefined) continue;
    const window = windows[position]!;
    if (seen.has(proposal.id)) continue;
    seen.add(proposal.id);

    const from = Math.max(0, position - CONTEXT_TURNS_BEFORE);
    const to = Math.min(windows.length, position + CONTEXT_TURNS_AFTER + 1);

    candidates.push({
      id: proposal.id,
      speaker: window.speaker,
      ...(window.speakerEmail ? { speakerEmail: window.speakerEmail } : {}),
      at: window.at,
      text: window.text,
      context: windows.slice(from, to).map((entry) => ({
        speaker: entry.speaker,
        at: entry.at,
        text: entry.text,
      })),
      segments: window.segments,
      cue: CUE_OF[proposal.kind],
      evidence: proposal.evidence,
    });
  }

  for (const item of conversation.sourceActionItems) {
    const id = sourceKeyOf(conversation, item.description);
    if (seen.has(id)) continue;
    seen.add(id);
    const at = item.at ?? "00:00:00";
    /* Give the provider's item the nearby turns so it can be checked, not trusted. */
    const near = windows.filter((window) => window.at === at).slice(0, 1);
    candidates.push({
      id,
      speaker: item.assigneeName ?? "Unknown",
      ...(item.assigneeEmail ? { speakerEmail: item.assigneeEmail } : {}),
      at,
      text: item.description,
      context: near.map((entry) => ({
        speaker: entry.speaker,
        at: entry.at,
        text: entry.text,
      })),
      segments: near[0]?.segments ?? [],
      cue: "provider_action",
      providerActionItem: item.description,
      evidence: [
        {
          label: `Action item recorded by ${conversation.sourceRef.provider}`,
          kind: "provider",
          ...((item.url ?? conversation.sourceRef.url)
            ? { url: item.url ?? conversation.sourceRef.url }
            : {}),
        },
      ],
    });
  }

  return candidates;
}
