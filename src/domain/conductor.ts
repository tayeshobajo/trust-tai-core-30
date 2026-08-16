/**
 * Trust Tai OS — the Conductor contract.
 *
 * The Conductor coordinates. Steward interprets. Owning rooms execute.
 *
 * It is not a peer business app and it owns no domain entity. It is the
 * command layer over Steward and the Intelligence Engine: one conversational
 * surface where a person can ask the whole factory what is happening, what it
 * is trying to achieve, where it is leaking, and what should happen next.
 *
 * Laws encoded here rather than hoped for:
 *
 *   - Four bases, never blurred. `observed` is read from a room, `decided` is
 *     a person's commitment, `derived` is arithmetic over the two, `unknown`
 *     is the honest answer when the instrument does not exist. A derived value
 *     may never rest on an unknown input.
 *   - No invented numbers. A target with no human decision behind it is not a
 *     target, it is a blind spot.
 *   - No parallel truth. Business intent rides Steward's append-only belief
 *     ledger; conversation rides the shared activity stream; everything else
 *     is derived on read from the suite snapshot.
 *   - Control is proposal-shaped. The Conductor may draft, decompose and
 *     route; consequential work is authorised by a person and executed by the
 *     room that owns it, through that room's existing service boundary.
 */

import type { EvidenceRef } from "./confidence";
import type { ID, ISODateTime } from "./entities";
import type { ActionProposal } from "./intelligence-engine";

/* ------------------------------------------------------------------ basis */

/**
 * Where a value came from. This is the spine of the whole subsystem: every
 * number the Conductor says out loud carries one of these, and they never
 * collapse into each other.
 */
export type ValueBasis =
  /** Counted or dated from a room's own record. */
  | "observed"
  /** A person committed to it. Outranks anything worked out. */
  | "decided"
  /** Arithmetic over observed and decided values only. */
  | "derived"
  /** Not instrumented. Said plainly, never filled in. */
  | "unknown";

export const VALUE_BASIS_LABEL: Record<ValueBasis, string> = {
  observed: "Observed",
  decided: "Decided by you",
  derived: "Derived",
  unknown: "Unknown",
};

/* --------------------------------------------------------- business intent */

/** The kinds of outcome a services business steers by. */
export type BusinessGoalKind =
  | "revenue"
  | "qualified_pipeline"
  | "retention"
  | "delivery_health"
  | "client_satisfaction"
  | "utilization"
  | "authority"
  | "reliability"
  | "custom";

export const BUSINESS_GOAL_LABEL: Record<BusinessGoalKind, string> = {
  revenue: "Revenue",
  qualified_pipeline: "Qualified pipeline",
  retention: "Retention",
  delivery_health: "Delivery health",
  client_satisfaction: "Client satisfaction",
  utilization: "Capacity and utilization",
  authority: "Content and authority",
  reliability: "Operational reliability",
  custom: "Business outcome",
};

export type GoalHorizon = "month" | "quarter" | "year";

export const GOAL_HORIZON_LABEL: Record<GoalHorizon, string> = {
  month: "this month",
  quarter: "this quarter",
  year: "this year",
};

export const GOAL_HORIZON_DAYS: Record<GoalHorizon, number> = {
  month: 30,
  quarter: 91,
  year: 365,
};

/**
 * One thing the business has decided to achieve.
 *
 * Always `decided`: an intent is a human commitment, never something the
 * Conductor worked out. Without a target value it is still a valid intent —
 * it simply cannot be decomposed, and says so.
 */
export interface BusinessIntent {
  id: ID;
  organizationId: ID;
  kind: BusinessGoalKind;
  /** Plain language, as the person said it. */
  label: string;
  /** The number a person committed to, when they committed to one. */
  target?: number;
  /** e.g. "GBP", "opportunities", "%". Free text on purpose. */
  unit?: string;
  horizon: GoalHorizon;
  /** Why this is the goal. Carried into every plan derived from it. */
  because: string;
  /** Tai can mark a goal as one the business lives or dies by. */
  critical: boolean;
  decidedBy: { id: ID; label: string };
  decidedAt: ISODateTime;
  /** Always "decided". Present so readers never have to assume. */
  basis: "decided";
}

