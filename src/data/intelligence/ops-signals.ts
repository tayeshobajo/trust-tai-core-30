/**
 * Ops evidence, read into the shared intelligence layer.
 *
 * Everything here is derived from rows Ops already wrote into the shared
 * `activities` table. Ops rows are observed evidence: what happened, when, and
 * where in Ops it lives. Nothing is inferred about the technical state Ops
 * owns, and nothing is written back.
 *
 * A risk stays open until a later event on the same chain (canonical project,
 * run, or issue) clears it. Duplicate rows for the same happening collapse to
 * one piece of evidence and one signal.
 */

import type { EvidenceRef } from "@/domain/confidence";
import type { EntityRef, ID } from "@/domain/entities";
import {
  OPS_CLEARS,
  OPS_ORIGIN,
  OPS_RISK_EVENTS,
  type OpsEvent,
  type OpsEventName,
} from "@/domain/ops";
import type { ContextBlock, Signal, SignalCategory } from "@/domain/signals";

const DAY = 86_400_000;

function daysOld(at: string, now: string): number {
  const a = new Date(at).getTime();
  const b = new Date(now).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / DAY));
}

function opsEvidence(event: OpsEvent): EvidenceRef {
  return {
    label: `Ops event ${event.name.replace("ops.", "")}`,
    kind: "provider",
    url: event.destinationUrl,
  };
}

function entityFor(event: OpsEvent): EntityRef {
  if (event.canonicalProjectId) {
    return { type: "project", id: event.canonicalProjectId, label: event.subjectLabel };
  }
  return { type: "activity", id: event.id, label: event.subjectLabel };
}

export function opsBlockId(event: OpsEvent): string {
  return `ops:event:${event.idempotencyKey}`;
}

/** Every Ops row as one observed context block. */
export function opsContextBlocks(events: OpsEvent[], now: string): ContextBlock[] {
  return events.map((event) => ({
    id: opsBlockId(event),
    appId: "ops" as const,
    entity: entityFor(event),
    fact: event.summary,
    tier: event.humanDecision ? ("decided" as const) : ("observed" as const),
    evidence: [opsEvidence(event)],
    at: event.at,
    stalenessDays: daysOld(event.at, now),
    confidence: "high" as const,
  }));
}

interface Shape {
  category: SignalCategory;
  urgency: number;
  title: (label: string) => string;
  why: string;
  move: string;
}

const SHAPES: Record<string, Shape> = {
  "ops.blocked": {
    category: "technical_risk",
    urgency: 94,
    title: (label) => `${label} is blocked in Ops`,
    why: "Technical work has stopped, so delivery downstream of it cannot move.",
    move: "Open the blocked work in Ops and clear it or say what it is waiting on.",
  },
  "ops.qa_failed": {
    category: "technical_risk",
    urgency: 86,
    title: (label) => `QA failed on ${label}`,
    why: "A change did not pass its checks, so what is live may not be what was intended.",
    move: "Review the failed QA run in Ops before anything else ships.",
  },
  "ops.issue_detected": {
    category: "technical_risk",
    urgency: 74,
    title: (label) => `Ops found an issue on ${label}`,
    why: "A technical issue is on record and nothing has cleared it yet.",
    move: "Open the issue in Ops and decide whether it is fixed or accepted.",
  },
  "ops.approval_required": {
    category: "delivery",
    urgency: 90,
    title: (label) => `Ops is waiting on approval for ${label}`,
    why: "Work is finished up to a decision only a person can make.",
    move: "Approve or decline the run in Ops so the work can continue.",
  },
  "ops.recommendation_created": {
    category: "client_stewardship",
    urgency: 48,
    title: (label) => `Ops recommended something for ${label}`,
    why: "A recommendation is on record and has not been acted on.",
    move: "Read the recommendation in Ops and accept or dismiss it.",
  },
};

function supersededBy(event: OpsEvent, later: OpsEvent[]): OpsEvent | undefined {
  return later.find((candidate) => {
    if (candidate.chainKey !== event.chainKey) return false;
    if (candidate.at < event.at) return false;
    return (OPS_CLEARS[candidate.name] ?? []).includes(event.name);
  });
}

/**
 * Ops-derived signals. Only evidence that is still open becomes a risk; a
 * cleared chain becomes a quiet, low-urgency confirmation instead.
 */
export function deriveOpsSignals(events: OpsEvent[], now: string, organizationId: ID): Signal[] {
  const mine = events.filter((event) => event.organizationId === organizationId);
  const clearing = mine.filter((event) => Boolean(OPS_CLEARS[event.name]));
  const signals: Signal[] = [];
  const clearedChains = new Map<string, { risk: OpsEvent; by: OpsEvent }>();

  for (const event of mine) {
    if (!(OPS_RISK_EVENTS as OpsEventName[]).includes(event.name)) continue;
    const shape = SHAPES[event.name];
    if (!shape) continue;

    const cleared = supersededBy(event, clearing);
    if (cleared) {
      const existing = clearedChains.get(event.chainKey);
      if (!existing || existing.risk.at < event.at)
        clearedChains.set(event.chainKey, { risk: event, by: cleared });
      continue;
    }

    signals.push({
      id: `ops:${event.name}:${event.idempotencyKey}`,
      category: shape.category,
      title: shape.title(event.subjectLabel),
      why: `${shape.why} ${event.summary}`.trim(),
      subject: entityFor(event),
      evidence: [opsEvidence(event)],
      contextRefs: [opsBlockId(event)],
      confidence: "high",
      recommendedNextMove: shape.move,
      destination: {
        appId: "ops",
        label: "Open in Ops",
        route: event.destinationUrl || OPS_ORIGIN,
      },
      status: "new",
      urgency: shape.urgency,
      at: event.at,
    });
  }

  for (const [chain, { risk, by }] of clearedChains) {
    signals.push({
      id: `ops:cleared:${chain}:${by.idempotencyKey}`,
      category: "client_stewardship",
      title: `${by.subjectLabel} cleared in Ops`,
      why: `${risk.summary} That is now resolved: ${by.summary}`.trim(),
      subject: entityFor(by),
      evidence: [opsEvidence(risk), opsEvidence(by)],
      contextRefs: [opsBlockId(risk), opsBlockId(by)].filter(
        (id, index, all) => all.indexOf(id) === index,
      ),
      confidence: "high",
      recommendedNextMove: "Nothing is needed here. Read the run in Ops if you want the detail.",
      destination: { appId: "ops", label: "Open in Ops", route: by.destinationUrl || OPS_ORIGIN },
      status: "resolved",
      urgency: 20,
      at: by.at,
    });
  }

  return signals;
}
