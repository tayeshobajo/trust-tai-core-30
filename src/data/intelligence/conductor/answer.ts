/**
 * The conversational surface's brain.
 *
 * A question comes in as language; a grounded answer goes out. Everything here
 * is deterministic and pure over the snapshot, the same question against the
 * same suite always produces the same answer, and every claim carries where it
 * came from. A model may later phrase this more warmly, but it may not add a
 * fact to it.
 *
 * The Conductor coordinates. It does not own state, and it writes nothing.
 */

import type { EvidenceRef } from "@/domain/confidence";
import type { ActionProposal } from "@/domain/intelligence-engine";
import {
  CONDUCTOR_CONTROL,
  type BlindSpot,
  type BusinessFigure,
  type BusinessIntent,
  type ConductorCorrection,
  type ConductorAnswer,
  type ConductorTopic,
  type OperatingPlan,
  type PlanAssumption,
  type SystemImprovement,
  type VitalReading,
} from "@/domain/conductor";

import type { LearningRecord } from "@/domain/outcomes";
import {
  learningForPacket,
  relevantLearning,
} from "@/data/conductor/learning";

import { engineRead } from "../engine";
import { observeBusiness } from "../engine/observe";
import { describeMatch, LABEL_THRESHOLD, matchPatterns } from "../canon";
import { actionsForRead } from "../engine/propose";
import type { SuiteSnapshot } from "../derive";
import { inboundBrief } from "@/data/website/intel";
import { findBlindSpots } from "./blindspots";
import { readFactory } from "./factory";
import { detectFriction, proposeImprovements } from "./improve";
import { buildActionGraph } from "./graph";
import {
  DISCOVERY_PROPOSAL_OPERATION,
  fillProposalPayloads,
  resolveProposalInputs,
  type IcpContext,
  type InputResolution,
} from "./payload-fill";
import type { RoadmapCanonRead } from "./roadmap-cycle";

import { figuresWithCorrections, isSuppressed, learningState } from "./learning";
import { buildOperatingPlan } from "./plan";
import { readVitals, troubledAreas, vitalReading } from "./vitals";
import { planRoadmapCycle } from "./roadmap-cycle";

/** Every reading across every area, flattened. */
function allReadings(vitals: { areas: { readings: VitalReading[] }[] }): VitalReading[] {
  return vitals.areas.flatMap((area) => area.readings);
}

/* ------------------------------------------------------------------ intent */

interface TopicRule {
  topic: ConductorTopic;
  patterns: RegExp[];
}

/**
 * Small, legible classification. Six real questions and an honest fallback 
 * no model, no hidden taxonomy, and nothing that silently mis-routes a
 * question into an answer about something else.
 */
