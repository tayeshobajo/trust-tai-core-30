/**
 * Roadmap index read models.
 *
 * Deterministic projection only: everything here is derived from roadmaps,
 * their stages, and their open decisions. Nothing is invented, and an inferred
 * destination is never presented as decided truth.
 */

import type { ProspectCandidate } from "@/domain/scout";
import type {
  Roadmap,
  RoadmapDecision,
  RoadmapStage,
  Tier,
} from "@/domain/roadmap";
import { UNKNOWN_STATEMENT } from "@/domain/roadmap";

/** The small, user-facing state model. Internal statuses map into it. */
export type RoadmapDisplayState = "draft" | "active" | "needs_decision" | "paused" | "complete";

export const ROADMAP_DISPLAY_LABEL: Record<RoadmapDisplayState, string> = {
  draft: "Draft",
  active: "Active",
  needs_decision: "Needs decision",
  paused: "Paused",
  complete: "Complete",
};

export type MilestoneMark = {
  id: string;
  ordinal: string;
  title: string;
  state: "done" | "current" | "future" | "blocked";
};

export interface RoadmapIdentity {
  websiteUrl?: string;
  logoUrl?: string | null;
  themeColor?: string | null;
}

export interface RoadmapRowModel {
  roadmapId: string;
  company: string;
  identity: RoadmapIdentity;
  state: RoadmapDisplayState;
  builtFromScout: boolean;
  pointA: string;
  pointATier: Tier;
  pointB: string;
  pointBTier: "inferred" | "decided" | null;
  milestones: MilestoneMark[];
  current: MilestoneMark | null;
  next: MilestoneMark | null;
  openDecisions: RoadmapDecision[];
  ownerLabel: string;
  updatedAt: string;
}

function ordinal(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function displayState(roadmap: Roadmap, openDecisions: number): RoadmapDisplayState {
  if (roadmap.status === "complete" || roadmap.status === "archived") return "complete";
  if (openDecisions > 0) return "needs_decision";
  if (roadmap.status === "draft" || roadmap.status === "proposed") return "draft";
  return "active";
}

function markStages(stages: RoadmapStage[]): MilestoneMark[] {
  return stages.map((stage, index) => ({
    id: stage.id,
    ordinal: ordinal(index),
    title: stage.title || "Untitled milestone",
    state:
      stage.state === "live"
        ? ("done" as const)
        : stage.state === "in_build"
          ? ("current" as const)
          : stage.state === "blocked"
            ? ("blocked" as const)
            : ("future" as const),
  }));
}

export function buildRoadmapRow(
  roadmap: Roadmap,
  stages: RoadmapStage[],
  decisions: RoadmapDecision[],
  identity: RoadmapIdentity = {},
): RoadmapRowModel {
  const open = decisions.filter((decision) => decision.roadmapId === roadmap.id);
  const milestones = markStages(stages);
  const current =
    milestones.find((m) => m.state === "current") ?? milestones.find((m) => m.state === "blocked") ?? null;
  const next = current ? null : (milestones.find((m) => m.state === "future") ?? null);
  const firstA = roadmap.pointA[0];

  return {
    roadmapId: roadmap.id,
    company: roadmap.subjectLabel || roadmap.title,
    identity,
    state: displayState(roadmap, open.length),
    builtFromScout: Boolean(roadmap.prospectId),
    pointA: firstA?.value ?? UNKNOWN_STATEMENT,
    pointATier: firstA?.tier ?? "observed",
    pointB: roadmap.pointB?.statement ?? UNKNOWN_STATEMENT,
    pointBTier: roadmap.pointB?.tier ?? null,
    milestones,
    current,
    next,
    openDecisions: open,
    ownerLabel: roadmap.nextMove?.ownerLabel ?? "Unassigned",
    updatedAt: roadmap.updatedAt,
  };
}

export function buildRoadmapRows(
  roadmaps: Roadmap[],
  stagesByRoadmap: Record<string, RoadmapStage[]>,
  decisions: RoadmapDecision[],
  identities: Record<string, RoadmapIdentity> = {},
): RoadmapRowModel[] {
  return roadmaps.map((roadmap) =>
    buildRoadmapRow(
      roadmap,
      stagesByRoadmap[roadmap.id] ?? [],
      decisions,
      (roadmap.prospectId ? identities[roadmap.prospectId] : undefined) ?? {},
    ),
  );
}

export interface RoadmapGlance {
  activeRoadmaps: number;
  needsDecision: number;
  milestonesInMotion: number;
}

export function roadmapGlance(rows: RoadmapRowModel[]): RoadmapGlance {
  return {
    activeRoadmaps: rows.filter((row) => row.state !== "complete").length,
    needsDecision: rows.filter((row) => row.openDecisions.length > 0).length,
    milestonesInMotion: rows.reduce(
      (total, row) => total + row.milestones.filter((m) => m.state === "current").length,
      0,
    ),
  };
}

export type RoadmapFilter = "all" | "needs_decision" | "draft" | "active" | "complete";

export const ROADMAP_FILTERS: { id: RoadmapFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_decision", label: "Needs decision" },
  { id: "draft", label: "Draft" },
  { id: "active", label: "Active" },
  { id: "complete", label: "Complete" },
];

export function filterRoadmapRows(
  rows: RoadmapRowModel[],
  query: string,
  filter: RoadmapFilter,
): RoadmapRowModel[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter !== "all" && row.state !== filter) return false;
    if (!needle) return true;
    return (
      row.company.toLowerCase().includes(needle) ||
      row.pointB.toLowerCase().includes(needle) ||
      row.milestones.some((m) => m.title.toLowerCase().includes(needle))
    );
  });
}

/**
 * Qualified Scout companies that do not already have a roadmap.
 * One company, one roadmap: anything already sequenced is excluded.
 */
export function readyFromScout(
  candidates: ProspectCandidate[],
  roadmaps: Roadmap[],
): ProspectCandidate[] {
  const taken = new Set(roadmaps.map((r) => r.prospectId).filter(Boolean) as string[]);
  return candidates
    .filter(
      (candidate) =>
        (candidate.prospect.status === "qualified" ||
          candidate.prospect.status === "ready_for_comms") &&
        !taken.has(candidate.prospect.id),
    )
    .sort((a, b) => b.evaluation.score - a.evaluation.score);
}

/** "2d ago" / "just now" — quiet metadata, never the point of the row. */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * One company, one roadmap. Returns the roadmap that already sequences this
 * subject, so the create action can refuse a duplicate before it is written.
 */
export function existingRoadmapForSubject(
  roadmaps: Roadmap[],
  subject: { kind: string; id: string },
): Roadmap | null {
  return (
    roadmaps.find((roadmap) => {
      if (subject.kind === "prospect") return roadmap.prospectId === subject.id;
      if (subject.kind === "client") return roadmap.clientId === subject.id;
      if (subject.kind === "relationship") return roadmap.relationshipId === subject.id;
      return false;
    }) ?? null
  );
}