/** What is written when a person sets or changes an intent. */
export interface BusinessIntentDraft {
  kind: BusinessGoalKind;
  label: string;
  target?: number;
  unit?: string;
  horizon: GoalHorizon;
  because: string;
  critical?: boolean;
}

export function intentSubjectKey(kind: BusinessGoalKind, horizon: GoalHorizon): string {
  return `intent:${kind}:${horizon}`;
}

/* ------------------------------------------------------------- vital signs */

/** The six questions the business is actually asking itself. */
export type VitalQuestion =
  | "survive"
  | "creating_demand"
  | "converting_demand"
  | "can_deliver"
  | "clients_healthy"
  | "compounding";

export const VITAL_QUESTION_LABEL: Record<VitalQuestion, string> = {
  survive: "Will we survive?",
  creating_demand: "Are we creating demand?",
  converting_demand: "Are we converting demand?",
  can_deliver: "Can we deliver what we sell?",
  clients_healthy: "Are clients healthy?",
  compounding: "Are we compounding?",
};

export const VITAL_QUESTION_ORDER: VitalQuestion[] = [
  "survive",
  "creating_demand",
  "converting_demand",
  "can_deliver",
  "clients_healthy",
  "compounding",
];

/** Leading indicators move first. Lagging ones confirm what already happened. */
export type IndicatorKind = "leading" | "lagging";

export interface VitalSignDefinition {
  key: string;
  question: VitalQuestion;
  label: string;
  indicator: IndicatorKind;
  unit: string;
  /** One sentence a person can act on. */
  whyItMatters: string;
  /** The room that would have to hold this number. */
  ownerApp?: string;
  /** What would have to exist for this to stop being unknown. */
  instrumentation: string;
}

/**
 * The registry. Every vital sign the Conductor knows how to ask about,
 * including the ones nothing in the suite can answer yet — a metric the
 * business cannot see is exactly the thing worth naming.
 */