const TOPIC_RULES: TopicRule[] = [
  /*
   * Inbound first: a question about the website or what a founder said is
   * about evidence that already exists, never about sourcing more demand.
   */
  {
    topic: "inbound",
    patterns: [
      /\b(website|trusttai\.com|inbound|intake)\b/i,
      /\bwhat did (they|the founder|he|she) (say|tell us)\b/i,
      /\bcame in\b/i,
      /\breached out\b/i,
    ],
  },
  /*
   * Roadmap first: "what decision in our roadmap deserves my attention" is a
   * Roadmap question, not a generic attention question, and must be read
   * against real Roadmap state rather than the recommendation stream.
   */
  {
    topic: "roadmap",
    patterns: [
      /\broadmaps?\b/i,
      /\bpoint (a|b)\b/i,
      /\bmilestones?\b/i,
      /\bsequence\b/i,
      /\bdestination\b/i,
    ],
  },
  {
    topic: "plan",
    patterns: [
      /\bhow (do|would|can) (we|i) (get|reach|hit)\b/i,
      /\bplan\b/i,
      /\bwhat would it take\b/i,
      /\bin order to (reach|hit|make)\b/i,
    ],
  },
  {
    topic: "growth",
    patterns: [/\bmore (business|revenue|clients|deals|work)\b/i, /\bgrow\b/i, /\bwin more\b/i],
  },
  {
    topic: "leaks",
    patterns: [/\bleak/i, /\bfalling through\b/i, /\bslipping\b/i, /\blosing\b/i, /\bwaste/i],
  },
  {
    topic: "gaps",
    patterns: [
      /\b(blind|missing|not (measur|track|see))/i,
      /\bwhat (don'?t|do not) (we|i) (know|see)\b/i,
      /\bgaps?\b/i,
    ],
  },
  {
    topic: "attention",
    patterns: [
      /\bwhat should i\b/i,
      /\bwhat needs (me|my)\b/i,
      /\bfocus\b/i,
      /\battention\b/i,
      /\btoday\b/i,
      /\bnext\b/i,
    ],
  },
  {
    topic: "improve",
    patterns: [/\bimprove\b/i, /\bfriction\b/i, /\bbetter (system|process)\b/i, /\bfix the\b/i],
  },
  {
    topic: "business_read",
    patterns: [
      /\bhow (are|is) (we|the business|things)\b/i,
      /\bstate of\b/i,
      /\bhealth\b/i,
      /\bhow'?s business\b/i,
      /\bwhere are we\b/i,
    ],
  },
];

/** What the person is actually asking. Deterministic and inspectable. */
export function classifyQuestion(question: string): ConductorTopic {
  const text = question.trim();
  if (text.length === 0) return "business_read";
  for (const rule of TOPIC_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) return rule.topic;
  }
  return "unclear";
}

/**
 * Questions that are genuinely about demand: weak pipeline, needing more
 * qualified companies, or finding new prospects. Narrow on purpose, a general
 * Scout question must not trigger a sourcing run.
 */
const DEMAND_PATTERNS: RegExp[] = [
  /\b(thin|weak|empty|dry|light)\b[^.?]{0,24}\b(pipeline|funnel)\b/i,
  /\bpipeline\b[^.?]{0,24}\b(thin|weak|empty|dry|drying|shrink)/i,
  /\bmore (qualified )?(companies|prospects|leads|pipeline)\b/i,
  /\bnew (prospects|companies|leads)\b/i,
  /\b(create|generate|build|drive) (more )?demand\b/i,
  /\bfind (more )?(companies|prospects|clients|leads)\b/i,
  /\bnot enough (companies|prospects|leads|pipeline)\b/i,
];


/* ----------------------------------------------------------------- helpers */

function computed(label: string): EvidenceRef {
  return { label, kind: "computed" };
}

