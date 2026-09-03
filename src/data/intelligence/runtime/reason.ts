/**
 * The reasoning pass, assemble, verify, return.
 *
 * Two pure functions rooms compose around:
 *
 * - assembleDeterministicRead: the read the runtime produces with no model at
 *   all. Facts from evidence, knowledge from retrieval, unknowns named. Rooms
 *   degrade to this instead of going blank.
 *
 * - verifyRuntimeRead: the gate every model-produced read passes through
 *   before a person sees it. Facts must cite real evidence refs;
 *   interpretations must rest on real refs and never contradict a person's
 *   decisions; next steps must stay inside the capability registry and the
 *   approval boundary; confidence is capped by the evidence that exists;
 *   invented numbers are dropped with the claim that carried them.
 */

import type { ID } from "@/domain/entities";
import type { ConfidenceLevel } from "@/domain/confidence";
import {
  capConfidence,
  emptyRuntimeRead,
  runtimeConfidence,
  type CompletionEvidenceKind,
  type ReasoningRequest,
  type RetrievedKnowledgeRef,
  type RuntimeFact,
  type RuntimeInterpretation,
  type RuntimeNextStep,
  type RuntimeRead,
  type RuntimeVerificationRequirement,
} from "@/domain/intelligence-runtime";
import { operationIsExternal, operationIsRecommendable } from "@/domain/intelligence-capabilities";

import { contradicts } from "../engine/verify";
import { citableRefs, type RetrievalBundle } from "./retrieval";

/* ------------------------------------------------- model output, on the wire */

export interface RawRuntimeRead {
  facts?: { statement?: string; evidenceRefs?: string[] }[];
  interpretations?: { claim?: string; because?: string; restsOn?: string[]; theme?: string }[];
  unknowns?: string[];
  nextSteps?: {
    title?: string;
    owningRoom?: string;
    operation?: string;
    willDo?: string[];
    willNotDo?: string[];
    reversible?: boolean;
  }[];
  verification?: { claim?: string; evidenceKind?: string; description?: string }[];
  confidence?: string;
  operatorSummary?: string;
}

export interface VerifiedRuntimeRead {
  read: RuntimeRead;
  /** Claims the gate refused, and why. Shown on request, never hidden. */
  rejected: { claim: string; because: string }[];
}

const EVIDENCE_KINDS: CompletionEvidenceKind[] = [
  "test_result",
  "changed_state",
  "api_response",
  "artifact",
  "acceptance_criterion",
  "downstream_receipt",
  "human_acceptance",
];

const CONFIDENCE_LEVELS: ConfidenceLevel[] = ["unknown", "low", "moderate", "high"];

/* Numbers a claim uses must exist in the evidence it cites. */
const NUMBER_PATTERN = /[$£€]?\d[\d,]*(?:\.\d+)?%?/g;

function numbersIn(text: string): string[] {
  return (text.match(NUMBER_PATTERN) ?? []).map((token) => token.replace(/,/g, ""));
}

function inventsNumbers(statement: string, sources: string[]): boolean {
  const pool = sources.flatMap((source) => numbersIn(source));
  return numbersIn(statement).some((token) => !pool.includes(token));
}

/**
 * Verify a model-produced read against the retrieval bundle it was given.
 * Anything untraceable is dropped with a reason; the read stays honest.
 */
