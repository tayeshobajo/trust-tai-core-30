/**
 * The Trust Tai Intelligence Runtime, shared contract.
 *
 * The law: no business app may become its own isolated AI brain. Scout, Comms,
 * Roadmap, Projects, Ops, Studio, Steward and Conductor all reason through one
 * runtime, over the same evidence discipline, the same capability registry,
 * the same problem-solving protocol and the same completion gate.
 *
 * This file is the contract those rooms share. It is pure types and small pure
 * helpers; the composition lives in src/data/intelligence/runtime/ and the
 * single provider boundary in src/lib/intelligence-runtime.server.ts.
 *
 * The contract exists so every room can reach the depth of reasoning the
 * OpenClaw diagnostic taught us (grounded retrieval before generation,
 * hypotheses separated from facts, a bounded diagnostic loop instead of giving
 * up, and proof of completion instead of "the action ran") without any room
 * inventing its own AI stack.
 */

import type { ConfidenceLevel, EvidenceRef } from "./confidence";
import type { EntityRef, ID, ISODateTime } from "./entities";
import type { Permission } from "./access";

/* ------------------------------------------------------------------ rooms */

/** A room is any registered suite app id (see src/domain/registry.ts). */
export type RuntimeRoom = string;

/* ---------------------------------------------------------------- request */

/**
 * A piece of evidence the caller already assembled, under RLS, in the room
 * that owns it. The runtime never fetches evidence itself; it reasons over
 * what it is handed and says honestly when the packet is thin.
 */
export interface RuntimeEvidenceInput {
  /** Stable reference, e.g. "obs:projects:stalled:abc" or "packet:decision:xyz". */
  id: string;
  /** The statement of fact, in plain language. */
  statement: string;
  /** The room that owns this truth. Cross-room evidence is read-only context. */
  owningRoom: RuntimeRoom;
  /** How the statement came to be true. */
  tier: "observed" | "decided" | "derived";
  /** Optional source label, e.g. "Context packet. Website Growth Sprint". */
  label?: string;
}

export type RuntimeOutputKind =
  /** What an experienced operator needs to know before acting. */
  | "operator_read"
  /** What the evidence means together. */
  | "interpretation"
  /** Words for a person to review and send. */
  | "draft"
  /** Grounded external research. */
  | "research";

export interface VerificationExpectation {
  kind: CompletionEvidenceKind;
  /** What "done" must prove, in one sentence. */
  description: string;
}

/**
 * The one shape every room uses to ask the runtime to reason. If a room's
 * question cannot be expressed as a ReasoningRequest, the room's contract is
 * wrong, not the runtime's.
 */
export interface ReasoningRequest {
  /** The owning room asking. The runtime answers for one room at a time. */
  room: RuntimeRoom;
  /** One sentence: what the operator needs to understand. */
  objective: string;
  organizationId: ID;
  /** Explicit context refs, assembled by the caller under RLS. */
  evidence: RuntimeEvidenceInput[];
  entities?: EntityRef[];
  /**
   * Operations the answer may recommend, from the suite capability registry
   * (src/domain/intelligence-capabilities.ts). A next step naming anything
   * outside this list is rejected at verification.
   */
  allowedOperations: string[];
  output: RuntimeOutputKind;
  /** The human boundary. Nothing the read recommends outruns it. */
  approval: {
    required: boolean;
    /** The permission a person must hold to approve, when known. */
    permission?: Permission;
  };
  /** What completion would have to prove if a next step is executed. */
  verification: VerificationExpectation;
  now: ISODateTime;
}

/* -------------------------------------------------------------- the read */

/** A statement of fact. Grounded in supplied evidence, or it is not a fact. */
export interface RuntimeFact {
  statement: string;
  /** Ids into the request's evidence / retrieval bundle. At least one. */
  evidenceRefs: string[];
}

/** What the facts may mean together. Labelled inference, never fact. */
export interface RuntimeInterpretation {
  claim: string;
  because: string;
  /** Evidence ids this interpretation rests on. */
  restsOn: string[];
  theme?: string;
}

/** Knowledge the retrieval layer brought to the read. */
export interface RetrievedKnowledgeRef {
  kind:
    | "canon_pattern"
    | "diagnostic_chain"
    | "prior_case"
    | "human_correction"
    | "capability"
    | "context_packet";
  id: string;
  label: string;
  note?: string;
}

/**
 * A bounded next step. "Bounded" means it says what it will do, what it will
 * not do, and whose authority it needs, before anyone is asked to approve it.
 */
export interface RuntimeNextStep {
  title: string;
  owningRoom: RuntimeRoom;
  /** Must be one of the request's allowedOperations when present. */
  operation?: string;
  requiresApproval: boolean;
  willDo: string[];
  willNotDo: string[];
  reversible: boolean;
  /** Leaves the building, a person carries it; the suite never does. */
  external: boolean;
}