function sentence(parts: string[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ answer */

export interface ConductorInput {
  snapshot: SuiteSnapshot;
  question: string;
  intents?: BusinessIntent[];
  /** Numbers a person recorded that no room can count for itself. */
  figures?: BusinessFigure[];
  /** Every correction a person has made to a previous answer. */
  corrections?: ConductorCorrection[];
  /** Pattern keys a person told the engine to stop raising. */
  suppressed?: string[];
  /** Statements a person decided. Inference never overrides these. */
  decided?: string[];
  /**
   * The outcome ledger (V3): what previous approved work actually produced.
   * Passed in whole and filtered here to the rooms this answer touches, so a
   * question about Comms never drags in every lesson the system ever formed.
   */
  priorLearning?: LearningRecord[];
  /**
   * The organisation's saved ICP, read from `icp_profiles`. When present, the
   * discovery proposal is filled from it so Scout's adapter has the brief it
   * requires. Absent, the proposal stays look-only, nothing is invented.
   */
  icp?: IcpContext | null;
}

/**
 * One grounded answer, composed from the deterministic reads.
 *
 * Contract: the answer names what it can see and what it cannot, never invents
 * a figure, and offers only bounded actions the owning room already performs.
 */
export function answerQuestion(input: ConductorInput): ConductorAnswer {
  const { snapshot, question } = input;
  const intents = input.intents ?? [];
  const topic = classifyQuestion(question);

  /*
   * Corrections are read before anything else. A number a person supplied by
   * contradicting an earlier answer is the strongest input available, and a
   * suggestion they rejected must not be raised again this fortnight.
   */
  const learning = learningState(
    snapshot.organizationId,
    input.corrections ?? [],
    snapshot.now,
  );
  const figures = figuresWithCorrections(input.figures ?? [], learning);

  const vitals = readVitals(snapshot, intents, figures);
  const factory = readFactory(snapshot);
  const blindSpots = findBlindSpots({ snapshot, vitals, factory, intents });
  const friction = detectFriction(snapshot);
  const improvements = proposeImprovements(friction).filter(
    (improvement) => !isSuppressed(learning, improvement.frictionKey),
  );

  const read = engineRead(snapshot, {
    ...(input.suppressed ? { suppressed: input.suppressed } : {}),
    ...(input.decided ? { decided: input.decided } : {}),
  });
  const actionsByRecommendation = actionsForRead(read.recommendations);
  const allActions: ActionProposal[] = Object.values(actionsByRecommendation).flat();

  const grounded = snapshot.withheld.length < 6 && allReadings(vitals).length > 0;
  const evidence: EvidenceRef[] = [computed("Vital signs read across the suite")];
  const assumptions: PlanAssumption[] = [];
  const unknowns: BlindSpot[] = [];
  let plan: OperatingPlan | undefined;
  let answer: string;
  let nextMove: ConductorAnswer["nextMove"];
  let watch: ConductorAnswer["watch"];
  let shownImprovements: SystemImprovement[] = [];
  let proposedActions: ActionProposal[] = [];
  /* Roadmap input resolutions, merged with Scout's below. */
  let roadmapResolutions: Record<string, InputResolution> = {};
  let roadmapCanon: RoadmapCanonRead | undefined;

  const troubled = troubledAreas(vitals);
  const worstFlow = factory.warnings[0];

  switch (topic) {
    case "plan":
    case "growth": {
      const intent =
        intents.find((row) => row.critical && (row.kind === "revenue" || row.kind === "qualified_pipeline")) ??
        intents.find((row) => row.kind === "revenue" || row.kind === "qualified_pipeline") ??
        intents[0];

      if (!intent) {
        answer =
          "There is no decided outcome to work back from, so any plan would be invented. Tell me what this business is trying to achieve and by when, and I will decompose it room by room.";
        unknowns.push(...blindSpots.filter((spot) => spot.key === "no_business_intent"));
        nextMove = {
          statement: "Set a business intent with a target and a horizon.",
          appId: "conductor",
          route: "/modules/pulse",
          routeLabel: "Open Pulse",
        };
        break;
      }

      plan = buildOperatingPlan({
        intent,
        intents,
        vitals,
        factory,
        blindSpots,
        now: snapshot.now,
      });
      assumptions.push(...plan.assumptions);
      unknowns.push(...plan.unknowns);

      if (!plan.complete) {
        answer = sentence([
          `I cannot honestly turn "${intent.label}" into targets yet.`,
          plan.blockedBecause ?? "",
        ]);
        const first = plan.unknowns[0];
        if (first) {
          nextMove = {
            statement: first.howToInstrument,
            appId: first.ownerApp ?? "conductor",
            route: "/modules/pulse",
            routeLabel: "Open Pulse",
          };
        }
      } else {
        const qualified = plan.targets.find((target) => target.key === "qualified");
        const conversations = plan.targets.find((target) => target.key === "conversations");
        answer = sentence([
          `To reach "${intent.label}", the chain works back to`,
          `${qualified?.value ?? 0} companies qualified and ${conversations?.value ?? 0} live conversations.`,
          "Each room's share is below, with the arithmetic and the assumptions it rests on.",
        ]);
        const scout = plan.rooms.find((room) => room.appId === "scout");
        if (scout) {
          nextMove = {
            statement: scout.contribution,
            appId: "scout",
            route: scout.route,
            routeLabel: "Open Scout",
          };
        }
        watch = { statement: "New companies found per 14 days.", vitalKey: "sourcing_cadence" };
      }
      break;
    }

    case "leaks": {
      const leaks = factory.warnings;
      const stalled = read.recommendations.filter((row) =>
        ["reply_debt", "unworked_opportunity", "promises_slipping"].includes(row.patternKey),
      );
      if (leaks.length === 0 && stalled.length === 0) {
        answer =
          "Nothing in the shared record shows work being lost between rooms right now. That is a read of what is recorded, not a guarantee.";
      } else {
        answer = sentence([
          leaks[0]?.statement ?? stalled[0]?.headline ?? "",
          leaks[0]?.because ?? stalled[0]?.rationale ?? "",
        ]);
        const first = stalled[0];
        if (first) {
          nextMove = {
            statement: first.headline,
            appId: first.destination.appId,
            route: first.destination.route,
            routeLabel: first.destination.label,
          };
          proposedActions = actionsByRecommendation[first.id] ?? [];
        }
      }
      watch = { statement: "Live conversations that owe a reply.", vitalKey: "reply_debt" };
      break;
    }

    case "gaps": {
      const critical = blindSpots.filter((spot) => spot.severity === "critical");
      unknowns.push(...blindSpots);
      answer =
        blindSpots.length === 0
          ? "Every vital sign in the registry has a source. There is nothing I know to be missing."
          : sentence([
              `${blindSpots.length} things this business cannot currently see,`,
              `${critical.length} of them critical.`,
              critical[0] ? `The largest: ${critical[0].question}` : "",
            ]);
      const first = critical[0] ?? blindSpots[0];
      if (first) {
        nextMove = {
          statement: first.howToInstrument,
          appId: first.ownerApp ?? "conductor",
          route: "/modules/pulse",
          routeLabel: "Open Pulse",
        };
      }
      break;
    }

    case "improve": {
      shownImprovements = improvements;
      answer =
        improvements.length === 0
          ? `No friction has repeated often enough to be structural. I only raise a pattern once it has happened ${3} times or more.`
          : sentence([
              `${improvements.length} recurring friction${improvements.length === 1 ? "" : "s"} worth fixing at the system level.`,
              improvements[0] ? `Most frequent: ${improvements[0].headline.toLowerCase()}.` : "",
              "Each is a proposal; none of them changes anything until you approve it in the owning room.",
            ]);
      const first = improvements[0];
      if (first) {
        nextMove = {
          statement: first.fix,
          appId: first.owningApp,
          route: first.route,
          routeLabel: `Open ${first.owningApp}`,
        };
        watch = { statement: first.expectedSignal };
      }
      break;
    }

    case "attention": {
      const top = read.recommendations[0];
      if (!top) {
        answer =
          "Nothing in the record is asking for you right now. Everything recorded is either moving or waiting on someone else.";
      } else {
        answer = sentence([top.headline, top.rationale]);
        nextMove = {
          statement: top.headline,
          appId: top.destination.appId,
          route: top.destination.route,
          routeLabel: top.destination.label,
        };
        proposedActions = actionsByRecommendation[top.id] ?? [];
        watch = { statement: top.expectedSignal };
      }
      break;
    }

    /*
     * Roadmap. Answered from real Roadmap state in Roadmap's own language:
     * Point A, the proof under it, whether Point B is inferred or decided,
     * and which decision is already waiting on a person. An existing open
     * decision is surfaced, never duplicated, and no decision is ever
     * answered here.
     */
    case "roadmap": {
      const cycle = planRoadmapCycle({ snapshot, question });
      answer = cycle.answer;
      if (cycle.nextMove) nextMove = cycle.nextMove;
      proposedActions = cycle.proposals;
      roadmapResolutions = cycle.resolutions;
      evidence.push(...cycle.evidence);
      if (cycle.canon) {
        roadmapCanon = cycle.canon;
      }
      break;
    }

    case "inbound": {
      const brief = inboundBrief({
        organizationId: snapshot.organizationId,
        now: snapshot.now,
        submissions: snapshot.websiteSubmissions,
        candidates: snapshot.candidates,
      });
      evidence.push(computed("Roadmap intake records on TrustTai.com"));

      if (brief.total === 0) {
        answer =
          "Nothing has come in through the website in the last 30 days. When an intake arrives it lands here with the founder's own words intact.";
        break;
      }

      const first = brief.companies[0];
      answer = sentence([
        `${brief.total} intake${brief.total === 1 ? "" : "s"} came in through TrustTai.com in the last 30 days.`,
        brief.held > 0
          ? `${brief.held} could not be placed with a company and ${brief.held === 1 ? "is" : "are"} waiting for you.`
          : "",
        brief.awaitingReview > 0
          ? `${brief.awaitingReview} reached Scout and ${brief.awaitingReview === 1 ? "has" : "have"} not been decided yet.`
          : "",
        first?.stated[0] ? `${first.label} said: ${first.stated[0]}` : "",
        "I can show what they said, what Scout verified, and what it reads into that. Scout owns the decision.",
      ]);

      const waiting =
        brief.companies.find((company) => company.linkState !== "linked") ??
        brief.companies.find((company) => company.prospectId && company.suggested.length > 0);
      if (waiting) {
        nextMove =
          waiting.linkState !== "linked"
            ? {
                statement: `Open the ${waiting.label} submission and place it with the right company, or leave it as a signal.`,
                appId: "website",
                route: waiting.submissionRoute,
                routeLabel: "Open the submission",
              }
            : {
                statement: `Read what ${waiting.label} said and make the call in Scout.`,
                appId: "scout",
                route: waiting.prospectRoute ?? "/modules/scout",
                routeLabel: "Open in Scout",
              };
      }
      break;
    }

    case "business_read":
    case "unclear":
    default: {
      const atRisk = allReadings(vitals).filter((reading) => reading.standing === "at_risk");
      const headline =
        atRisk.length === 0
          ? "Nothing I can read is at risk."
          : `${atRisk.length} vital sign${atRisk.length === 1 ? " is" : "s are"} at risk: ${atRisk
              .slice(0, 3)
              .map((reading) => reading.definition.label.toLowerCase())
              .join(", ")}.`;
      answer = sentence([
        headline,
        worstFlow ? worstFlow.statement : "",
        vitals.unknownKeys.length > 0
          ? `${vitals.unknownKeys.length} vital signs have no source, so this read is partial.`
          : "",
        topic === "unclear"
          ? "I read your question as a general check on the business, ask about leaks, gaps, attention or a plan for a sharper answer."
          : "",
      ]);
      unknowns.push(...blindSpots.filter((spot) => spot.severity === "critical").slice(0, 3));
      const first = troubled[0];
      const worstReading = atRisk[0] ?? (first ? vitalReading(vitals, first.readings[0]?.key ?? "") : undefined);
      const rec = read.recommendations[0];
      if (rec) {
        nextMove = {
          statement: rec.headline,
          appId: rec.destination.appId,
          route: rec.destination.route,
          routeLabel: rec.destination.label,
        };
        proposedActions = actionsByRecommendation[rec.id] ?? [];
      }
      if (worstReading) {
        watch = { statement: worstReading.statement, vitalKey: worstReading.key };
      }
      break;
    }
  }

  if (!grounded) {
    answer =
      "I cannot see enough of the suite to answer honestly. Rooms you are not authorised to read are listed below, and nothing has been inferred in their place.";
  }

  /*
   * Question-originated operation selection (V3.1).
   *
   * A question about weak pipeline, new prospects or creating demand should be
   * able to reach Scout's real sourcing operation, not only a look-only step.
   * Conservative by construction: the discovery proposal is only added when
   * the read already produced it, that is, when the evidence says the
   * pipeline is genuinely thin. No question invents the recommendation.
   */
  const demandQuestion = DEMAND_PATTERNS.some((pattern) => pattern.test(question));
  const discoveryAction = allActions.find(
    (action) => action.operation === DISCOVERY_PROPOSAL_OPERATION,
  );
  const selected =
    demandQuestion && discoveryAction
      ? [discoveryAction, ...proposedActions.filter((action) => action.id !== discoveryAction.id)]
      : proposedActions.length > 0
        ? proposedActions
        : allActions.slice(0, 2);

  /*
   * Bounded action input resolution: hydrate what the owning room needs from
   * trusted state that already exists. Today that is Scout's discovery brief,
   * composed deterministically from the saved ICP's targeting fields. Nothing
   * is invented, and an unresolvable proposal stays exactly as proposed, with
   * the missing fields named on it.
   */
  const finalActions = fillProposalPayloads(selected.slice(0, 3), input.icp ?? null);
  const inputResolutions = {
    ...resolveProposalInputs(finalActions, input.icp ?? null),
    ...roadmapResolutions,
  };


  /*
   * What we learned last time, brought to bear on this answer.
   *
   * Bounded three ways: only the rooms this answer actually touches, only the
   * operations it is about when it names any, and only the strongest current
   * records, never the whole history, and never a superseded one. A person's
   * correction outranks inference, and thin evidence stays labelled thin.
   *
   * Learning may sharpen the wording of a suggestion. It may not change who
   * may do it, whether approval is needed, how consequential it is, or which
   * adapters exist. None of those are read from here.
   */
  const roomsInPlay = Array.from(
    new Set(
      [
        ...finalActions.map((action) => action.appId),
        nextMove?.appId,
        ...(plan?.rooms.map((room) => room.appId) ?? []),
      ].filter((room): room is string => Boolean(room) && room !== "conductor"),
    ),
  );
  const operationsInPlay = Array.from(new Set(finalActions.map((action) => action.operation)));
  const lessons =
    roomsInPlay.length === 0
      ? []
      : relevantLearning({
          records: input.priorLearning ?? [],
          rooms: roomsInPlay,
          ...(operationsInPlay.length > 0 ? { operations: operationsInPlay } : {}),
          limit: 3,
        });
  const priorLearning = learningForPacket(lessons);

  /*
   * A standing lesson is said out loud rather than quietly steering the
   * answer. The suggestion still stands; the person simply gets to see what
   * happened the last few times before authorising it again.
   */
  const standing = lessons.find((record) => record.basis === "decided") ?? lessons.find((record) => record.isRule);
  if (standing) {
    answer = sentence([
      answer,
      standing.basis === "decided"
        ? `You corrected this before: ${standing.lesson}`
        : `Worth knowing: ${standing.lesson}`,
    ]);
    evidence.push(
      computed(
        standing.basis === "decided"
          ? "A correction you recorded about this room"
          : "A pattern in the outcome ledger for this room",
      ),
    );
  }
  const actionGraph = buildActionGraph({
    organizationId: snapshot.organizationId,
    purpose: question.trim().length > 0 ? question.trim() : "Read of the business",
    proposals: finalActions,
    plan,
    now: snapshot.now,
  });

  /*
   * The canon reads the same observations the engine already made and says
   * which known shapes they resemble. It adds no fact, changes no lane, and
   * speaks only when the evidence carries it: the top match is voiced with its
   * competing explanation attached, so the sentence stays a reading.
   */
  const patterns = matchPatterns({
    observations: observeBusiness(snapshot),
    ...(input.suppressed ? { suppressed: input.suppressed } : {}),
    limit: 3,
  });
  const leadPattern = patterns[0];
  if (leadPattern && leadPattern.score >= LABEL_THRESHOLD) {
    answer = sentence([answer, describeMatch(leadPattern)]);
  }



  return {
    id: `conductor:${topic}:${snapshot.now}`,
    organizationId: snapshot.organizationId,
    question,
    topic,
    answer,
    vitals,
    factory,
    evidence,
    assumptions,
    unknowns,
    ...(nextMove ? { nextMove } : {}),
    ...(plan ? { plan } : {}),
    improvements: shownImprovements,
    proposedActions: finalActions,
    inputResolutions,
    ...(roadmapCanon ? { roadmapCanon } : {}),

    ...(actionGraph ? { actionGraph } : {}),
    learning,
    priorLearning,
    figures,
    control: CONDUCTOR_CONTROL,
    withheld: snapshot.withheld.map((row) => ({ appId: row.appId, reason: row.reason })),
    ...(watch ? { watch } : {}),
    ...(patterns.length > 0 ? { patterns } : {}),
    grounded,
    generatedAt: snapshot.now,
  };
}
