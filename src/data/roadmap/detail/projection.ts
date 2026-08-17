/**
 * Roadmap detail — deterministic read models.
 *
 * Pure functions only. The inner page never decides anything here: it reads
 * roadmap truth (milestones, decisions, execution links, exports) and projects
 * it into the smallest shape the screen needs, in the same order every time.
 *
 * Two rules hold throughout:
 *  1. Approved work and proposals are never shown as the same thing.
 *  2. Where the evidence is thin, the model says so rather than guessing.
 */

import type { RoadmapDecision, Roadmap } from "@/domain/roadmap";
import { UNKNOWN_STATEMENT } from "@/domain/roadmap";
import type { RoadmapMilestone, RoadmapStrategy } from "@/domain/roadmap-intel";
import type { ExportSnapshot, RoadmapExecutionLink, RoadmapExport } from "@/domain/roadmap-exports";

/* -------------------------------------------------------------- milestones */

/** Where a milestone stands, once approval and execution are read together. */
export type PathState = "complete" | "in_progress" | "ready" | "proposed" | "blocked";

export const PATH_STATE_LABEL: Record<PathState, string> = {
  complete: "Complete",
  in_progress: "In progress",
  ready: "Ready to start",
  proposed: "Proposed",
  blocked: "Blocked",
};

export interface PathMilestone {
  id: string;
  ordinal: string;
  name: string;
  whatWeBuild: string;
  unlocks: string;
  state: PathState;
  /** True only for approved and Decided work. */
  decided: boolean;
  ownerLabel: string;
  evidenceCount: number;
  dependencies: string[];
  executionBoundary: string;
  link: RoadmapExecutionLink | null;
  openDecision: RoadmapDecision | null;
  milestone: RoadmapMilestone;
}