export function verifyRuntimeRead(input: {
  raw: RawRuntimeRead;
  request: ReasoningRequest;
  bundle: RetrievalBundle;
}): VerifiedRuntimeRead {
  const { raw, request, bundle } = input;
  const refs = citableRefs(bundle);
  const evidenceByRef = new Map(bundle.evidence.map((item) => [item.id, item.statement]));
  const rejected: { claim: string; because: string }[] = [];

  const facts: RuntimeFact[] = [];
  for (const candidate of raw.facts ?? []) {
    const statement = candidate.statement?.trim();
    if (!statement) continue;
    const cited = (candidate.evidenceRefs ?? []).filter((ref) => refs.has(ref));
    if (cited.length === 0) {
      rejected.push({ claim: statement, because: "not grounded in the packet's evidence" });
      continue;
    }
    if (
      inventsNumbers(
        statement,
        cited.map((ref) => evidenceByRef.get(ref) ?? ""),
      )
    ) {
      rejected.push({
        claim: statement,
        because: "uses a number that does not appear in the cited evidence",
      });
      continue;
    }
    facts.push({ statement, evidenceRefs: cited });
  }

  const interpretations: RuntimeInterpretation[] = [];
  for (const candidate of raw.interpretations ?? []) {
    const claim = candidate.claim?.trim();
    if (!claim) continue;
    const restsOn = (candidate.restsOn ?? []).filter((ref) => refs.has(ref));
    if (restsOn.length === 0) {
      rejected.push({ claim, because: "an interpretation must rest on cited evidence" });
      continue;
    }
    const contradiction = bundle.decided.find((statement) => contradicts(claim, statement));
    if (contradiction) {
      rejected.push({
        claim,
        because: `contradicts a person's decision: "${contradiction}"`,
      });
      continue;
    }
    interpretations.push({
      claim,
      because: candidate.because?.trim() ?? "",
      restsOn,
      ...(candidate.theme ? { theme: candidate.theme } : {}),
    });
  }

  const nextSteps: RuntimeNextStep[] = [];
  for (const candidate of raw.nextSteps ?? []) {
    const title = candidate.title?.trim();
    if (!title) continue;
    const owningRoom = candidate.owningRoom?.trim() ?? request.room;
    const operation = candidate.operation?.trim();

    if (operation && request.allowedOperations.length > 0) {
      if (!request.allowedOperations.includes(operation)) {
        rejected.push({
          claim: title,
          because: `operation "${operation}" was not among the allowed operations`,
        });
        continue;
      }
      if (owningRoom === request.room && !operationIsRecommendable(owningRoom, operation)) {
        rejected.push({
          claim: title,
          because: `the capability registry does not route "${operation}" in ${owningRoom}`,
        });
        continue;
      }
    }

    const external = operation ? operationIsExternal(owningRoom, operation) : false;
    nextSteps.push({
      title,
      owningRoom,
      ...(operation ? { operation } : {}),
      requiresApproval: request.approval.required || external,
      willDo: (candidate.willDo ?? []).filter((line) => typeof line === "string" && line.trim()),
      willNotDo: (candidate.willNotDo ?? []).filter(
        (line) => typeof line === "string" && line.trim(),
      ),
      reversible: candidate.reversible ?? true,
      external,
    });
  }

  const verification: RuntimeVerificationRequirement[] = [];
  for (const candidate of raw.verification ?? []) {
    const claimText = candidate.claim?.trim();
    const kind = candidate.evidenceKind as CompletionEvidenceKind;
    if (!claimText || !EVIDENCE_KINDS.includes(kind)) continue;
    verification.push({
      claim: claimText,
      evidenceKind: kind,
      description: candidate.description?.trim() ?? claimText,
    });
  }
  if (verification.length === 0 && nextSteps.length > 0) {
    verification.push({
      claim: nextSteps[0]!.title,
      evidenceKind: request.verification.kind,
      description: request.verification.description,
    });
  }

  const modelConfidence = CONFIDENCE_LEVELS.includes(raw.confidence as ConfidenceLevel)
    ? (raw.confidence as ConfidenceLevel)
    : runtimeConfidence(bundle.evidence.length);
  const confidence = capConfidence(modelConfidence, bundle.evidence.length);

  const unknowns = (raw.unknowns ?? []).filter(
    (line): line is string => typeof line === "string" && line.trim().length > 0,
  );

  const knowledge: RetrievedKnowledgeRef[] = bundle.knowledge;

  const read: RuntimeRead = {
    room: request.room,
    objective: request.objective,
    facts,
    interpretations,
    knowledge,
    unknowns,
    nextSteps,
    confidence,
    verification,
    provenance: {
      evidenceRefs: facts.flatMap((fact) => fact.evidenceRefs),
      knowledgeRefs: knowledge.map((item) => item.id),
      withheld: bundle.withheld,
    },
    reasonedByModel: true,
    generatedAt: request.now,
  };

  return { read, rejected };
}

/* ------------------------------------------- the deterministic fallback */

/**
 * The read with no model: facts straight from the evidence, knowledge from
 * retrieval, unknowns named. This is what a room shows when reasoning is
 * unavailable, honest, grounded, and never blank.
 */
export function assembleDeterministicRead(
  request: ReasoningRequest,
  bundle: RetrievalBundle,
): RuntimeRead {
  if (bundle.evidence.length === 0) {
    return emptyRuntimeRead({
      room: request.room,
      objective: request.objective,
      unknowns: ["No evidence was supplied for this question."],
      withheld: bundle.withheld,
      now: request.now,
    });
  }

  const facts: RuntimeFact[] = bundle.evidence.map((item) => ({
    statement: item.statement,
    evidenceRefs: [item.id],
  }));

  return {
    room: request.room,
    objective: request.objective,
    facts,
    interpretations: [],
    knowledge: bundle.knowledge,
    unknowns: bundle.withheld.map((row) => `${row.appId} could not be read: ${row.reason}`),
    nextSteps: [],
    confidence: runtimeConfidence(bundle.evidence.length),
    verification: [],
    provenance: {
      evidenceRefs: bundle.evidence.map((item) => item.id),
      knowledgeRefs: bundle.knowledge.map((item) => item.id),
      withheld: bundle.withheld,
    },
    reasonedByModel: false,
    generatedAt: request.now,
  };
}

/* ------------------------------------------------- the one-line packet id */

export function readId(room: string, now: string): ID {
  return `read:${room}:${now}`;
}