export const VITAL_SIGNS: VitalSignDefinition[] = [
  {
    key: "cash_runway",
    question: "survive",
    label: "Cash runway",
    indicator: "lagging",
    unit: "months",
    whyItMatters: "Runway decides how long every other decision has to work.",
    instrumentation: "Connect a finance source, or record runway as a decided figure.",
  },
  {
    key: "recurring_revenue",
    question: "survive",
    label: "Recurring revenue",
    indicator: "lagging",
    unit: "currency / month",
    whyItMatters: "The floor the business stands on before any new work lands.",
    instrumentation: "Connect billing, or record monthly recurring revenue as decided.",
  },
  {
    key: "receivables",
    question: "survive",
    label: "Money owed to us",
    indicator: "lagging",
    unit: "currency",
    whyItMatters: "Delivered work that has not been paid for is revenue at risk.",
    instrumentation: "Connect invoicing to the suite.",
  },
  {
    key: "qualified_prospects",
    question: "creating_demand",
    label: "Qualified prospects",
    indicator: "leading",
    unit: "companies",
    whyItMatters: "Nothing converts that was never sourced.",
    ownerApp: "scout",
    instrumentation: "Scout already holds this once companies are qualified.",
  },
  {
    key: "sourcing_cadence",
    question: "creating_demand",
    label: "New companies found",
    indicator: "leading",
    unit: "companies / 14 days",
    whyItMatters: "Sourcing stops long before pipeline looks empty.",
    ownerApp: "scout",
    instrumentation: "Scout records a discovery event for every company found.",
  },
  {
    key: "live_conversations",
    question: "converting_demand",
    label: "Live conversations",
    indicator: "leading",
    unit: "relationships",
    whyItMatters: "Conversations are the only place demand becomes an opportunity.",
    ownerApp: "comms",
    instrumentation: "Comms already holds this for every tracked relationship.",
  },
  {
    key: "open_opportunities",
    question: "converting_demand",
    label: "Open opportunities",
    indicator: "leading",
    unit: "roadmaps",
    whyItMatters: "A roadmap is the first artefact a real opportunity produces.",
    ownerApp: "roadmap",
    instrumentation: "Roadmap already holds this.",
  },
  {
    key: "close_rate",
    question: "converting_demand",
    label: "Close rate",
    indicator: "lagging",
    unit: "%",
    whyItMatters: "Every pipeline target is arithmetic on top of this number.",
    ownerApp: "roadmap",
    instrumentation: "Record won and lost outcomes against roadmaps so the rate can be counted.",
  },
  {
    key: "average_deal_size",
    question: "converting_demand",
    label: "Average deal size",
    indicator: "lagging",
    unit: "currency",
    whyItMatters: "Without it, a revenue goal cannot become a pipeline goal.",
    instrumentation: "Record deal values on won work, or decide a planning figure.",
  },
  {
    key: "sales_cycle",
    question: "converting_demand",
    label: "Sales cycle",
    indicator: "lagging",
    unit: "days",
    whyItMatters: "It says whether this quarter's target can still be met at all.",
    instrumentation: "Record first-contact and won dates so the interval can be counted.",
  },
  {
    key: "open_delivery",
    question: "can_deliver",
    label: "Work in delivery",
    indicator: "lagging",
    unit: "projects",
    whyItMatters: "Capacity is the guardrail on every demand target.",
    ownerApp: "projects",
    instrumentation: "Projects already holds this.",
  },
  {
    key: "blocked_delivery",
    question: "can_deliver",
    label: "Blocked work",
    indicator: "leading",
    unit: "projects",
    whyItMatters: "Blocked work is delivery risk before it is a client problem.",
    ownerApp: "projects",
    instrumentation: "Projects already holds this.",
  },
  {
    key: "overdue_commitments",
    question: "clients_healthy",
    label: "Overdue promises",
    indicator: "leading",
    unit: "commitments",
    whyItMatters: "Broken promises erode a relationship long before it churns.",
    ownerApp: "steward",
    instrumentation: "Steward already holds confirmed promises and their due dates.",
  },
  {
    key: "unanswered_relationships",
    question: "clients_healthy",
    label: "People waiting on us",
    indicator: "leading",
    unit: "relationships",
    whyItMatters: "Response time is the cheapest trust the business ever buys.",
    ownerApp: "comms",
    instrumentation: "Comms already holds this.",
  },
  {
    key: "retention",
    question: "clients_healthy",
    label: "Retention",
    indicator: "lagging",
    unit: "%",
    whyItMatters: "Keeping a client is worth several found ones.",
    instrumentation: "Record client start and end dates so retention can be counted.",
  },
  {
    key: "referrals",
    question: "compounding",
    label: "Referrals and expansion",
    indicator: "lagging",
    unit: "count",
    whyItMatters: "Compounding is the difference between a business and a treadmill.",
    instrumentation: "Record the source of every new prospect, including referrals.",
  },
  {
    key: "content_output",
    question: "compounding",
    label: "Published work",
    indicator: "leading",
    unit: "assets",
    whyItMatters: "Authority is what makes sourcing cheaper next quarter.",
    ownerApp: "studio",
    instrumentation: "Studio records a publish event for every asset that goes live.",
  },
  {
    key: "system_reliability",
    question: "compounding",
    label: "System reliability",
    indicator: "leading",
    unit: "incidents / 14 days",
    whyItMatters: "Unreliable systems tax every other room quietly.",
    ownerApp: "ops",
    instrumentation: "Ops already writes incident events into the shared stream.",
  },
];

export function vitalSign(key: string): VitalSignDefinition | undefined {
  return VITAL_SIGNS.find((sign) => sign.key === key);
}

/** How an area of the business reads. There is no score, and no total. */
export type VitalStanding = "healthy" | "watch" | "at_risk" | "unknown";

export const VITAL_STANDING_LABEL: Record<VitalStanding, string> = {
  healthy: "Healthy",
  watch: "Watch",
  at_risk: "At risk",
  unknown: "Unknown",
};

export interface VitalReading {
  key: string;
  definition: VitalSignDefinition;
  standing: VitalStanding;
  basis: ValueBasis;
  /** Absent whenever the basis is `unknown`. Never zero-as-a-guess. */
  value?: number;
  /** Plain language, no interpretation beyond the standing. */
  statement: string;
  /** Why it reads this way. */
  because: string;
  evidence: EvidenceRef[];
  /** A human-decided target, when one exists for this sign. */
  target?: number;
  /** Tai marked the underlying goal critical. */
  critical: boolean;
}

export interface VitalArea {
  question: VitalQuestion;
  label: string;
  standing: VitalStanding;
  readings: VitalReading[];
}

