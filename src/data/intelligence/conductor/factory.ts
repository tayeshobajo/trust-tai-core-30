/**
 * The factory, read as a causal chain rather than a funnel picture.
 *
 * Each node counts its own throughput in the shared activity record over a
 * recent window and the window before it. When an upstream node falls and its
 * downstream nodes have not felt it yet, that is stated, with the lag, the
 * counts, and the nodes that will feel it. This is how the Conductor can say
 * "next month's pipeline is at risk" while revenue still looks fine.
 *
 * A node with no events in either window is `unknown`, never "down".
 */

import type { EvidenceRef } from "@/domain/confidence";
import {
  FACTORY_GRAPH,
  downstreamOf,
  type FactoryFlowRead,
  type FactoryRead,
  type FactoryWarning,
  type FlowDirection,
} from "@/domain/conductor";

import type { SuiteSnapshot } from "../derive";

const DAY = 86_400_000;

/** The comparison window. Two of these are compared against each other. */
export const FLOW_WINDOW_DAYS = 21;

/** A fall of at least this share of the prior window is a real drop. */
export const MATERIAL_DROP = 0.5;

function computed(label: string): EvidenceRef {
  return { label, kind: "computed" };
}

function inWindow(at: string, from: number, to: number): boolean {
  const t = new Date(at).getTime();
  return !Number.isNaN(t) && t >= from && t < to;
}

/** Throughput per node, plus the upstream falls nothing downstream has felt. */
export function readFactory(
  snapshot: SuiteSnapshot,
  windowDays: number = FLOW_WINDOW_DAYS,
): FactoryRead {
  const now = new Date(snapshot.now).getTime();
  const recentFrom = now - windowDays * DAY;
  const priorFrom = now - 2 * windowDays * DAY;
  const events = [...snapshot.events, ...snapshot.opsActivities];

  const flows: FactoryFlowRead[] = FACTORY_GRAPH.map((node) => {
    const mine = events.filter((event) => node.eventNames.includes(event.name));
    const recent = mine.filter((event) => inWindow(event.occurredAt, recentFrom, now)).length;
    const prior = mine.filter((event) => inWindow(event.occurredAt, priorFrom, recentFrom)).length;

    if (mine.length === 0) {
      return {
        node,
        basis: "unknown",
        direction: "unknown",
        statement: `${node.label} records nothing in the shared stream, so its flow cannot be read.`,
        evidence: [],
      };
    }

    const direction: FlowDirection =
      prior === 0 && recent === 0
        ? "flat"
        : prior === 0
          ? "up"
          : recent === 0 || recent <= prior * MATERIAL_DROP
            ? "down"
            : recent >= prior * 1.5
              ? "up"
              : "flat";

    return {
      node,
      basis: "observed",
      recent,
      prior,
      direction,
      statement: `${node.label}: ${recent} in the last ${windowDays} days, against ${prior} in the ${windowDays} before.`,
      evidence: [computed(`Activity record, two ${windowDays}-day windows`)],
    };
  });

  const warnings: FactoryWarning[] = [];
  for (const flow of flows) {
    if (flow.direction !== "down" || flow.basis !== "observed") continue;

    const downstream = downstreamOf(flow.node.id);
    /* Only worth saying while the downstream nodes still look fine. */
    const notYetFelt = downstream.filter((node) => {
      const read = flows.find((row) => row.node.id === node.id);
      return !read || read.direction !== "down";
    });
    if (downstream.length === 0 || notYetFelt.length === 0) continue;

    warnings.push({
      nodeId: flow.node.id,
      downstreamIds: notYetFelt.map((node) => node.id),
      expectedByDays: flow.node.lagDays,
      statement: `${flow.node.label} fell to ${flow.recent ?? 0} from ${flow.prior ?? 0}. ${notYetFelt
        .map((node) => node.label)
        .join(", ")} ${notYetFelt.length === 1 ? "has" : "have"} not felt it yet.`,
      because: `${flow.node.meaning} An effect here usually shows downstream within about ${flow.node.lagDays} days.`,
      evidence: flow.evidence,
    });
  }

  return {
    organizationId: snapshot.organizationId,
    flows,
    warnings,
    windowDays,
    generatedAt: snapshot.now,
  };
}

/** The first node on the main path that is falling. The bottleneck, honestly. */
export function bottleneck(read: FactoryRead): FactoryFlowRead | undefined {
  return read.flows.find(
    (flow) => flow.node.role === "stage" && flow.basis === "observed" && flow.direction === "down",
  );
}
