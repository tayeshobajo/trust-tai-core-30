/**
 * The brief composer (server only).
 *
 * One opportunity in, one draft brief out: title candidates that each say what
 * is familiar and what is fresh, a first paragraph that has to earn the second,
 * and the End, Beginning, Middle, Landing spine of Canon 28.
 *
 * It reasons only through the intelligence runtime boundary, over the shared
 * retrieval bundle, so the brief reads the same workspace every other room
 * reads. It writes nothing: the room persists what a person keeps.
 *
 * Honesty: when no provider answers, this returns a failure with the reason.
 * Studio says so plainly rather than showing a hollow brief.
 */

import type { createLovableAiGatewayRunIdFetch } from "./ai-gateway.server";
import { readIntelligenceCases } from "./intelligence-cases.server";
import {
  extractJsonObject,
  ProviderCallFailedError,
  ProviderNotConfiguredError,
  runtimeModelCaller,
} from "./intelligence-runtime.server";
import {
  composeStudioRetrieval,
  studioRetrievalPacket,
  STUDIO_RETRIEVAL_LAWS,
} from "./studio-retrieval";
import {
  EMPTY_IMAGE_PLAN,
  type ContentBrief,
  type NarrativeSpine,
  type TitleCandidate,
} from "@/domain/content-brief";

const BRIEF_INSTRUCTIONS = [
  "You are the editorial brief writer for Trust Tai, a small services business that builds operating systems for founders.",
  "You are given one content opportunity: a phrase people actually searched for, the observed evidence behind it, and Studio's deterministic reading of it. Return json only.",
  'Return exactly these keys: {"core_idea","angle","audience_language":[],"title_candidates":[{"title","familiarity_anchor","fresh_turn","intent_fit"}],"opening":{"first_paragraph","why_it_earns_paragraph_two"},"spine":{"end","beginning","middle":[],"landing","structure_choice","why_this_structure"},"seo":{"primary_language":[],"intent","overlap_risk"}}.',
  "core_idea: the one thing this piece is actually about, in a sentence a person would say out loud.",
  "angle: why Trust Tai is the one writing it, without saying so in marketing language.",
  "title_candidates: two or three. Each names the part a reader already recognises (familiarity_anchor), the turn that makes it worth reading anyway (fresh_turn), and why it fits what the reader was after (intent_fit). No scores. No keyword stuffing.",
  "opening.first_paragraph: the actual first paragraph, written, not described. opening.why_it_earns_paragraph_two: one sentence on what makes a reader continue.",
  'spine: write the end first. structure_choice is "end_first" unless a different shape is genuinely better, in which case use "other" and say why in why_this_structure. middle is 3 to 5 movements, each one line.',
  "seo.primary_language: the phrasings people actually used, verbatim from the evidence. Never invent one. overlap_risk: name the page of ours that competes, or null.",
  "Do not invent statistics, client names, case studies, prices or figures. Do not restate an unknown metric as zero.",
  "Voice: warm, calm, direct, first person where a person is speaking. Commercially intelligent, never salesy. No hype. Never use em dashes. Short sentences. Concrete nouns.",
  "Every sentence must fail this test: could it belong to another company if the name changed? If it could, rewrite it.",
].join(" ");

export interface BriefRequest {
  token: string;
  organizationId: string;
  /** The opportunity this brief comes from. */
  opportunityId: string;
  phrase: string;
  /** Observed evidence, already formatted as sentences by the caller. */
  observed: string[];
  /** The phrasings people typed, verbatim. */
  audienceLanguage: string[];
  /** Studio's deterministic reading, carried as derived context. */
  studioRead: string;
  /** What Studio suggested doing, in words. */
  suggestedMove: string;
  /** Pages we already publish, so overlap is real rather than imagined. */
  knownPages?: { path: string; title: string }[];
  /** What a person already corrected or decided about this row. */
  decided?: string[];
  gateway?: ReturnType<typeof createLovableAiGatewayRunIdFetch> | undefined;
}

export type BriefResult =
  | { ok: true; brief: ContentBrief; provider: string; model: string }
  | { ok: false; because: string };

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const strings = (value: unknown, limit: number): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => str(entry))
        .filter(Boolean)
        .slice(0, limit)
    : [];