/** The whole structured read. Deliberately not a single number. */
export interface BusinessVitals {
  organizationId: ID;
  areas: VitalArea[];
  /** The worst standing across areas Tai marked critical, else across all. */
  standing: VitalStanding;
  /** Signs with no instrument behind them. */
  unknownKeys: string[];
  generatedAt: ISODateTime;
}

/* ------------------------------------------------------------ factory graph */

/**
 * The business as a factory, typed so intelligence can reason upstream and
 * downstream rather than pattern-matching on room names.
 */
export type FactoryNodeRole =
  /** On the main path from market to revenue. */
  | "stage"
  /** Makes the main path cheaper or safer, but is not on it. */
  | "enabling";

export interface FactoryNode {
  id: string;
  label: string;
  role: FactoryNodeRole;
  /** The room that owns this stage's truth. */
  ownerApp: string;
  /** Node ids immediately upstream. */
  upstream: string[];
  /** Roughly how long an effect here takes to show downstream. */
  lagDays: number;
  /** The activity events that count as throughput at this node. */
  eventNames: string[];
  /** What it means when this node goes quiet. */
  meaning: string;
}

export const FACTORY_GRAPH: FactoryNode[] = [
  {
    id: "demand",
    label: "Demand",
    role: "stage",
    ownerApp: "scout",
    upstream: [],
    lagDays: 30,
    eventNames: ["prospect.discovered", "contact.discovered"],
    meaning: "Companies and people entering the world of the business.",
  },
  {
    id: "qualified",
    label: "Qualified prospects",
    role: "stage",
    ownerApp: "scout",
    upstream: ["demand"],
    lagDays: 21,
    eventNames: ["prospect.qualified", "prospect.handed_over"],
    meaning: "Companies a person judged worth pursuing.",
  },
  {
    id: "relationships",
    label: "Relationships",
    role: "stage",
    ownerApp: "comms",
    upstream: ["qualified"],
    lagDays: 21,
    eventNames: ["relationship.created", "relationship.message_received"],
    meaning: "People actually in conversation with the business.",
  },
  {
    id: "meetings",
    label: "Meetings",
    role: "stage",
    ownerApp: "steward",
    upstream: ["relationships"],
    lagDays: 30,
    eventNames: ["conversation.created", "relationship.stage_changed"],
    meaning: "Conversations that got as far as a room and a recording.",
  },
  {
    id: "opportunities",
    label: "Opportunities",
    role: "stage",
    ownerApp: "roadmap",
    upstream: ["meetings"],
    lagDays: 30,
    eventNames: ["roadmap.created", "roadmap.decision_requested"],
    meaning: "Named destinations someone is willing to be walked to.",
  },
  {
    id: "deals",
    label: "Decided work",
    role: "stage",
    ownerApp: "roadmap",
    upstream: ["opportunities"],
    lagDays: 21,
    eventNames: ["roadmap.milestone_approved", "roadmap.decision_resolved"],
    meaning: "Work a client has actually approved.",
  },
  {
    id: "delivery",
    label: "Delivery",
    role: "stage",
    ownerApp: "projects",
    upstream: ["deals"],
    lagDays: 14,
    eventNames: ["project.started", "project.completed"],
    meaning: "Approved work moving through execution.",
  },
  {
    id: "outcomes",
    label: "Outcomes and retention",
    role: "stage",
    ownerApp: "projects",
    upstream: ["delivery"],
    lagDays: 30,
    eventNames: ["project.completed"],
    meaning: "Delivered results, the only thing that earns the next engagement.",
  },
  {
    id: "authority",
    label: "Authority",
    role: "enabling",
    ownerApp: "studio",
    upstream: [],
    lagDays: 45,
    eventNames: ["content.published", "studio.work_completed"],
    meaning: "Published work that makes sourcing and converting cheaper.",
  },
  {
    id: "reliability",
    label: "Reliability",
    role: "enabling",
    ownerApp: "ops",
    upstream: [],
    lagDays: 14,
    eventNames: ["ops.work_completed", "ops.work_accepted"],
    meaning: "The technical floor everything else stands on.",
  },
];

export function factoryNode(id: string): FactoryNode | undefined {
  return FACTORY_GRAPH.find((node) => node.id === id);
}

