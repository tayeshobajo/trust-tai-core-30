/**
 * Semantic meeting interpretation (server only).
 *
 * Rules find candidate passages. This is where meaning is read: a bounded
 * window of one real conversation, the people in it, and whatever canonical
 * memory the caller was authorized to pass, handed to a model that must answer
 * in a strict shape and is allowed — expected — to say "this is only context"
 * or "I cannot tell".
 *
 * Fails closed. With no provider configured, nothing is interpreted and the
 * deterministic candidates are never promoted in its place.
 */

import type { Commitment, NormalizedConversation } from "@/domain/steward";
import type {
  CandidatePassage,
  InterpretationRun,
  InterpretedSignal,
  MemoryContext,
} from "@/domain/steward-semantic";
import { detectCandidates } from "@/data/steward/candidates";
import { interpretationBatchSchema, toSignal } from "@/data/steward/interpretation";

import { callRoadmapProvider, extractJsonObject } from "./roadmap-research.server";

export class InterpretationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InterpretationUnavailableError";
  }
}

/** Passages read in one model call. Small enough to keep context honest. */
const BATCH_SIZE = 6;

const LAWS = [
  "Every speaker is a person, not a task source. Never grade, score, or shame anyone.",
  "Historical recollection, description of past behaviour, and ability or capability are context_only, never commitments.",
  "Coaching, criticism, opinion, aspiration, brainstorming and hypotheticals are context_only unless a person clearly accepts ownership of a future action.",
  "'We need to...' is only a commitment when a named person accepts it in the surrounding turns.",
  "'I will...' can still be rhetorical. Use the surrounding turns to judge intent.",
  "If a referent such as that, it, the plan, or once confirmed cannot be resolved from the surrounding turns, answer insufficient_evidence and say what is unclear.",
  "If speech is transcription-corrupted, interpret only when the meaning is strongly recoverable from the surrounding turns. Otherwise withhold.",
  "Distinguish information from signal, signal from commitment, and commitment from task.",
  "A dependency may have one owner and a different person being waited on.",
  "Reason person-first: use known_people roles and responsibilities to judge who realistically owns an action, and prefer the person whose role fits over whoever spoke last.",
  "When a role clearly implies the owner but nobody named them, keep owner_confidence at moderate or low and set truth_tier to inferred.",
  "decided_memory is what a human being has already corrected or confirmed. Treat it as settled and do not re-litigate it.",
  "inferred_memory is Steward's own reading of repeated evidence. It is context only. Never treat it as fact, and never let it override what this transcript plainly says.",
  "If memory and this transcript disagree, follow the transcript, say so in ambiguity, and never silently overwrite what a person decided.",
  "Provider action items are another tool's interpretation. Compare against the transcript; never treat them as truth.",
  "Never invent an owner, a date, a project, or a beneficiary. due_text carries spoken words only, never a calendar date.",
  "truth_tier is observed when the words themselves carry it, inferred when you worked it out. It is never decided.",
  "normalized_meaning is one concise operational sentence in plain English that a reader can act on without reading the transcript. Never copy raw speech.",
].join(" ");


function instructions(): string {
  return [
    "You are Steward, reading one real meeting for what actually happened, and you return json only.",
    "You interpret. Rules constrain you. Human beings decide. Restraint is more useful than volume.",
    LAWS,
    "Return json with an interpretations array holding exactly one object per candidate you were given, keyed by candidate_id.",
  ].join(" ");
}

function payload(
  conversation: NormalizedConversation,
  candidates: CandidatePassage[],
  memory: MemoryContext,
): string {
  return JSON.stringify({
    task: "Interpret each candidate passage from this meeting and return json.",
    meeting: {
      title: conversation.title,
      occurred_at: conversation.occurredAt,
      participants: conversation.participants.map((person) => ({
        name: person.name,
        email: person.email ?? null,
      })),
    },
    canonical_memory: memory.available
      ? {
          available: true,
          known_people: memory.people,
          projects: memory.projects,
          open_commitments: memory.openCommitments,
        }
      : { available: false, because: memory.because },
    candidates: candidates.map((candidate) => ({
      candidate_id: candidate.id,
      speaker: candidate.speaker,
      at: candidate.at,
      focus_text: candidate.text,
      surrounding_turns: candidate.context,
      detector_cue: candidate.cue,
      provider_action_item: candidate.providerActionItem ?? null,
    })),
    json_shape: {
      interpretations: [
        {
          candidate_id: "copied exactly from the candidate",
          disposition:
            "commitment | decision | dependency | unresolved_question | context_only | duplicate | already_completed | insufficient_evidence",
          normalized_meaning: "one concise operational sentence, plain English",
          owner: "person name or null",
          owner_confidence: "high | moderate | low | unknown",
          beneficiary: "person name or null",
          due_text: "spoken timing words or null",
          project_label: "canonical project label or null",
          confidence: "high | moderate | low | unknown",
          truth_tier: "observed | inferred",
          rationale: "one short sentence on why you read it this way",
          dependency_on: "what is being waited on, or null",
          blocked_by: "who is being waited on, or null",
          duplicate_of: "existing commitment id, or null",
          ambiguity: "what remains unclear, or empty string",
        },
      ],
    },
  });
}

export interface InterpretInput {
  conversation: NormalizedConversation;
  memory: MemoryContext;
  commitments: Commitment[];
  candidates?: CandidatePassage[];
  gateway?: Parameters<typeof callRoadmapProvider>[2]["gateway"];
  initialRunId?: string | undefined;
}

/**
 * Interpret one conversation. Read-only: nothing is written and nothing is
 * confirmed. A model failure throws, so the caller can say so honestly rather
 * than promoting regex output.
 */
export async function interpretConversation(input: InterpretInput): Promise<InterpretationRun> {
  const candidates = input.candidates ?? detectCandidates(input.conversation);
  const signals: InterpretedSignal[] = [];
  let provider = "";
  let model = "";

  for (let index = 0; index < candidates.length; index += BATCH_SIZE) {
    const batch = candidates.slice(index, index + BATCH_SIZE);
    let raw: string;
    try {
      const result = await callRoadmapProvider(
        instructions(),
        payload(input.conversation, batch, input.memory),
        {
          webSearch: false,
          gateway: input.gateway,
          initialRunId: input.initialRunId,
        },
      );
      raw = result.raw;
      provider = result.provider;
      model = result.model;
    } catch (error) {
      throw new InterpretationUnavailableError(
        error instanceof Error
          ? `Steward could not interpret this conversation: ${error.message}`
          : "Steward could not interpret this conversation.",
      );
    }

    const parsed = interpretationBatchSchema.safeParse(extractJsonObject(raw));
    if (!parsed.success) {
      throw new InterpretationUnavailableError(
        "Steward's interpretation came back in a shape it will not trust, so nothing was read.",
      );
    }

    const byId = new Map(batch.map((candidate) => [candidate.id, candidate]));
    for (const entry of parsed.data.interpretations) {
      const candidate = byId.get(entry.candidate_id);
      if (!candidate) continue;
      signals.push(toSignal(entry, candidate, input.commitments));
    }
  }

  return {
    conversationTitle: input.conversation.title,
    occurredAt: input.conversation.occurredAt,
    candidateCount: candidates.length,
    signals,
    memory: { available: input.memory.available, because: input.memory.because },
    provider,
    model,
    generatedAt: new Date().toISOString(),
  };
}
