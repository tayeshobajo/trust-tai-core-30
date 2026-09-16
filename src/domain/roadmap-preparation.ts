/**
 * Preparing a roadmap, and freezing the version a proposal can rest on.
 *
 * Roadmap owns the strategy: where the client is now, where they want to get
 * to, the phases in between, the options and what each depends on. AI prepares
 * that reading. A person decides the destination and the order of work.
 *
 * Three rules hold it honest:
 *
 * 1. Anything we worked out ourselves stays provisional. Schedules, capacity
 *    and budget are provisional until a person decides them.
 * 2. A version is frozen. Editing a roadmap makes a new version; it never
 *    rewrites the one a proposal was built from.
 * 3. What is not known is named, never filled in.
 */

import type { ID, ISODateTime } from "./entities";

export type PreparedTier = "observed" | "inferred" | "decided";

export interface PreparedEvidence {
  sourceId: string;
  label: string;
  observedAt: ISODateTime;
}

export interface PreparedNote {
  statement: string;
  tier: PreparedTier;
  evidence: PreparedEvidence[];
}

export interface PhaseOption {
  id: string;
  label: string;
  because: string;
  /** Ids of phases or options this one needs first. */
  dependsOn: string[];
}

export interface PreparedPhase {
  id: string;
  position: number;
  title: string;
  intent: string;
  options: PhaseOption[];
  dependsOn: string[];
  evidence: PreparedEvidence[];
  /** Only ever set from a decision, never from a guess. */
  scheduledFrom?: ISODateTime;
  scheduledTo?: ISODateTime;
}

export interface PreparedRoadmap {
  organizationId: ID;
  clientRef: string;
  /** Point A: what is actually true now. */
  pointA: PreparedNote[];
  /** Point B: where they want to be. Inferred until a person approves it. */
  destination: PreparedNote | null;
  phases: PreparedPhase[];
  firstMove: PreparedNote | null;
  unknowns: string[];
  approvedDestinationBy?: ID;
  approvedDestinationAt?: ISODateTime;
  /** Phase ids in the order a person decided, when they have decided one. */
  approvedOrder?: string[];
  approvedOrderBy?: ID;
}

/* ----------------------------------------------------------- provisional */

export type ProvisionalKind = "schedule" | "capacity" | "budget";

export interface ProvisionalItem {
  kind: ProvisionalKind;
  statement: string;
  /** True only when a person decided it. Otherwise it stays a working figure. */
  decided: boolean;
  decidedBy?: ID;
}

/** Everything still provisional, said plainly so nobody plans against it. */
export function provisionalItems(items: ProvisionalItem[]): ProvisionalItem[] {
  return items.filter((item) => !item.decided || !item.decidedBy);
}

export function provisionalNote(items: ProvisionalItem[]): string | null {
  const open = provisionalItems(items);
  if (open.length === 0) return null;
  const kinds = [...new Set(open.map((item) => item.kind))];
  return `Provisional until someone decides: ${kinds.join(", ")}.`;
}

/* --------------------------------------------------------------- approval */

export type ApprovalOutcome =
  | { approved: true; roadmap: PreparedRoadmap }
  | { approved: false; because: string };

/** A named person approves the destination. It becomes decided, not inferred. */
export function approveDestination(input: {
  roadmap: PreparedRoadmap;
  by: ID;
  at: ISODateTime;
}): ApprovalOutcome {
  if (!input.roadmap.destination) {
    return { approved: false, because: "There is no destination to approve yet." };
  }
  if (!input.by.trim()) return { approved: false, because: "Say who is approving this." };
  return {
    approved: true,
    roadmap: {
      ...input.roadmap,
      destination: { ...input.roadmap.destination, tier: "decided" },
      approvedDestinationBy: input.by,
      approvedDestinationAt: input.at,
    },
  };
}

/** A named person sets the order of the phases. Unknown phases are refused. */
export function approvePriorities(input: {
  roadmap: PreparedRoadmap;
  order: string[];
  by: ID;
}): ApprovalOutcome {
  const known = new Set(input.roadmap.phases.map((phase) => phase.id));
  const unknown = input.order.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return { approved: false, because: `These are not phases on this roadmap: ${unknown.join(", ")}` };
  }
  if (input.order.length !== input.roadmap.phases.length) {
    return { approved: false, because: "Put every phase in the order, or none of them." };
  }
  return {
    approved: true,
    roadmap: { ...input.roadmap, approvedOrder: [...input.order], approvedOrderBy: input.by },
  };
}

/* ---------------------------------------------------------------- version */