/** Every node downstream of one, transitively. Used for causal warnings. */
export function downstreamOf(id: string): FactoryNode[] {
  const out: FactoryNode[] = [];
  const queue = [id];
  const seen = new Set<string>([id]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const node of FACTORY_GRAPH) {
      if (!node.upstream.includes(current) || seen.has(node.id)) continue;
      seen.add(node.id);
      out.push(node);
      queue.push(node.id);
    }
  }
  return out;
}

export type FlowDirection = "up" | "down" | "flat" | "unknown";

/** What one node of the factory did lately, against the window before it. */
export interface FactoryFlowRead {
  node: FactoryNode;
  basis: ValueBasis;
  /** Events in the recent window. Absent when the basis is unknown. */
  recent?: number;
  prior?: number;
  direction: FlowDirection;
  statement: string;
  evidence: EvidenceRef[];
}

/**
 * An upstream fall whose effect has not reached the lagging metric yet. This
 * is the whole point of the graph: saying it before revenue moves.
 */
export interface FactoryWarning {
  nodeId: string;
  /** Nodes that will feel it, soonest first. */
  downstreamIds: string[];
  /** When the effect would land, given the node's lag. */
  expectedByDays: number;
  statement: string;
  because: string;
  evidence: EvidenceRef[];
}

export interface FactoryRead {
  organizationId: ID;
  flows: FactoryFlowRead[];
  warnings: FactoryWarning[];
  /** Windows compared, in days, so the reader can check the arithmetic. */
  windowDays: number;
  generatedAt: ISODateTime;
}

/* ------------------------------------------------------------- blind spots */

export type BlindSpotSeverity = "critical" | "important" | "worth_knowing";

export const BLIND_SPOT_SEVERITY_LABEL: Record<BlindSpotSeverity, string> = {
  critical: "Critical gap",
  important: "Important gap",
  worth_knowing: "Worth knowing",
};

/**
 * Something the business cannot currently see. Never a guess about what the
 * answer would be — only the question, why it matters, and how to instrument it.
 */
export interface BlindSpot {
  key: string;
  /** The business question that cannot be answered today. */
  question: string;
  whyItMatters: string;
  howToInstrument: string;
  severity: BlindSpotSeverity;
  /** The vital sign this gap is about, when it maps to one. */
  vitalKey?: string;
  /** The room that would own the instrument. */
  ownerApp?: string;
  evidence: EvidenceRef[];
}

/* ------------------------------------------------------- operating planning */

export interface PlanAssumption {
  key: string;
  statement: string;
  basis: ValueBasis;
  /** Where the value came from, named precisely. */
  because: string;
  value?: number;
  unit?: string;
  evidence: EvidenceRef[];
}

/** A number the Conductor worked out, with the assumptions it rests on. */
export interface DerivedTarget {
  key: string;
  label: string;
  value: number;
  unit: string;
  basis: "derived" | "decided";
  /** The arithmetic, written out so a person can disagree with it. */
  workedOut: string;
  assumptionKeys: string[];
}

export interface RoomContribution {
  appId: string;
  label: string;
  /** What this room is being asked to contribute, in one sentence. */
  contribution: string;
  targets: DerivedTarget[];
  dependencies: string[];
  /** Whether the ask is a production target or a guardrail not to breach. */
  role: "produce" | "guardrail" | "support";
  route: string;
}

export interface PlanCheckpoint {
  atDays: number;
  label: string;
  /** The observable thing checked at this point. */
  expect: string;
  vitalKey?: string;
}

export interface PlanRisk {
  statement: string;
  because: string;
  severity: "high" | "moderate" | "low";
}

/**
 * An operating cycle derived from one decided outcome.
 *
 * Intelligence until a person approves specific actions. Producing a plan
 * creates nothing downstream: no project, no prospect, no task.
 */
export interface OperatingPlan {
  id: ID;
  organizationId: ID;
  /** The decided intent this descends from. */
  intent: BusinessIntent;
  outcome: string;
  horizon: GoalHorizon;
  /** True when every input needed was available. */
  complete: boolean;
  /** When incomplete, exactly what is missing, in plain language. */
  blockedBecause?: string;
  assumptions: PlanAssumption[];
  targets: DerivedTarget[];
  rooms: RoomContribution[];
  leadingIndicators: string[];
  checkpoints: PlanCheckpoint[];
  risks: PlanRisk[];
  unknowns: BlindSpot[];
  evidence: EvidenceRef[];
  /** Bounded, approval-gated actions. Never executed by the Conductor. */
  proposedActions: ActionProposal[];
  generatedAt: ISODateTime;
}