function ordinal(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/** Sequence is the recommendation; ties fall back to priority, then name. */
export function sequenceMilestones(milestones: RoadmapMilestone[]): RoadmapMilestone[] {
  return [...milestones].sort(
    (a, b) =>
      a.recommendedSequence - b.recommendedSequence ||
      b.priorityScore - a.priorityScore ||
      a.name.localeCompare(b.name),
  );
}

function stateOf(
  milestone: RoadmapMilestone,
  link: RoadmapExecutionLink | null,
  openDecision: RoadmapDecision | null,
): PathState {
  if (link?.status === "complete") return "complete";
  if (link && (link.status === "accepted" || link.status === "in_progress")) return "in_progress";
  if (openDecision) return "blocked";
  if (milestone.status === "approved" && milestone.tier === "decided") return "ready";
  return "proposed";
}

/**
 * The milestone path, in sequence. Rejected candidates are left out: they are
 * history, not a step on the way.
 */
export function buildMilestonePath(
  milestones: RoadmapMilestone[],
  links: RoadmapExecutionLink[],
  decisions: RoadmapDecision[],
): PathMilestone[] {
  const linkByMilestone = new Map(
    links
      .filter((entry) => entry.status !== "withdrawn")
      .map((entry) => [entry.milestoneId, entry]),
  );
  const open = decisions.filter((decision) => decision.status === "open");

  return sequenceMilestones(milestones.filter((m) => m.status !== "rejected")).map(
    (milestone, index) => {
      const link = linkByMilestone.get(milestone.id) ?? null;
      const openDecision = open.find((decision) => decision.stageId === milestone.id) ?? null;
      return {
        id: milestone.id,
        ordinal: ordinal(index),
        name: milestone.name || "Untitled milestone",
        whatWeBuild: milestone.whatWeBuild || UNKNOWN_STATEMENT,
        unlocks: milestone.immediateValue || milestone.longTermValue || UNKNOWN_STATEMENT,
        state: stateOf(milestone, link, openDecision),
        decided: milestone.status === "approved" && milestone.tier === "decided",
        ownerLabel: milestone.ownerLabel ?? "Unassigned",
        evidenceCount: milestone.evidence.filter((ref) => ref.url.trim().length > 0).length,
        dependencies: milestone.dependencies.filter((entry) => entry.trim().length > 0),
        executionBoundary: milestone.executionBoundary,
        link,
        openDecision,
        milestone,
      };
    },
  );
}

/** The one milestone the room is actually on, if any. */
export function currentMilestone(path: PathMilestone[]): PathMilestone | null {
  return (
    path.find((entry) => entry.state === "in_progress") ??
    path.find((entry) => entry.state === "blocked") ??
    path.find((entry) => entry.state === "ready") ??
    null
  );
}

export interface PathProgress {
  total: number;
  complete: number;
  inProgress: number;
  decided: number;
  percent: number;
}

export function pathProgress(path: PathMilestone[]): PathProgress {
  const complete = path.filter((entry) => entry.state === "complete").length;
  return {
    total: path.length,
    complete,
    inProgress: path.filter((entry) => entry.state === "in_progress").length,
    decided: path.filter((entry) => entry.decided).length,
    percent: path.length === 0 ? 0 : Math.round((complete / path.length) * 100),
  };
}

/* ---------------------------------------------------------- next attention */

export interface NextAttention {
  headline: string;
  because: string;
  /** Where the person should go, in the room that owns it. */
  action: string;
  kind: "decision" | "destination" | "owner" | "start" | "settled";
}

/**
 * What deserves attention next, in one deterministic order:
 * an open decision, then an unapproved destination, then unowned live work,
 * then the next thing that could start.
 */
export function nextAttention(
  roadmap: Roadmap,
  path: PathMilestone[],
  decisions: RoadmapDecision[],
): NextAttention {
  const open = decisions.filter((decision) => decision.status === "open");
  const first = open[0];
  if (first) {
    return {
      kind: "decision",
      headline: first.question,
      because: first.whyItMatters || "This is blocking the sequence until someone decides.",
      action: "Resolve it in Decisions",
    };
  }

  if (!roadmap.pointB) {
    return {
      kind: "destination",
      headline: "Point B is not written yet",
      because: "Nothing downstream can be sequenced against a destination that does not exist.",
      action: "Write and approve Point B",
    };
  }
  if (roadmap.pointB.tier !== "decided") {
    return {
      kind: "destination",
      headline: "Point B is still a proposal",
      because: "Milestones stay proposals until the destination is approved by a person.",
      action: "Approve Point B",
    };
  }

  const unowned = path.find(
    (entry) => entry.state === "in_progress" && entry.ownerLabel === "Unassigned",
  );
  if (unowned) {
    return {
      kind: "owner",
      headline: `${unowned.name} has no owner`,
      because: "Work in motion without a named owner is how a roadmap quietly stalls.",
      action: "Name who carries it",
    };
  }

  const ready = path.find((entry) => entry.state === "ready");
  if (ready) {
    return {
      kind: "start",
      headline: `${ready.name} is ready to start`,
      because: "It is approved, unblocked, and next in the sequence.",
      action: "Hand it to Projects",
    };
  }

  return {
    kind: "settled",
    headline: "Nothing needs your judgment here",
    because: "Every decision is resolved and no approved milestone is waiting to start.",
    action: "Check back when execution reports movement",
  };
}

/* --------------------------------------------------------------- anchoring */

export interface AnchorProofLine {
  statement: string;
  because: string;
  sources: number;
  approved: boolean;
}

/** The few things this company is already provably good at. Approved first. */
export function anchorProof(strategy: RoadmapStrategy | null): AnchorProofLine[] {
  if (!strategy) return [];
  return [...strategy.anchorProof]
    .sort((a, b) => Number(b.approval === "approved") - Number(a.approval === "approved"))
    .slice(0, 3)
    .map((item) => ({
      statement: item.statement,
      because: item.because,
      sources: item.sources.filter((ref) => ref.url.trim().length > 0).length,
      approved: item.approval === "approved",
    }));
}

/* ----------------------------------------------------------------- exports */

export interface ExportFreshness {
  latest: RoadmapExport | null;
  /** True when roadmap truth moved after the last client copy was frozen. */
  behind: boolean;
  summary: string;
}

export function exportFreshness(roadmap: Roadmap, exports: RoadmapExport[]): ExportFreshness {
  const latest = exports[0] ?? null;
  if (!latest) {
    return { latest: null, behind: false, summary: "No client copy has been created yet." };
  }
  const behind = Date.parse(roadmap.updatedAt) > Date.parse(latest.createdAt);
  return {
    latest,
    behind,
    summary: behind
      ? `Version ${latest.version} is behind the current roadmap.`
      : `Version ${latest.version} matches the current roadmap.`,
  };
}

/**
 * The client-facing snapshot. Only approved milestones travel, and a proposed
 * destination is carried as a proposal rather than quietly promoted.
 */
export function buildExportSnapshot(
  roadmap: Roadmap,
  path: PathMilestone[],
  options: { note?: string; websiteUrl?: string; now?: Date } = {},
): ExportSnapshot {
  const now = options.now ?? new Date();
  return {
    company: roadmap.subjectLabel || roadmap.title,
    ...(options.websiteUrl ? { websiteUrl: options.websiteUrl } : {}),
    pointA: roadmap.pointA.map((note) => note.value).filter((value) => value.trim().length > 0),
    pointB: roadmap.pointB?.statement ?? UNKNOWN_STATEMENT,
    pointBProposed: roadmap.pointB?.tier !== "decided",
    milestones: path
      .filter((entry) => entry.decided)
      .map((entry) => ({
        ordinal: entry.ordinal,
        name: entry.name,
        whatWeBuild: entry.whatWeBuild,
        whatItUnlocks: entry.unlocks,
        status: PATH_STATE_LABEL[entry.state],
      })),
    evidence: path
      .flatMap((entry) => entry.milestone.evidence)
      .filter((ref) => ref.url.trim().length > 0)
      .slice(0, 12)
      .map((ref) => ({
        label: ref.label || ref.url,
        url: ref.url,
        ...(ref.checkedAt ? { observedAt: ref.checkedAt } : {}),
      })),
    ...(options.note && options.note.trim() ? { noteFromTai: options.note.trim() } : {}),
    generatedAt: now.toISOString(),
  };
}