export interface RuntimeVerificationRequirement {
  /** The claim that will need proving. */
  claim: string;
  evidenceKind: CompletionEvidenceKind;
  description: string;
}

/**
 * The structured operator output. This is what rooms show people. It is
 * deliberately not prose-first: facts, interpretations, knowledge, unknowns,
 * next steps, confidence and verification are separate fields so no room can
 * blur them together, and provenance is carried on every part.
 *
 * The runtime never emits chain-of-thought. Interpretations carry "because"
 * lines that cite evidence refs; the reasoning that produced them stays
 * inside the boundary.
 */
export interface RuntimeRead {
  room: RuntimeRoom;
  objective: string;
  /** Grounded statements only. Each cites at least one evidence ref. */
  facts: RuntimeFact[];
  /** Inferences, separated from facts. Never presented as observations. */
  interpretations: RuntimeInterpretation[];
  /** Knowledge that informed the read (patterns, cases, corrections). */
  knowledge: RetrievedKnowledgeRef[];
  /** What the evidence cannot answer. Silence is a valid answer. */
  unknowns: string[];
  /** Bounded next steps, each within the capability registry. */
  nextSteps: RuntimeNextStep[];
  /** Capped by the evidence that exists. Never stronger than the packet. */
  confidence: ConfidenceLevel;
  /** What must be proven for any executed step to count as done. */
  verification: RuntimeVerificationRequirement[];
  provenance: {
    evidenceRefs: string[];
    knowledgeRefs: string[];
    /** Rooms that could not be read; the read never guesses about them. */
    withheld: { appId: string; reason: string }[];
  };
  /** False when the read is deterministic only (no model was consulted). */
  reasonedByModel: boolean;
  generatedAt: ISODateTime;
}

/** An empty, honest read. Thin evidence is named, never papered over. */
export function emptyRuntimeRead(input: {
  room: RuntimeRoom;
  objective: string;
  unknowns: string[];
  withheld?: { appId: string; reason: string }[];
  now: ISODateTime;
}): RuntimeRead {
  return {
    room: input.room,
    objective: input.objective,
    facts: [],
    interpretations: [],
    knowledge: [],
    unknowns: input.unknowns,
    nextSteps: [],
    confidence: "unknown",
    verification: [],
    provenance: {
      evidenceRefs: [],
      knowledgeRefs: [],
      withheld: input.withheld ?? [],
    },
    reasonedByModel: false,
    generatedAt: input.now,
  };
}

/* ---------------------------------------------- confidence, tied to proof */

const CONFIDENCE_ORDER: ConfidenceLevel[] = ["unknown", "low", "moderate", "high"];

/**
 * The runtime's confidence can never outrun its evidence: no evidence means
 * "unknown", one source means at most "low", two means at most "moderate".
 * "high" requires three or more independent sources. The runtime has no
 * "proven" tier, proof is the verification gate's job, not a label.
 */
export function runtimeConfidence(evidenceCount: number): ConfidenceLevel {
  if (evidenceCount <= 0) return "unknown";
  if (evidenceCount === 1) return "low";
  if (evidenceCount === 2) return "moderate";
  return "high";
}

/** The strongest confidence a read may claim, given its evidence. */
export function capConfidence(level: ConfidenceLevel, evidenceCount: number): ConfidenceLevel {
  const cap = runtimeConfidence(evidenceCount);
  return CONFIDENCE_ORDER.indexOf(level) > CONFIDENCE_ORDER.indexOf(cap) ? cap : level;
}

/* ------------------------------------------- the problem-solving protocol */

/**
 * The protocol every reasoning pass follows, in order. It is a contract, not
 * a suggestion: a room that "couldn't complete" without naming the next
 * bounded diagnostic step or the exact escalation reason has not finished.
 */
export const PROTOCOL_STAGES = [
  "inspect",
  "retrieve",
  "hypothesise",
  "test_safely",
  "observe_evidence",
  "adjust",
  "act_within_boundary",
  "verify",
  "escalate",
] as const;

export type ProtocolStage = (typeof PROTOCOL_STAGES)[number];

export interface ProtocolAttempt {
  stage: ProtocolStage;
  /** What was tried, in one sentence. */
  action: string;
  outcome: "success" | "failed" | "blocked";
  /** Evidence reference when the attempt produced some. */
  evidence?: string;
}

/* ------------------------------------------------------- completion gate */