/* ------------------------------------------------- system improvement loop */

/** Something that keeps costing the business the same way. */
export interface FrictionPattern {
  key: string;
  statement: string;
  /** Distinct occurrences counted in the shared record. */
  occurrences: number;
  sourceApps: string[];
  firstSeen: ISODateTime;
  lastSeen: ISODateTime;
  evidence: EvidenceRef[];
}

export type ImprovementRisk = "low" | "medium" | "high";

/**
 * A proposed change to how the business works — a process, an automation, a
 * capability. Always a proposal: the Conductor does not modify itself, the
 * suite, or any room.
 */
export interface SystemImprovement {
  id: ID;
  frictionKey: string;
  headline: string;
  /** What is actually going wrong, from the pattern. */
  diagnosis: string;
  /** The bounded change proposed. */
  fix: string;
  risk: ImprovementRisk;
  reversible: boolean;
  /** Always true in this pass. There is no auto-execution path. */
  requiresApproval: true;
  owningApp: string;
  route: string;
  /** What should become observably true if it worked. */
  expectedSignal: string;
  occurrences: number;
  evidence: EvidenceRef[];
}

/** Friction must repeat this often before a system change is proposed. */
export const FRICTION_THRESHOLD = 3;

/* ----------------------------------------------------- conversation surface */

/** What the person is actually asking for. Small, deliberately. */
export type ConductorTopic =
  | "business_read"
  | "attention"
  | "leaks"
  | "gaps"
  | "growth"
  | "plan"
  | "improve"
  | "unclear";

export const CONDUCTOR_TOPIC_LABEL: Record<ConductorTopic, string> = {
  business_read: "Business read",
  attention: "What deserves you",
  leaks: "Where we are leaking",
  gaps: "What we are missing",
  growth: "More business",
  plan: "Operating plan",
  improve: "System improvement",
  unclear: "Read of the business",
};

/** What the Conductor is doing, and refusing to do, for this answer. */
export interface ControlStatement {
  willDo: string[];
  willNotDo: string[];
}

/** A room that could not be read, and why. Carried into every answer. */
export interface WithheldRoom {
  appId: string;
  reason: string;
}

/**
 * The response contract. Every field is either populated from evidence or
 * honestly empty; nothing here is padded to look complete.
 */
export interface ConductorAnswer {
  id: ID;
  organizationId: ID;
  question: string;
  topic: ConductorTopic;
  /** The direct answer, first, in plain language. */
  answer: string;
  vitals: BusinessVitals;
  factory: FactoryRead;
  evidence: EvidenceRef[];
  assumptions: PlanAssumption[];
  unknowns: BlindSpot[];
  /** One next move, when there is an honest one. */
  nextMove?: {
    statement: string;
    appId: string;
    route: string;
    routeLabel: string;
  };
  plan?: OperatingPlan;
  improvements: SystemImprovement[];
  /** Bounded actions, each owned by a room and each requiring approval. */
  proposedActions: ActionProposal[];
  control: ControlStatement;
  withheld: WithheldRoom[];
  /** The metric to watch to find out whether the answer was any good. */
  watch?: { statement: string; vitalKey?: string };
  /** False when no room could be read at all. */
  grounded: boolean;
  generatedAt: ISODateTime;
}

/** One recorded exchange. History, not a second truth store. */
export interface ConductorTurn {
  id: ID;
  organizationId: ID;
  question: string;
  answer: string;
  topic: ConductorTopic;
  askedBy: { id: ID; label: string };
  at: ISODateTime;
}

/** The control boundary, stated the same way in every answer. */
export const CONDUCTOR_CONTROL: ControlStatement = {
  willDo: [
    "Read every room you are authorised to see, with provenance.",
    "Say what is observed, what you decided, what was derived, and what is unknown.",
    "Decompose a decided outcome into room-by-room targets.",
    "Propose bounded actions and route each to the room that owns it.",
  ],
  willNotDo: [
    "Write Scout, Comms, Roadmap, Projects, Ops or Studio truth directly.",
    "Execute consequential work without your approval.",
    "Invent a metric, a target or a financial figure.",
    "Send external messages, publish content, change pricing or spend money.",
  ],
};