function toTitles(value: unknown): TitleCandidate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const raw = (entry ?? {}) as Record<string, unknown>;
      return {
        title: str(raw["title"]),
        familiarityAnchor: str(raw["familiarity_anchor"]),
        freshTurn: str(raw["fresh_turn"]),
        intentFit: str(raw["intent_fit"]),
      };
    })
    .filter((candidate) => candidate.title)
    .slice(0, 3);
}

function toSpine(value: unknown): NarrativeSpine {
  const raw = (value ?? {}) as Record<string, unknown>;
  const shape = str(raw["structure_choice"]) === "other" ? "other" : "end_first";
  return {
    end: str(raw["end"]),
    beginning: str(raw["beginning"]),
    middle: strings(raw["middle"], 6),
    landing: str(raw["landing"]),
    structureChoice: shape,
    whyThisStructure: str(raw["why_this_structure"]),
  };
}

/** Compose a draft brief. Never writes, never publishes, never decides. */
export async function composeBrief(request: BriefRequest): Promise<BriefResult> {
  let callModel;
  try {
    callModel = await runtimeModelCaller({
      token: request.token,
      organizationId: request.organizationId,
      room: "studio",
      purpose: "studio_brief",
    });
  } catch (error) {
    if ((error as Error).message === "forbidden") throw error;
    return { ok: false, because: "Studio could not reach the intelligence runtime just now." };
  }

  const ledger = await readIntelligenceCases(request.token, request.organizationId);
  const retrieval = studioRetrievalPacket(
    composeStudioRetrieval({
      organizationId: request.organizationId,
      subject: request.phrase,
      observed: request.observed,
      ...(request.knownPages ? { knownPages: request.knownPages } : {}),
      ...(request.decided ? { decided: request.decided } : {}),
      derived: [request.studioRead, `Studio suggested: ${request.suggestedMove}`].filter(Boolean),
      cases: ledger.cases,
      withheld: ledger.withheld,
    }),
    request.phrase,
  );

  let raw: string;
  let provider: string;
  let model: string;
  try {
    const answer = await callModel({
      instructions: `${BRIEF_INSTRUCTIONS}\n\n${STUDIO_RETRIEVAL_LAWS}`,
      input: JSON.stringify({
        retrieval,
        opportunity: {
          phrase: request.phrase,
          audience_language: request.audienceLanguage,
          observed: request.observed,
          studio_read: request.studioRead,
          suggested_move: request.suggestedMove,
        },
      }),
      webSearch: false,
      ...(request.gateway ? { gateway: request.gateway } : {}),
    });
    raw = answer.raw;
    provider = answer.provider;
    model = answer.model;
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      return {
        ok: false,
        because: "No intelligence provider is configured, so no brief was written.",
      };
    }
    if (error instanceof ProviderCallFailedError) {
      return {
        ok: false,
        because: "The intelligence provider did not answer, so no brief was written.",
      };
    }
    throw error;
  }

  const parsed = extractJsonObject(raw) as Record<string, unknown>;
  const seo = (parsed["seo"] ?? {}) as Record<string, unknown>;
  const opening = (parsed["opening"] ?? {}) as Record<string, unknown>;

  const brief: ContentBrief = {
    id: "",
    organizationId: request.organizationId,
    coreIdea: str(parsed["core_idea"]),
    angle: str(parsed["angle"]),
    audienceLanguage: strings(parsed["audience_language"], 12),
    titleCandidates: toTitles(parsed["title_candidates"]),
    chosenTitle: null,
    opening: {
      firstParagraph: str(opening["first_paragraph"]),
      whyItEarnsParagraphTwo: str(opening["why_it_earns_paragraph_two"]),
    },
    spine: toSpine(parsed["spine"]),
    seo: {
      primaryLanguage: strings(seo["primary_language"], 12),
      intent: str(seo["intent"]),
      evidenceRefs: [`opportunity:${request.opportunityId}`],
      overlapRisk: str(seo["overlap_risk"]) || null,
    },
    imagePlan: { ...EMPTY_IMAGE_PLAN },
    sourceOpportunityId: request.opportunityId,
    state: "draft",
  };

  if (!brief.coreIdea && brief.titleCandidates.length === 0 && !brief.opening.firstParagraph) {
    return {
      ok: false,
      because: "The brief came back empty, so nothing is being shown as a brief.",
    };
  }

  return { ok: true, brief, provider, model };
}
