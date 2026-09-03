/**
 * Stage two and three: understand, then remember.
 *
 * Deterministic connectors group observations into a small candidate set of
 * readings. This is not the intelligence, it is the floor under it: the set
 * the engine can defend with counts alone, and the fallback when no model is
 * available. The evidence packet built here is the only thing a model is ever
 * allowed to reason over.
 */

import type { ConfidenceLevel } from "@/domain/confidence";
import {
  confidenceFromEvidence,
  STRUCTURAL_NEED_THRESHOLD,
  type BusinessTheme,
  type Hypothesis,
  type Observation,
} from "@/domain/intelligence-engine";

import { THIN_PIPELINE_COUNT } from "./observe";

/** A named way observations can add up. Never a business rule with a verdict. */
interface Connector {
  id: string;
  theme: BusinessTheme;
  /** Observation kinds that must all be present. */
  requires: string[];
  /** Kinds that strengthen the reading when present. */
  supports?: string[];
  /** Kinds that argue against it. Recorded, never hidden. */
  against?: string[];
  /** Extra condition on magnitudes, when the count itself is the point. */
  when?: (byKind: Map<string, Observation[]>) => boolean;
  claim: (byKind: Map<string, Observation[]>) => string;
}

function first(byKind: Map<string, Observation[]>, kind: string): Observation | undefined {
  return byKind.get(kind)?.[0];
}

function magnitude(byKind: Map<string, Observation[]>, kind: string): number {
  return first(byKind, kind)?.magnitude ?? 0;
}

export const CONNECTORS: Connector[] = [
  {
    id: "idle_capacity",
    theme: "capacity",
    requires: ["no_active_project"],
    supports: ["pipeline_volume", "pipeline_sourcing_stale", "pipeline_unrouted"],
    against: ["open_projects"],
    claim: () =>
      "There is no delivery work running, so the business is currently earning nothing from execution.",
  },
  {
    id: "thin_pipeline",
    theme: "pipeline",
    requires: ["pipeline_volume"],
    supports: ["pipeline_sourcing_stale", "no_active_project"],
    when: (byKind) => magnitude(byKind, "pipeline_volume") < THIN_PIPELINE_COUNT,
    claim: (byKind) => {
      const count = magnitude(byKind, "pipeline_volume");
      return count === 0
        ? "Nothing is in the pipeline, so there is no path to the next piece of work."
        : `Only ${count} compan${count === 1 ? "y is" : "ies are"} live in the pipeline, which is too few to rely on.`;
    },
  },
  {
    id: "delivery_slipping",
    theme: "delivery",
    requires: ["delivery_delay_count"],
    supports: ["project_blocked", "recurring_blocker", "open_decisions"],
    claim: (byKind) =>
      `${magnitude(byKind, "delivery_delay_count")} piece${magnitude(byKind, "delivery_delay_count") === 1 ? "" : "s"} of live work stopped moving, which usually means something upstream is unresolved rather than that the work is hard.`,
  },
  {
    id: "promises_slipping",
    theme: "follow_through",
    requires: ["commitment_overdue"],
    supports: ["reply_debt", "open_decisions"],
    claim: () =>
      "Promises people made in conversation have passed their dates, so trust is being spent rather than built.",
  },
  {
    id: "reply_debt",
    theme: "follow_through",
    requires: ["reply_debt"],
    supports: ["relationship_silent"],
    claim: (byKind) =>
      `${magnitude(byKind, "reply_debt")} relationship${magnitude(byKind, "reply_debt") === 1 ? " is" : "s are"} waiting on a reply that was promised.`,
  },
  {
    id: "client_drift",
    theme: "client_risk",
    requires: ["relationship_silent"],
    supports: ["reply_debt", "no_active_project"],
    claim: (byKind) => {
      const rows = byKind.get("relationship_silent") ?? [];
      const names = rows
        .map((row) => row.subject?.label)
        .filter((label): label is string => Boolean(label));
      return rows.length === 1 && names[0]
        ? `${names[0]} is drifting: the relationship is still marked active but nothing has been said for weeks.`
        : `${rows.length} active relationships have gone quiet, which is how a client list shrinks without anyone deciding.`;
    },
  },
  {
    id: "structural_friction",
    theme: "friction",
    requires: ["recurring_blocker"],
    supports: ["delivery_delay_count", "project_blocked"],
    when: (byKind) => magnitude(byKind, "recurring_blocker") >= STRUCTURAL_NEED_THRESHOLD,
    claim: (byKind) => {
      const row = first(byKind, "recurring_blocker");
      return `The same obstruction keeps recurring${row?.subject?.label ? ` around ${row.subject.label}` : ""}, which points at a missing step in how the work is set up rather than at one bad week.`;
    },
  },
  {
    id: "unworked_opportunity",
    theme: "opportunity",
    requires: ["strong_fit_unreviewed"],
    supports: ["pipeline_unrouted", "inbound_volume", "no_active_project"],
    claim: (byKind) =>
      `${magnitude(byKind, "strong_fit_unreviewed")} strong-fit compan${magnitude(byKind, "strong_fit_unreviewed") === 1 ? "y is" : "ies are"} sitting unreviewed, so a decision already worth making has not been made.`,
  },
  {
    id: "inbound_pull",
    theme: "opportunity",
    requires: ["inbound_volume"],
    supports: ["pipeline_volume"],
    when: (byKind) => magnitude(byKind, "inbound_volume") >= 2,
    claim: (byKind) =>
      `${magnitude(byKind, "inbound_volume")} relationships arrived inbound, which suggests something is already attracting the right people.`,
  },
];

