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
 * Where a value came from — the truth class. This is the spine of the whole
 * subsystem: every number the Conductor says out loud carries one of these,
 * and they never collapse into each other.
 */
export type ValueBasis =
  /** Counted or dated from a room's own record. */
  | "observed"
  /** A person committed to it. Outranks anything worked out. */
  | "decided"
  /** Arithmetic over observed and decided values only. */
  | "inferred"
  /** The Conductor's suggestion. Never a fact, never a commitment. */
  | "recommended"
  /** Not instrumented. Said plainly, never filled in. */
  | "unknown";

export const VALUE_BASIS_LABEL: Record<ValueBasis, string> = {
  observed: "Observed",
  decided: "Decided by you",
  inferred: "Inferred",
  recommended: "Recommended",
  unknown: "Unknown",
};

/** Truth classes that may be used as an input to arithmetic. */
export const FACTUAL_BASES: ValueBasis[] = ["observed", "decided"];


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
    key: "capacity_utilization",
    question: "can_deliver",
    label: "Capacity in use",
    indicator: "leading",
    unit: "%",
    whyItMatters: "Selling past capacity is how delivery quality quietly fails.",
    ownerApp: "projects",
    instrumentation: "Record planned hours per project and available hours per person.",
  },
  {
    key: "estimate_accuracy",
    question: "can_deliver",
    label: "Estimate accuracy",
    indicator: "lagging",
    unit: "%",
    whyItMatters: "If estimates are wrong, every plan built on them is wrong too.",
    ownerApp: "projects",
    instrumentation: "Record estimated and actual effort on completed projects.",
  },
  {
    key: "site_traffic",
    question: "compounding",
    label: "Site traffic",
    indicator: "leading",
    unit: "visits / 30 days",
    whyItMatters: "Inbound attention is the cheapest demand the business ever gets.",
    ownerApp: "ops",
    instrumentation: "Connect an analytics source for the public site.",
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
    id: "revenue",
    label: "Delivered revenue",
    role: "stage",
    ownerApp: "projects",
    upstream: ["delivery"],
    lagDays: 30,
    eventNames: ["project.completed"],
    meaning: "Delivered results, the only thing that earns the next engagement.",
  },
  {
    id: "retention",
    label: "Retention",
    role: "stage",
    ownerApp: "comms",
    upstream: ["revenue"],
    lagDays: 60,
    eventNames: ["relationship.stage_changed", "relationship.message_received"],
    meaning: "Clients who stay in conversation after the work is delivered.",
  },
  {
    id: "expansion",
    label: "Expansion and referrals",
    role: "stage",
    ownerApp: "scout",
    upstream: ["retention"],
    lagDays: 90,
    eventNames: ["prospect.discovered", "roadmap.created"],
    meaning: "New work that came from work already delivered.",
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
/** Why the answer is missing: nothing is wired up, or it is wired and silent. */
export type BlindSpotState = "not_connected" | "no_signal";

export interface BlindSpot {
  key: string;
  /** Whether an instrument is missing entirely, or exists and says nothing. */
  state?: BlindSpotState;
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
  basis: "inferred" | "decided";
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

/* -------------------------------------------------------- action graph */

/**
 * One bounded step the Conductor has prepared. It is always `recommended`:
 * nothing here has happened, and nothing here can happen without a person in
 * the owning room.
 */
export interface ConductorActionStep {
  id: string;
  /** The room whose service would carry this out. Never the Conductor. */
  owningApp: string;
  /** The room operation this step names, e.g. "comms.draft_reply". */
  operation?: string;
  /** References the owning room's service would need. Never room truth itself. */
  payload?: Record<string, unknown>;
  route: string;
  routeLabel: string;
  title: string;
  summary: string;
  willDo: string[];
  willNotDo: string[];
  /** Step ids that must be authorised first. */
  dependsOn: string[];
  /** Consequential steps always require approval; so do all others today. */
  consequential: boolean;
  requiresApproval: true;
  /** The permission a person needs in the owning room to authorise it. */
  requiredCapability: string;
  /** What should become observably true afterwards. */
  expectedSignal: string;
  basis: "recommended";
  evidence: EvidenceRef[];
}

/**
 * A typed, ordered set of steps across rooms. Preparing one changes nothing:
 * it is a proposal shaped like a plan, not an execution schedule.
 */
export interface ConductorActionGraph {
  id: ID;
  organizationId: ID;
  /** The question or intent this graph serves. */
  purpose: string;
  steps: ConductorActionStep[];
  /** True whenever any step is consequential — i.e. always gated. */
  requiresApproval: boolean;
  /** Rooms touched, so a reader can see the blast radius at a glance. */
  owningApps: string[];
  generatedAt: ISODateTime;
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
  /** The same work, ordered across rooms. Prepared only, never executed. */
  actionGraph?: ConductorActionGraph;
  control: ControlStatement;
  /** What earlier corrections changed about this answer. */
  learning: LearningState;
  /**
   * What the outcome ledger already knows about the rooms this answer touches,
   * each sentence carrying how strongly it is held. Bounded and relevant —
   * never the whole history — and never a source of authority.
   */
  priorLearning: string[];
  /** The recorded figures this answer stood on. */
  figures: BusinessFigure[];
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

/* ------------------------------------------------------------------ *
 * Recorded figures: the instrument of last resort.
 *
 * Some numbers no room in the suite will ever hold — cash in the bank,
 * monthly burn, money owed. Rather than leave the survival question
 * permanently unanswerable, a person may record the figure themselves. A
 * recorded figure is `decided` truth: it carries who said it, when it was
 * true, and it goes stale on a clock so a nine-month-old bank balance never
 * masquerades as a current one.
 * ------------------------------------------------------------------ */

/** Beyond this age a figure still counts, but the reading is only ever "watch". */
export const FIGURE_STALE_DAYS = 45;

/** Beyond this age a figure is treated as unknown again. Old money is not money. */
export const FIGURE_EXPIRY_DAYS = 120;

/** A figure a person recorded by hand, or a connected source wrote. */
export interface BusinessFigure {
  id: ID;
  organizationId: ID;
  /** A vital sign key, or one of the runway inputs below. */
  key: string;
  value: number;
  unit?: string;
  /** `decided` when a person typed it, `observed` when a source wrote it. */
  basis: Extract<ValueBasis, "decided" | "observed">;
  /** The date the figure was true, which is not the date it was typed. */
  asOf: ISODateTime;
  note?: string;
  recordedBy: { id: ID; label: string };
  recordedAt: ISODateTime;
}

export interface FigureInputDefinition {
  key: string;
  label: string;
  unit: string;
  /** What it feeds. Shown so nobody records a number for no reason. */
  feeds: string;
  placeholder?: string;
}

/**
 * The figures worth asking a person for. Deliberately short: every entry here
 * is a number the suite genuinely cannot count for itself.
 */
export const FIGURE_INPUTS: FigureInputDefinition[] = [
  {
    key: "cash_on_hand",
    label: "Cash in the bank",
    unit: "currency",
    feeds: "Runway, with monthly burn.",
    placeholder: "120000",
  },
  {
    key: "monthly_burn",
    label: "Monthly burn",
    unit: "currency / month",
    feeds: "Runway, with cash in the bank.",
    placeholder: "24000",
  },
  {
    key: "recurring_revenue",
    label: "Recurring revenue",
    unit: "currency / month",
    feeds: "Will we survive?",
  },
  {
    key: "receivables",
    label: "Money owed to us",
    unit: "currency",
    feeds: "Will we survive?",
  },
  {
    key: "average_deal_size",
    label: "Average deal size",
    unit: "currency",
    feeds: "Turning a revenue goal into a pipeline goal.",
  },
  {
    key: "close_rate",
    label: "Close rate",
    unit: "%",
    feeds: "Turning deals into opportunities to open.",
  },
  {
    key: "sales_cycle",
    label: "Sales cycle",
    unit: "days",
    feeds: "Whether this quarter's target can still be met.",
  },
];

export function figureInput(key: string): FigureInputDefinition | undefined {
  return FIGURE_INPUTS.find((row) => row.key === key);
}

/* ------------------------------------------------------------------ *
 * Corrections: the learning loop.
 *
 * When the Conductor is wrong, the correction is recorded rather than
 * argued with. A corrected figure becomes decided truth. A rejected
 * suggestion stops being raised for a while. Nothing is silently rewritten:
 * every correction is an append-only row with a name against it.
 * ------------------------------------------------------------------ */

/** How long a rejected suggestion stays quiet before it may be raised again. */
export const CORRECTION_SUPPRESSION_DAYS = 14;

export type CorrectionKind =
  /** The number was wrong. Carries the right one. */
  | "wrong_figure"
  /** The reasoning was wrong, but nothing needs suppressing. */
  | "wrong_read"
  /** Already dealt with outside the suite. */
  | "already_handled"
  /** Not worth raising. Stop suggesting it for a while. */
  | "not_useful";

export const CORRECTION_KIND_LABEL: Record<CorrectionKind, string> = {
  wrong_figure: "That number is wrong",
  wrong_read: "That read is wrong",
  already_handled: "Already handled",
  not_useful: "Not worth raising",
};

/** One recorded correction. Append-only; corrections are never edited. */
export interface ConductorCorrection {
  id: ID;
  organizationId: ID;
  kind: CorrectionKind;
  /** The answer this corrects, when it corrects one. */
  answerId?: ID;
  question?: string;
  topic?: ConductorTopic;
  /** The suggestion or pattern being corrected, e.g. an improvement key. */
  subjectKey?: string;
  /** Present on `wrong_figure`: the figure the person says is right. */
  figure?: { key: string; value: number; unit?: string; asOf: ISODateTime };
  note: string;
  correctedBy: { id: ID; label: string };
  at: ISODateTime;
}

/** What the recorded corrections change about the next answer. */
export interface LearningState {
  organizationId: ID;
  /** Suggestion keys held quiet, with the reason and until when. */
  suppressed: { key: string; because: string; until: ISODateTime }[];
  /** Figures a person supplied by correcting an answer. */
  correctedFigures: BusinessFigure[];
  /** Every correction considered, newest first. Shown as an audit trail. */
  considered: ConductorCorrection[];
}