export type CompletionEvidenceKind =
  /** A test ran and its result is on record. */
  | "test_result"
  /** A state the suite can re-read actually changed. */
  | "changed_state"
  /** The external system answered and the response is on record. */
  | "api_response"
  /** Something reviewable now exists. */
  | "artifact"
  /** A named acceptance criterion was met. */
  | "acceptance_criterion"
  /** The receiving room acknowledged the handoff. */
  | "downstream_receipt"
  /** A person with authority accepted the outcome. */
  | "human_acceptance";

export interface CompletionEvidence {
  kind: CompletionEvidenceKind;
  /** Where the proof lives: a test name, an event id, a URL, an artifact id. */
  reference: string;
  observedAt: ISODateTime;
  note?: string;
}

/**
 * "Done" is a claim that must carry proof. The gate, implemented in
 * src/data/intelligence/runtime/verification.ts, refuses any completion
 * whose only evidence is that an action ran.
 */
export interface CompletionClaim {
  room: RuntimeRoom;
  /** What work this claims to have completed. */
  workRef: string;
  claimedBy: "person" | "runtime" | "adapter" | "agent";
  /** True when an action executed. Never sufficient on its own. */
  actionRan: boolean;
  evidence: CompletionEvidence[];
  /** The acceptance criterion the work was judged against, when named. */
  acceptanceCriterion?: string;
}

/* ------------------------------------------------- the readiness manifest */

/**
 * The eight aspects every suite room must account for before its reasoning is
 * considered trustworthy. The manifest lives in
 * src/data/intelligence/runtime/manifest.ts; the acceptance tests enforce it.
 */
export type ReadinessAspect =
  /** Facts come from supplied evidence, never invented. */
  | "evidence_grounding"
  /** The room composes canon, cases, decisions and room state before asking. */
  | "retrieval"
  /** Domain pattern libraries exist for the room's kind of work. */
  | "domain_patterns"
  /** The read knows what the room can actually do before recommending it. */
  | "capability_awareness"
  /** Failure produces a bounded next diagnostic step, not a dead end. */
  | "safe_diagnostic_loop"
  /** Completion requires proof; "the action ran" is not proof. */
  | "verification"
  /** The human authorization boundary is enforced, not assumed. */
  | "approval_boundary"
  /** Outcomes feed back into the canon so experience accumulates. */
  | "outcome_learning";

/**
 * Three honest states. There is deliberately no "partial": machinery that
 * exists but is not wired into the room's reasoning is NOT READY, because a
 * nice shell that cannot solve problems is exactly the failure mode this
 * contract exists to prevent.
 */
export type AspectState =
  /** The room itself provably satisfies the dimension, with code evidence. */
  | "ready"
  /**
   * A named architectural equivalent elsewhere covers the dimension (for
   * example a read-only room whose diagnostic loop lives in the runtime it
   * calls). Requires delegatedTo and because.
   */
  | "delegated"
  /** The dimension is missing. Blocks readiness. */
  | "not_ready";

export interface ReadinessAspectReport {
  state: AspectState;
  /** Where the aspect is backed, in code or configuration. */
  evidence: string;
  /** Required when state is "delegated": what covers this dimension. */
  delegatedTo?: string;
  /** Required when state is "delegated": why the equivalent is real. */
  because?: string;
}

export interface RoomReadinessManifest {
  room: RuntimeRoom;
  layer: "core" | "business" | "stewardship" | "intelligence";
  aspects: Record<ReadinessAspect, ReadinessAspectReport>;
}

/**
 * The floor. Every active room must account for all eight dimensions: a room
 * with evidence, capability and verification but no reusable knowledge or no
 * recovery loop is NOT READY. A dimension may only be delegated when the
 * manifest names the architectural equivalent and why.
 */
export const REQUIRED_ASPECTS: ReadinessAspect[] = [
  "evidence_grounding",
  "retrieval",
  "domain_patterns",
  "capability_awareness",
  "safe_diagnostic_loop",
  "verification",
  "approval_boundary",
  "outcome_learning",
];

/** A delegation is real only when it names the equivalent and the reason. */
export function delegationIsValid(report: ReadinessAspectReport): boolean {
  return (
    report.state !== "delegated" ||
    (Boolean(report.delegatedTo?.trim()) && Boolean(report.because?.trim()))
  );
}

/** Flatten a manifest aspect record for display. */
export function manifestAspects(
  manifest: RoomReadinessManifest,
): { aspect: ReadinessAspect; state: AspectState; evidence: string }[] {
  return (Object.keys(manifest.aspects) as ReadinessAspect[]).map((aspect) => ({
    aspect,
    state: manifest.aspects[aspect].state,
    evidence: manifest.aspects[aspect].evidence,
  }));
}

/** Re-exported so runtime callers have one import site for evidence refs. */
export type { EvidenceRef };
