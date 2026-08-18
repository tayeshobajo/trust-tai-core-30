/**
 * Goal decomposition: one decided outcome, turned into an operating cycle.
 *
 * The rule that makes this trustworthy: a derived number may only rest on
 * observed or decided inputs. The moment a required input is unknown, the plan
 * stops, says which input is missing, and returns the blind spot instead of a
 * plausible figure. A refused plan is a correct plan.
 *
 * Producing a plan creates nothing downstream. Every action inside it is a
 * proposal owned by a room and gated on a person's approval.
 */

import type { EvidenceRef } from "@/domain/confidence";
import type { ActionProposal } from "@/domain/intelligence-engine";
import {
  GOAL_HORIZON_DAYS,
  GOAL_HORIZON_LABEL,
  vitalSign,
  type BlindSpot,
  type BusinessIntent,
  type BusinessVitals,
  type DerivedTarget,
  type FactoryRead,
  type OperatingPlan,
  type PlanAssumption,
  type PlanCheckpoint,
  type PlanRisk,
  type RoomContribution,
} from "@/domain/conductor";

import { vitalReading } from "./vitals";

function human(label: string): EvidenceRef {
  return { label, kind: "human" };
}

function computed(label: string): EvidenceRef {
  return { label, kind: "computed" };
}

function round(value: number): number {
  return Math.max(1, Math.ceil(value));
}

/** An input the arithmetic needs, resolved from decided or observed values. */
function decidedInput(
  intents: BusinessIntent[],
  kind: BusinessIntent["kind"],
): BusinessIntent | undefined {
  return intents.find((intent) => intent.kind === kind && intent.target !== undefined);
}

export interface PlanInput {
  intent: BusinessIntent;
  intents: BusinessIntent[];
  vitals: BusinessVitals;
  factory: FactoryRead;
  blindSpots: BlindSpot[];
  now: string;
}

/**
 * Decompose one intent into a room-by-room operating cycle.
 *
 * Supported today: revenue and qualified-pipeline outcomes, which are the two
 * that actually decompose arithmetically. Any other kind returns a plan that
 * says plainly it cannot be decomposed yet, rather than inventing a chain.
 */
