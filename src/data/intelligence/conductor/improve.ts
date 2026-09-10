/**
 * The generative system-improvement loop.
 *
 * Detect → understand → diagnose → propose → classify risk → human approval →
 * route to the owning room → observe → learn. This file owns detect through
 * propose; approval and execution stay exactly where they already are.
 *
 * Nothing here modifies the suite. A repeated friction becomes a proposal a
 * person reads, never a change a machine makes. The threshold matters: two is
 * a coincidence, three is how the work actually flows.
 */

import type { ActivityEvent } from "@/domain/activity";
import type { EvidenceRef } from "@/domain/confidence";
import {
  FRICTION_THRESHOLD,
  type FrictionPattern,
  type SystemImprovement,
} from "@/domain/conductor";

import type { SuiteSnapshot } from "../derive";

function computed(label: string): EvidenceRef {
  return { label, kind: "computed" };
}

interface Bucket {
  key: string;
  statement: string;
  sourceApps: string[];
  events: ActivityEvent[];
}

function bucket(
  map: Map<string, Bucket>,
  key: string,
  statement: string,
  appId: string,
  event: ActivityEvent,
): void {
  const existing = map.get(key);
  if (existing) {
    existing.events.push(event);
    if (!existing.sourceApps.includes(appId)) existing.sourceApps.push(appId);
    return;
  }
  map.set(key, { key, statement, sourceApps: [appId], events: [event] });
}

/**
 * Repeated friction in the shared record.
 *
 * Only counts things that repeat with the same shape: the same blocker, the
 * same withdrawn route, the same correction. One-off events are the business
 * working, not the business hurting.
 */
export function detectFriction(snapshot: SuiteSnapshot): FrictionPattern[] {
  const map = new Map<string, Bucket>();
  const events = [...snapshot.events, ...snapshot.opsActivities];

  for (const event of events) {
    const appId = event.provenance.appId;

    if (event.name.endsWith(".blocked")) {
      bucket(map, "recurring_blocker", "Work keeps getting blocked.", appId, event);
    }
    if (event.name === "project.route_withdrawn") {
      bucket(
        map,
        "routes_withdrawn",
        "Routed work keeps being taken back before anyone accepts it.",
        appId,
        event,
      );
    }
    if (event.name === "project.route_notified") {
      const delivered = (event.payload ?? {})["delivered"];
      if (delivered === false) {
        bucket(
          map,
          "routing_undelivered",
          "Routing requests cannot reach the receiving room.",
          appId,
          event,
        );
      }
    }
    if (event.name === "prospect.handed_over" || event.name === "relationship.created") {
      bucket(
        map,
        "handoff_volume",
        "Context is being carried between rooms by hand.",
        appId,
        event,
      );
    }
  }

  /* Corrections a person made are friction of the most useful kind. */
  const corrections = snapshot.memory.filter((belief) => belief.meta.kind === "correction");
  if (corrections.length > 0) {
    map.set("repeated_corrections", {
      key: "repeated_corrections",
      statement: "The same readings keep needing a person to put them right.",
      sourceApps: ["steward"],
      events: [],
    });
  }

  const patterns: FrictionPattern[] = [];
  for (const row of map.values()) {
    const occurrences =
      row.key === "repeated_corrections"
        ? corrections.length
        : new Set(row.events.map((event) => event.id)).size;
    if (occurrences < FRICTION_THRESHOLD) continue;

    const dates =
      row.events.length > 0
        ? row.events.map((event) => event.occurredAt).sort()
        : corrections.map((belief) => belief.recordedAt).sort();

    patterns.push({
      key: row.key,
      statement: row.statement,
      occurrences,
      sourceApps: row.sourceApps,
      firstSeen: dates[0] ?? snapshot.now,
      lastSeen: dates[dates.length - 1] ?? snapshot.now,
      evidence: [computed(`${occurrences} occurrences in the shared record`)],
    });
  }

  return patterns.sort((a, b) => b.occurrences - a.occurrences || a.key.localeCompare(b.key));
}