function indexByKind(observations: Observation[]): Map<string, Observation[]> {
  const byKind = new Map<string, Observation[]>();
  for (const observation of observations) {
    const list = byKind.get(observation.kind) ?? [];
    list.push(observation);
    byKind.set(observation.kind, list);
  }
  return byKind;
}

function stalenessOf(rows: Observation[], now: string): number {
  const newest = rows
    .map((row) => new Date(row.at).getTime())
    .sort()
    .at(-1);
  if (!newest || Number.isNaN(newest)) return 0;
  return Math.max(0, Math.floor((new Date(now).getTime() - newest) / 86_400_000));
}

/**
 * The readings the counts alone support. These are shown when no model is
 * available, and they are the ground a model's output is checked against.
 */
export function deriveHypotheses(observations: Observation[], now: string): Hypothesis[] {
  const byKind = indexByKind(observations);
  const hypotheses: Hypothesis[] = [];

  for (const connector of CONNECTORS) {
    if (!connector.requires.every((kind) => byKind.has(kind))) continue;
    if (connector.when && !connector.when(byKind)) continue;

    const supporting = [
      ...connector.requires.flatMap((kind) => byKind.get(kind) ?? []),
      ...(connector.supports ?? []).flatMap((kind) => byKind.get(kind) ?? []),
    ];
    const contradicting = (connector.against ?? []).flatMap((kind) => byKind.get(kind) ?? []);
    if (supporting.length === 0) continue;
    /* A reading whose contradiction is present and whose support is only the
       requirement is not a reading. Say nothing rather than something shaky. */
    if (contradicting.length > 0 && supporting.length <= connector.requires.length) continue;

    const rooms = new Set(supporting.flatMap((row) => row.sourceApps));
    hypotheses.push({
      id: `hyp:${connector.id}`,
      theme: connector.theme,
      claim: connector.claim(byKind),
      because: supporting
        .slice(0, 4)
        .map((row) => row.statement)
        .join(" "),
      confidence: confidenceFromEvidence({
        observationCount: supporting.length,
        roomCount: rooms.size,
        stalenessDays: stalenessOf(supporting, now),
      }),
      observationRefs: supporting.map((row) => row.id),
      sourceApps: [...rooms],
      ...(contradicting.length > 0 ? { contradicts: contradicting.map((row) => row.id) } : {}),
      patternKey: `engine:${connector.id}`,
      origin: "derived" as const,
      at: now,
    });
  }

  return hypotheses;
}

/* ------------------------------------------------------------------ packet */

/**
 * The only material a model may reason over.
 *
 * Everything in here is already true. Anything the model says that is not
 * traceable to this packet is dropped by verification, so the packet is also
 * the definition of what cannot be invented.
 */
export interface EvidencePacket {
  organizationId: string;
  now: string;
  observations: {
    id: string;
    theme: BusinessTheme;
    kind: string;
    statement: string;
    tier: string;
    magnitude?: number;
    sourceApps: string[];
    at: string;
  }[];
  /** Deterministic readings, so the model connects rather than repeats. */
  derived: { id: string; claim: string; confidence: ConfidenceLevel }[];
  /** Human-decided memory. Outranks anything the model infers. */
  decided: string[];
  /** Readings people have told the engine to stop raising. */
  suppressed: string[];
  /** Rooms that could not be read, so the model can say so rather than guess. */
  withheld: { appId: string; reason: string }[];
}

export function buildEvidencePacket(input: {
  organizationId: string;
  now: string;
  observations: Observation[];
  derived: Hypothesis[];
  decided?: string[];
  suppressed?: string[];
  withheld?: { appId: string; reason: string }[];
}): EvidencePacket {
  return {
    organizationId: input.organizationId,
    now: input.now,
    observations: input.observations.map((row) => ({
      id: row.id,
      theme: row.theme,
      kind: row.kind,
      statement: row.statement,
      tier: row.tier,
      ...(row.magnitude === undefined ? {} : { magnitude: row.magnitude }),
      sourceApps: row.sourceApps,
      at: row.at,
    })),
    derived: input.derived.map((row) => ({
      id: row.id,
      claim: row.claim,
      confidence: row.confidence,
    })),
    decided: input.decided ?? [],
    suppressed: input.suppressed ?? [],
    withheld: input.withheld ?? [],
  };
}