export function buildOperatingPlan(input: PlanInput): OperatingPlan {
  const { intent, intents, vitals, blindSpots, now } = input;
  const assumptions: PlanAssumption[] = [];
  const targets: DerivedTarget[] = [];
  const rooms: RoomContribution[] = [];
  const risks: PlanRisk[] = [];
  const unknowns: BlindSpot[] = [];
  const evidence: EvidenceRef[] = [human("Business intent you decided")];

  const base = {
    id: `plan:${intent.kind}:${intent.horizon}`,
    organizationId: intent.organizationId,
    intent,
    outcome: intent.label,
    horizon: intent.horizon,
    leadingIndicators: [] as string[],
    checkpoints: [] as PlanCheckpoint[],
    proposedActions: [] as ActionProposal[],
    generatedAt: now,
  };

  if (intent.target === undefined) {
    return {
      ...base,
      complete: false,
      blockedBecause:
        "This goal has no number behind it. Decide a target and a horizon, and it can be decomposed.",
      assumptions,
      targets,
      rooms,
      risks,
      unknowns: blindSpots.filter((spot) => spot.key.startsWith("intent_unmeasurable")),
      evidence,
    };
  }

  if (intent.kind !== "revenue" && intent.kind !== "qualified_pipeline") {
    return {
      ...base,
      complete: false,
      blockedBecause: `A ${intent.kind.replace(/_/g, " ")} goal does not decompose into room targets by arithmetic. It is tracked as a decided outcome, and the vital signs under it are read directly.`,
      assumptions,
      targets,
      rooms,
      risks,
      unknowns,
      evidence,
    };
  }

  /* ------------------------------------------- the required inputs */

  assumptions.push({
    key: "outcome",
    statement: `${intent.label}: ${intent.target}${intent.unit ? ` ${intent.unit}` : ""} ${GOAL_HORIZON_LABEL[intent.horizon]}.`,
    basis: "decided",
    because: `Decided by ${intent.decidedBy.label}. ${intent.because}`.trim(),
    value: intent.target,
    ...(intent.unit ? { unit: intent.unit } : {}),
    evidence: [human("Business intent you decided")],
  });

  /* Deal size and close rate are the only two inputs the chain cannot fake. */
  const dealSizeIntent = decidedInput(intents, "custom");
  const dealSizeReading = vitalReading(vitals, "average_deal_size");
  const closeReading = vitalReading(vitals, "close_rate");

  const dealSize =
    dealSizeReading && dealSizeReading.basis !== "unknown" && dealSizeReading.value
      ? {
          value: dealSizeReading.value,
          basis: dealSizeReading.basis as "observed" | "decided",
          because: dealSizeReading.because,
        }
      : dealSizeIntent?.target
        ? {
            value: dealSizeIntent.target,
            basis: "decided" as const,
            because: `Planning figure decided by ${dealSizeIntent.decidedBy.label}.`,
          }
        : null;

  const closeRate =
    closeReading && closeReading.basis !== "unknown" && closeReading.value
      ? {
          value: closeReading.value,
          basis: closeReading.basis as "observed" | "decided",
          because: closeReading.because,
        }
      : null;

  const missing: string[] = [];
  if (intent.kind === "revenue" && !dealSize) missing.push("average deal size");
  if (!closeRate) missing.push("close rate");

  if (missing.length > 0) {
    for (const key of ["average_deal_size", "close_rate"]) {
      const definition = vitalSign(key);
      const reading = vitalReading(vitals, key);
      if (!definition || (reading && reading.basis !== "unknown")) continue;
      if (intent.kind === "qualified_pipeline" && key === "average_deal_size") continue;
      unknowns.push({
        key: `plan_input:${key}`,
        question: `What is our ${definition.label.toLowerCase()}?`,
        whyItMatters: `Every number below "${intent.label}" is arithmetic on top of this. Without it, any target would be invented.`,
        howToInstrument: definition.instrumentation,
        severity: "critical",
        vitalKey: key,
        evidence: [computed("No source in the suite answers this")],
      });
      assumptions.push({
        key,
        statement: `${definition.label} is not known.`,
        basis: "unknown",
        because: definition.instrumentation,
        evidence: [],
      });
    }

    return {
      ...base,
      complete: false,
      blockedBecause: `This outcome cannot be decomposed yet: ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} unknown. Decide a planning figure or instrument the metric, and the whole cycle follows from it.`,
      assumptions,
      targets,
      rooms,
      risks,
      unknowns,
      evidence,
    };
  }

  /* ---------------------------------------------------- arithmetic */

  const dealsNeeded =
    intent.kind === "revenue" ? round(intent.target / dealSize!.value) : round(intent.target);

  if (intent.kind === "revenue") {
    assumptions.push({
      key: "average_deal_size",
      statement: `Average deal size is ${dealSize!.value}.`,
      basis: dealSize!.basis,
      because: dealSize!.because,
      value: dealSize!.value,
      evidence: [
        dealSize!.basis === "decided"
          ? human("Planning figure you recorded")
          : computed("Counted from won work"),
      ],
    });
    targets.push({
      key: "deals",
      label: "Deals to win",
      value: dealsNeeded,
      unit: "deals",
      basis: "inferred",
      workedOut: `${intent.target} ÷ ${dealSize!.value} average deal size = ${dealsNeeded}.`,
      assumptionKeys: ["outcome", "average_deal_size"],
    });
  } else {
    targets.push({
      key: "deals",
      label: "Qualified opportunities to create",
      value: dealsNeeded,
      unit: "opportunities",
      basis: "decided",
      workedOut: `Taken straight from the decided target of ${intent.target}.`,
      assumptionKeys: ["outcome"],
    });
  }

  assumptions.push({
    key: "close_rate",
    statement: `Close rate is ${closeRate!.value}%.`,
    basis: closeRate!.basis,
    because: closeRate!.because,
    value: closeRate!.value,
    evidence: [
      closeRate!.basis === "decided"
        ? human("Close rate you recorded")
        : computed("Counted from recorded outcomes"),
    ],
  });

  const opportunities = round(dealsNeeded / (closeRate!.value / 100));
  targets.push({
    key: "opportunities",
    label: "Opportunities to open",
    value: opportunities,
    unit: "roadmaps",
    basis: "inferred",
    workedOut: `${dealsNeeded} ÷ ${closeRate!.value}% close rate = ${opportunities}.`,
    assumptionKeys: ["outcome", "close_rate"],
  });

  /*
   * Stage-to-stage rates between conversations, qualified companies and
   * opportunities are not instrumented anywhere in the suite. Rather than
   * assume a funnel shape, the plan states the ratio it is using, marks it as
   * an assumption a person can overrule, and carries it into every number
   * derived from it.
   */
  const CONVERSATIONS_PER_OPPORTUNITY = 3;
  const QUALIFIED_PER_CONVERSATION = 2;

  assumptions.push({
    key: "funnel_shape",
    statement: `${CONVERSATIONS_PER_OPPORTUNITY} live conversations per opportunity, and ${QUALIFIED_PER_CONVERSATION} qualified companies per conversation.`,
    basis: "unknown",
    because:
      "Nothing in the suite counts these two rates yet. They are stated as a working shape so the plan is checkable, and every number below them inherits that uncertainty.",
    evidence: [],
  });

  const conversations = round(opportunities * CONVERSATIONS_PER_OPPORTUNITY);
  const qualified = round(conversations * QUALIFIED_PER_CONVERSATION);

  targets.push(
    {
      key: "conversations",
      label: "Live conversations to sustain",
      value: conversations,
      unit: "relationships",
      basis: "inferred",
      workedOut: `${opportunities} opportunities × ${CONVERSATIONS_PER_OPPORTUNITY} conversations each = ${conversations}.`,
      assumptionKeys: ["opportunities", "funnel_shape"],
    },
    {
      key: "qualified",
      label: "Companies to qualify",
      value: qualified,
      unit: "companies",
      basis: "inferred",
      workedOut: `${conversations} conversations × ${QUALIFIED_PER_CONVERSATION} qualified companies each = ${qualified}.`,
      assumptionKeys: ["conversations", "funnel_shape"],
    },
  );

  unknowns.push({
    key: "funnel_rates",
    question: "How many conversations does one opportunity actually take?",
    whyItMatters:
      "The Scout and Comms targets in this plan rest on a stated shape, not a measured one. Measuring it is the single cheapest way to make every future plan real.",
    howToInstrument:
      "Record the stage each relationship reaches, so conversation-to-opportunity and qualified-to-conversation rates can be counted.",
    severity: "important",
    ownerApp: "comms",
    evidence: [],
  });

  /* ------------------------------------------------ room contributions */

  const days = GOAL_HORIZON_DAYS[intent.horizon];
  const weeks = Math.max(1, Math.round(days / 7));

  rooms.push(
    {
      appId: "scout",
      label: "Scout",
      role: "produce",
      contribution: `Qualify ${qualified} companies over ${weeks} weeks, about ${round(qualified / weeks)} a week.`,
      targets: [targets.find((t) => t.key === "qualified")!],
      dependencies: ["An ICP current enough that qualification means something."],
      route: "/modules/scout",
    },
    {
      appId: "comms",
      label: "Comms",
      role: "produce",
      contribution: `Hold ${conversations} live conversations and keep replies inside their promised dates.`,
      targets: [targets.find((t) => t.key === "conversations")!],
      dependencies: ["Qualified companies handed over from Scout with context intact."],
      route: "/modules/comms",
    },
    {
      appId: "roadmap",
      label: "Roadmap",
      role: "produce",
      contribution: `Open ${opportunities} roadmaps, each with an agreed Point B.`,
      targets: [targets.find((t) => t.key === "opportunities")!],
      dependencies: ["Conversations that reached a named destination."],
      route: "/modules/roadmap",
    },
    {
      appId: "projects",
      label: "Projects",
      role: "guardrail",
      contribution: `Deliver what is already sold before taking more. Winning ${dealsNeeded} deals is only worth it if delivery holds.`,
      targets: [],
      dependencies: ["Capacity is not instrumented; this guardrail is a judgment, not a number."],
      route: "/modules/projects",
    },
    {
      appId: "studio",
      label: "Studio",
      role: "support",
      contribution:
        "Publish work aimed at the companies Scout is targeting, so sourcing and converting get cheaper.",
      targets: [],
      dependencies: ["Scout's current ICP and target list."],
      route: "/modules/pulse",
    },
    {
      appId: "ops",
      label: "Ops",
      role: "guardrail",
      contribution: "Keep the technical floor steady; incidents tax every room above.",
      targets: [],
      dependencies: [],
      route: "/modules/ops",
    },
  );

  /* -------------------------------------------------- risks and checks */

  const blocked = vitalReading(vitals, "blocked_delivery");
  if (blocked && (blocked.value ?? 0) > 0) {
    risks.push({
      statement: "Delivery is already blocked while this plan asks for more demand.",
      because: blocked.statement,
      severity: "high",
    });
  }
  const sourcing = vitalReading(vitals, "sourcing_cadence");
  if (sourcing && sourcing.basis === "observed" && (sourcing.value ?? 0) === 0) {
    risks.push({
      statement: "Sourcing has stopped, so the first target in this plan starts from zero.",
      because: sourcing.statement,
      severity: "high",
    });
  }
  risks.push({
    statement: "The conversation and qualification targets rest on an assumed funnel shape.",
    because: "Those two rates are not measured anywhere in the suite yet.",
    severity: "moderate",
  });

  base.leadingIndicators.push(
    "New companies found per 14 days (Scout)",
    "Live conversations (Comms)",
    "Open roadmaps (Roadmap)",
  );

  base.checkpoints.push(
    {
      atDays: Math.round(days / 3),
      label: "One third in",
      expect: `About ${round(qualified / 3)} companies qualified and ${round(conversations / 3)} conversations live.`,
      vitalKey: "qualified_prospects",
    },
    {
      atDays: Math.round((days * 2) / 3),
      label: "Two thirds in",
      expect: `About ${round((opportunities * 2) / 3)} roadmaps open.`,
      vitalKey: "open_opportunities",
    },
    {
      atDays: days,
      label: "Horizon",
      expect: `${dealsNeeded} deals decided.`,
    },
  );

  evidence.push(computed("Vital signs read from Scout, Comms, Roadmap and Projects"));

  return {
    ...base,
    complete: true,
    assumptions,
    targets,
    rooms,
    risks,
    unknowns,
    evidence,
  };
}