interface Template {
  headline: string;
  diagnosis: string;
  fix: string;
  risk: SystemImprovement["risk"];
  reversible: boolean;
  owningApp: string;
  route: string;
  expectedSignal: string;
}

const TEMPLATES: Record<string, Template> = {
  recurring_blocker: {
    headline: "Make the recurring blocker a standing dependency, not a surprise",
    diagnosis:
      "Work is being blocked repeatedly by the same class of dependency, which means the dependency is structural rather than incidental.",
    fix: "Capture the dependency on the project template so it is agreed before execution starts, instead of discovered mid-flight.",
    risk: "low",
    reversible: true,
    owningApp: "projects",
    route: "/modules/projects",
    expectedSignal: "Fewer projects entering the blocked state for the same reason.",
  },
  routes_withdrawn: {
    headline: "Tighten what a route has to carry before it is sent",
    diagnosis:
      "Routed work keeps being withdrawn, which usually means the ask was not ready when it left Projects rather than that the receiving room was wrong.",
    fix: "Require the acceptance criteria and boundary to be filled in before a route can be sent.",
    risk: "low",
    reversible: true,
    owningApp: "projects",
    route: "/modules/projects",
    expectedSignal: "Withdrawal rate on routed work falls.",
  },
  routing_undelivered: {
    headline: "Connect the receiving room's inbox",
    diagnosis:
      "Routing requests are being recorded but not delivered, so Ops and Studio never consciously accept or reject them.",
    fix: "Configure the receiving room's routing inbox so requests arrive where the work is actually picked up.",
    risk: "low",
    reversible: true,
    owningApp: "ops",
    route: "/modules/ops",
    expectedSignal:
      "Routing requests are delivered, and acceptance starts appearing in the stream.",
  },
  handoff_volume: {
    headline: "Carry the handoff context automatically",
    diagnosis:
      "Context is being moved between rooms by hand often enough that the copying itself is now part of the process.",
    fix: "Have the handoff carry its evidence and Point A/Point B forward by reference, so nothing is retyped.",
    risk: "medium",
    reversible: true,
    owningApp: "comms",
    route: "/modules/comms",
    expectedSignal: "Handoffs arrive with their context intact and without manual re-entry.",
  },
  repeated_corrections: {
    headline: "Learn from the corrections instead of re-asking",
    diagnosis:
      "People keep correcting the same shape of reading, which means the interpretation is missing a rule the business already knows.",
    fix: "Fold the corrected shape into Steward's memory selection so the same reading is not raised again.",
    risk: "low",
    reversible: true,
    owningApp: "steward",
    route: "/modules/steward/memory",
    expectedSignal: "Fewer corrections of the same shape.",
  },
};

/**
 * Turn repeated friction into bounded, approval-gated system proposals.
 *
 * Every proposal names the room that would own the change and the signal that
 * would prove it worked. Nothing is executed, and there is no path here that
 * modifies the suite without a person.
 */
export function proposeImprovements(patterns: FrictionPattern[]): SystemImprovement[] {
  return patterns
    .map((pattern) => {
      const template = TEMPLATES[pattern.key];
      if (!template) return null;
      const improvement: SystemImprovement = {
        id: `improvement:${pattern.key}`,
        frictionKey: pattern.key,
        headline: template.headline,
        diagnosis: `${pattern.statement} ${template.diagnosis} Seen ${pattern.occurrences} times.`,
        fix: template.fix,
        risk: template.risk,
        reversible: template.reversible,
        requiresApproval: true,
        owningApp: template.owningApp,
        route: template.route,
        expectedSignal: template.expectedSignal,
        occurrences: pattern.occurrences,
        evidence: pattern.evidence,
      };
      return improvement;
    })
    .filter((row): row is SystemImprovement => row !== null);
}
