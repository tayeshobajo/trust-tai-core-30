/**
 * Stage five: recommend.
 *
 * A recommendation is a proposal, never an instruction and never an action.
 * Three constraints keep generativity honest:
 *
 *   1. Anything actionable cites two rooms or more. One room is a hunch, and
 *      is labelled as one.
 *   2. Every recommendation declares what should become observably true if it
 *      worked. A proposal whose success could not be observed is not shown,
 *      because it could never be learned from.
 *   3. Proposing that something be *built* requires a repeated structural
 *      need, the same friction across three distinct sources, not a bad day.
 */

import {
  MAX_RECOMMENDATIONS,
  MIN_ROOMS_FOR_ACTIONABLE,
  STRUCTURAL_NEED_THRESHOLD,
  type Hypothesis,
  type Observation,
  type Recommendation,
  type RecommendationDestination,
  type RecommendationEffort,
  type RecommendationKind,
} from "@/domain/intelligence-engine";

const SCOUT: RecommendationDestination = {
  appId: "scout",
  label: "Open in Scout",
  route: "/modules/scout",
};
const COMMS: RecommendationDestination = {
  appId: "comms",
  label: "Open in Comms",
  route: "/modules/comms",
};
const PROJECTS: RecommendationDestination = {
  appId: "projects",
  label: "Open in Projects",
  route: "/modules/projects",
};
const ROADMAP: RecommendationDestination = {
  appId: "roadmap",
  label: "Open in Roadmap",
  route: "/modules/roadmap",
};
const STEWARD: RecommendationDestination = {
  appId: "steward",
  label: "Open in Steward",
  route: "/modules/steward",
};

interface Template {
  /** Which reading it answers. */
  hypothesisId: string;
  kind: RecommendationKind;
  effort: RecommendationEffort;
  headline: string;
  move: string;
  expectedSignal: string;
  /** The observation kind whose movement will answer for it. */
  expectedSignalKind: string;
  destination: RecommendationDestination;
  /** Only propose building when the need has repeated this often. */
  structural?: boolean;
  order: number;
}

const TEMPLATES: Template[] = [
  {
    hypothesisId: "hyp:idle_capacity",
    kind: "campaign",
    effort: "medium",
    headline: "Run one focused outbound push while delivery is empty",
    move:
      "Pick the strongest-fit companies already on the Scout board, route them to Comms, and open the conversation this week rather than sourcing more.",
    expectedSignal: "At least one qualified company has a live conversation in Comms.",
    expectedSignalKind: "pipeline_unrouted",
    destination: SCOUT,
    order: 100,
  },
  {
    hypothesisId: "hyp:thin_pipeline",
    kind: "campaign",
    effort: "medium",
    headline: "Refill the pipeline deliberately, not opportunistically",
    move:
      "Spend one session in Scout sourcing against the current ICP, and qualify or pass everything found in the same session so the board stays honest.",
    expectedSignal: "More live companies are on the Scout board than today.",
    expectedSignalKind: "pipeline_volume",
    destination: SCOUT,
    order: 90,
  },
  {
    hypothesisId: "hyp:delivery_slipping",
    kind: "move",
    effort: "small",
    headline: "Unblock the work that stopped moving",
    move:
      "Open the stalled project, record what it is actually waiting on, and either answer it or name who must.",
    expectedSignal: "The stalled project records movement.",
    expectedSignalKind: "delivery_delay_count",
    destination: PROJECTS,
    order: 95,
  },
  {
    hypothesisId: "hyp:promises_slipping",
    kind: "move",
    effort: "small",
    headline: "Close or honestly move the promises that have passed",
    move:
      "Go through the overdue promises: do the smallest one now, and move the dates you cannot keep rather than leaving them silent.",
    expectedSignal: "No promise remains past a date a person set.",
    expectedSignalKind: "commitment_overdue",
    destination: STEWARD,
    order: 98,
  },
  {
    hypothesisId: "hyp:reply_debt",
    kind: "move",
    effort: "small",
    headline: "Clear the replies you owe",
    move: "Answer the oldest overdue relationship today, even if the answer is 'not yet'.",
    expectedSignal: "No relationship is past a date recorded in Comms.",
    expectedSignalKind: "reply_debt",
    destination: COMMS,
    order: 92,
  },
  {
    hypothesisId: "hyp:client_drift",
    kind: "move",
    effort: "small",
    headline: "Reopen the relationships that went quiet",
    move:
      "Reach out with something useful to the quiet relationships, or archive them deliberately so the list stays true.",
    expectedSignal: "The quiet relationships record a new touch, or are archived on purpose.",
    expectedSignalKind: "relationship_silent",
    destination: COMMS,
    order: 85,
  },
  {
    hypothesisId: "hyp:structural_friction",
    kind: "system",
    effort: "medium",
    headline: "Build the missing step instead of absorbing it again",
    move:
      "The same obstruction has recurred often enough to be structural. Sequence a small capability in Roadmap that removes it, rather than handling it manually next time.",
    expectedSignal: "The recurring obstruction stops being recorded.",
    expectedSignalKind: "recurring_blocker",
    destination: ROADMAP,
    structural: true,
    order: 80,
  },
  {
    hypothesisId: "hyp:unworked_opportunity",
    kind: "move",
    effort: "small",
    headline: "Decide on the strong-fit companies already found",
    move: "Review the unreviewed strong-fit companies and either qualify or pass each one.",
    expectedSignal: "No strong-fit company is left unreviewed.",
    expectedSignalKind: "strong_fit_unreviewed",
    destination: SCOUT,
    order: 70,
  },
  {
    hypothesisId: "hyp:inbound_pull",
    kind: "experiment",
    effort: "small",
    headline: "Find out what is pulling people in, then do more of it",
    move:
      "Ask the inbound relationships how they found you, record the answer in Comms, and repeat whatever they name.",
    expectedSignal: "Inbound relationships carry a recorded origin.",
    expectedSignalKind: "inbound_volume",
    destination: COMMS,
    order: 60,
  },
];

