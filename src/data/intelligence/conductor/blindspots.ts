/**
 * The gap finder: what the business cannot currently see.
 *
 * A blind spot is a question, not an answer. Nothing here guesses at the
 * missing value, it names the question, why it matters, and the instrument
 * that would answer it. Detecting a gap is cheap; pretending it is filled is
 * how a business steers into a wall.
 */

import type { EvidenceRef } from "@/domain/confidence";
import {
  VITAL_SIGNS,
  vitalSign,
  type BlindSpot,
  type BusinessIntent,
  type BusinessVitals,
  type FactoryRead,
} from "@/domain/conductor";

import type { SuiteSnapshot } from "../derive";
import { GOAL_VITAL_KEY } from "./vitals";

function computed(label: string): EvidenceRef {
  return { label, kind: "computed" };
}

function human(label: string): EvidenceRef {
  return { label, kind: "human" };
}

/** Vital signs without which no revenue or pipeline goal can be decomposed. */
export const PLANNING_INPUTS = ["average_deal_size", "close_rate", "sales_cycle"];

/**
 * Every gap worth naming right now, most severe first.
 *
 * Pure over the read: the same vitals, factory read and intents always
 * produce the same list.
 */
export function findBlindSpots(input: {
  snapshot: SuiteSnapshot;
  vitals: BusinessVitals;
  factory: FactoryRead;
  intents: BusinessIntent[];
}): BlindSpot[] {
  const { snapshot, vitals, factory, intents } = input;
  const spots: BlindSpot[] = [];
  const unknown = new Set(vitals.unknownKeys);

  /* 1. A goal marked critical whose own metric cannot be read. */
  for (const intent of intents) {
    const key = GOAL_VITAL_KEY[intent.kind];
    if (!key || !unknown.has(key)) continue;
    const definition = vitalSign(key);
    spots.push({
      key: `intent_unmeasurable:${intent.kind}`,
      question: `Are we meeting the goal "${intent.label}"?`,
      whyItMatters: `You decided this goal${intent.critical ? " and marked it critical": ""}, and nothing in the suite can answer whether it is being met.`,
      howToInstrument: definition?.instrumentation ?? "Connect a source for this metric.",
      severity: intent.critical ? "critical": "important",
      state: "not_connected",
      vitalKey: key,
...(definition?.ownerApp ? { ownerApp: definition.ownerApp }: {}),
      evidence: [human("Business intent you decided")],
    });
  }

  /* 2. The planning inputs. Without these, no goal becomes a plan. */
  const wantsPipeline = intents.some(
    (intent) => intent.kind === "revenue" || intent.kind === "qualified_pipeline",
  );
  for (const key of PLANNING_INPUTS) {
    if (!unknown.has(key)) continue;
    const definition = vitalSign(key);
    if (!definition) continue;
    spots.push({
      key: `planning_input:${key}`,
      question: `What is our ${definition.label.toLowerCase()}?`,
      whyItMatters: wantsPipeline
        ? `${definition.whyItMatters} Without it, a revenue or pipeline goal cannot be turned into room-by-room targets.`
: definition.whyItMatters,
      howToInstrument: definition.instrumentation,
      severity: wantsPipeline ? "critical": "important",
      state: "not_connected",
      vitalKey: key,
...(definition.ownerApp ? { ownerApp: definition.ownerApp }: {}),
      evidence: [computed("No source in the suite answers this")],
    });
  }

  /* 3. Survival metrics. Always worth naming while they are dark. */
  for (const key of ["cash_runway", "recurring_revenue"]) {
    if (!unknown.has(key)) continue;
    const definition = vitalSign(key)!;
    spots.push({
      key: `survival:${key}`,
      question: `${definition.label}: what is it today?`,
      whyItMatters: definition.whyItMatters,
      howToInstrument: definition.instrumentation,
      severity: "critical",
      state: "not_connected",
      vitalKey: key,
      evidence: [computed("No finance source is connected")],
    });
  }

  /* 4. A stage of the factory that records nothing at all. */
  for (const flow of factory.flows) {
    if (flow.basis !== "unknown" || flow.node.role !== "stage") continue;
    spots.push({
      key: `factory_dark:${flow.node.id}`,
      question: `Is ${flow.node.label.toLowerCase()} moving at all?`,
      whyItMatters: `${flow.node.meaning} Nothing writes this stage into the shared record, so an upstream fall here cannot be seen before it reaches revenue.`,
      howToInstrument: `Have ${flow.node.ownerApp} record its own events (${flow.node.eventNames.join(", ")}) in the shared stream.`,
      severity: "important",
      state: "not_connected",
      ownerApp: flow.node.ownerApp,
      evidence: [computed("No events for this stage in the shared record")],
    });
  }

  /* 5. Activity without progress: rooms busy while the outcome stage is dark. */
  const outcomes = factory.flows.find((flow) => flow.node.id === "revenue");
  const busyUpstream = factory.flows.filter(
    (flow) => flow.node.role === "stage" && (flow.recent ?? 0) > 0,
  );
  if (outcomes && (outcomes.recent ?? 0) === 0 && busyUpstream.length >= 2) {
    spots.push({
      key: "activity_without_progress",
      question: "Is all this activity producing any delivered outcome?",
      whyItMatters: `${busyUpstream.length} stages recorded work in the last ${factory.windowDays} days and nothing reached delivered outcomes. Activity counts can stay healthy while the business stops producing.`,
      howToInstrument:
        "Record completion in Projects for every engagement, so outcome throughput is countable.",
      ownerApp: "projects",
      severity: "important",
      state: "no_signal",
      evidence: [computed(`Activity record, last ${factory.windowDays} days`)],
    });
  }

  /* 6. Single point of failure: everything recorded by one person. */
  const actors = new Set(
    snapshot.events
.map((event) => event.provenance.actor.id)
.filter((id) => typeof id === "string" && id.length > 0),
  );
  if (snapshot.events.length >= 10 && actors.size === 1) {
    spots.push({
      key: "single_point_of_failure",
      question: "What happens to the business if one person is unavailable for two weeks?",
      whyItMatters:
        "Every recorded action in the shared stream comes from one person. Nothing here says the work is theirs alone, only that no one else has touched the record.",
      howToInstrument:
        "Give a second person write access in at least one room and record work under their own identity.",
      severity: "important",
      evidence: [computed("Every activity row has the same actor")],
    });
  }

  /* 7. No decided goal at all, the largest possible gap. */
  if (intents.length === 0) {
    spots.push({
      key: "no_business_intent",
      question: "What is this business trying to achieve, and by when?",
      whyItMatters:
        "Without a decided outcome, nothing can be derived. Every target below would be invented, and inventing them is exactly what this system refuses to do.",
      howToInstrument: "Set at least one business intent, with a target and a horizon.",
      severity: "critical",
      evidence: [human("No intent recorded in Steward's ledger")],
    });
  }

  const order = { critical: 0, important: 1, worth_knowing: 2 } as const;
  return spots.sort((a, b) => order[a.severity] - order[b.severity] || a.key.localeCompare(b.key));
}

/** Signs that exist in the registry but nothing in the suite could answer. */
export function uninstrumentedSigns(vitals: BusinessVitals) {
  return VITAL_SIGNS.filter((sign) => vitals.unknownKeys.includes(sign.key));
}