export interface RoadmapVersion {
  versionId: string;
  organizationId: ID;
  clientRef: string;
  /** A frozen copy. Later edits make a new version, never change this one. */
  roadmap: PreparedRoadmap;
  /** Same content always produces the same stamp, so copies can be compared. */
  stamp: string;
  frozenAt: ISODateTime;
  frozenBy: ID;
}

/** A stable text of exactly what the proposal will rest on. */
export function roadmapStamp(roadmap: PreparedRoadmap): string {
  const parts = [
    `destination:${roadmap.destination?.statement ?? "none"}|${roadmap.destination?.tier ?? "none"}`,
    `approvedBy:${roadmap.approvedDestinationBy ?? "none"}`,
    `order:${(roadmap.approvedOrder ?? roadmap.phases.map((phase) => phase.id)).join(">")}`,
    ...roadmap.phases
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(
        (phase) =>
          `phase:${phase.id}:${phase.title}:${phase.intent}:deps=${[...phase.dependsOn].sort().join("+")}:opts=${phase.options
            .map((option) => option.id)
            .sort()
            .join("+")}:from=${phase.scheduledFrom ?? "none"}:to=${phase.scheduledTo ?? "none"}`,
      ),
    ...roadmap.pointA.map((note) => `a:${note.tier}:${note.statement}`),
    `first:${roadmap.firstMove?.statement ?? "none"}`,
    `unknowns:${[...roadmap.unknowns].sort().join("|")}`,
  ];
  return parts.join("\n");
}

export type FreezeOutcome =
  | { frozen: true; version: RoadmapVersion }
  | { frozen: false; because: string };

/** Freeze an approved roadmap so a proposal can be derived from exactly it. */
export function freezeRoadmapVersion(input: {
  roadmap: PreparedRoadmap;
  by: ID;
  at: ISODateTime;
  /** Versions already frozen for this client, newest last. */
  existing?: RoadmapVersion[];
}): FreezeOutcome {
  const { roadmap } = input;
  if (!roadmap.destination || roadmap.destination.tier !== "decided" || !roadmap.approvedDestinationBy) {
    return { frozen: false, because: "Nobody has approved the destination yet." };
  }
  const stamp = roadmapStamp(roadmap);
  const existing = input.existing ?? [];
  const same = existing.find((version) => version.stamp === stamp);
  if (same) return { frozen: true, version: same };

  const version: RoadmapVersion = {
    versionId: `${roadmap.organizationId}::roadmap::${roadmap.clientRef}::v${existing.length + 1}`,
    organizationId: roadmap.organizationId,
    clientRef: roadmap.clientRef,
    roadmap: structuredClone(roadmap),
    stamp,
    frozenAt: input.at,
    frozenBy: input.by,
  };
  return { frozen: true, version };
}

/* ----------------------------------------------------------- what changed */

export interface RoadmapChange {
  what: string;
  from: string;
  to: string;
}

/** A plain list of what moved between two frozen versions. */
export function roadmapChanges(before: RoadmapVersion, after: RoadmapVersion): RoadmapChange[] {
  const changes: RoadmapChange[] = [];
  const a = before.roadmap;
  const b = after.roadmap;

  if ((a.destination?.statement ?? "") !== (b.destination?.statement ?? "")) {
    changes.push({
      what: "Destination",
      from: a.destination?.statement ?? "none",
      to: b.destination?.statement ?? "none",
    });
  }
  const orderA = (a.approvedOrder ?? a.phases.map((phase) => phase.id)).join(" > ");
  const orderB = (b.approvedOrder ?? b.phases.map((phase) => phase.id)).join(" > ");
  if (orderA !== orderB) changes.push({ what: "Order of work", from: orderA, to: orderB });

  const byId = new Map(a.phases.map((phase) => [phase.id, phase]));
  for (const phase of b.phases) {
    const previous = byId.get(phase.id);
    if (!previous) {
      changes.push({ what: `Phase ${phase.title}`, from: "not on the roadmap", to: "added" });
      continue;
    }
    if (previous.title !== phase.title) {
      changes.push({ what: "Phase name", from: previous.title, to: phase.title });
    }
    if (previous.intent !== phase.intent) {
      changes.push({ what: `Phase ${phase.title}`, from: previous.intent, to: phase.intent });
    }
  }
  for (const phase of a.phases) {
    if (!b.phases.some((entry) => entry.id === phase.id)) {
      changes.push({ what: `Phase ${phase.title}`, from: "on the roadmap", to: "removed" });
    }
  }
  return changes;
}