/**
 * Turn readings into proposals. Nothing here writes; the destination is the
 * room where a person does the work.
 */
export function deriveRecommendations(input: {
  hypotheses: Hypothesis[];
  observations: Observation[];
  now: string;
  suppressed?: string[];
  /** Pattern keys a person accepted before. Ordering nudge only. */
  favoured?: string[];
}): Recommendation[] {
  const byId = new Map(input.hypotheses.map((h) => [h.id, h]));
  const observationById = new Map(input.observations.map((row) => [row.id, row]));
  const suppressed = new Set(input.suppressed ?? []);
  const favoured = new Set(input.favoured ?? []);
  const out: Recommendation[] = [];

  for (const template of TEMPLATES) {
    const hypothesis = byId.get(template.hypothesisId);
    if (!hypothesis) continue;

    const patternKey = `engine:rec:${template.hypothesisId}`;
    if (suppressed.has(patternKey) || suppressed.has(hypothesis.patternKey)) continue;

    const supporting = hypothesis.observationRefs
      .map((ref) => observationById.get(ref))
      .filter((row): row is Observation => Boolean(row));
    if (supporting.length === 0) continue;

    const rooms = new Set(supporting.flatMap((row) => row.sourceApps));

    /* Building something is only ever proposed on repeated structural need. */
    if (template.structural) {
      const repeats = Math.max(
        ...supporting.map((row) => (row.kind === "recurring_blocker" ? (row.magnitude ?? 0) : 0)),
      );
      if (repeats < STRUCTURAL_NEED_THRESHOLD) continue;
    }

    const hunch = rooms.size < MIN_ROOMS_FOR_ACTIONABLE;

    out.push({
      id: `rec:${template.hypothesisId}`,
      kind: template.kind,
      theme: hypothesis.theme,
      headline: hunch ? `${template.headline} (worth a look)` : template.headline,
      rationale: `${hypothesis.claim} ${template.move}`,
      hypothesisRefs: [hypothesis.id],
      observationRefs: hypothesis.observationRefs,
      /* A single-room proposal can never read as more than a hunch. */
      confidence: hunch ? "low" : hypothesis.confidence,
      effort: template.effort,
      expectedSignal: template.expectedSignal,
      expectedSignalKind: template.expectedSignalKind,
      destination: template.destination,
      sourceApps: [...rooms],
      patternKey,
      order: template.order + (favoured.has(patternKey) ? 5 : 0),
      at: input.now,
    });
  }

  return out
    .sort((a, b) => b.order - a.order || a.id.localeCompare(b.id))
    .slice(0, MAX_RECOMMENDATIONS);
}
