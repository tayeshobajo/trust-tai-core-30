/**
 * Pure read models for one delivery room.
 *
 * Everything here is derived from what people recorded: the work list, the
 * blocker register, the decisions and the project itself. Nothing invents a
 * score, and every derived sentence can say why it says what it says.
 */

import {
  WORK_ITEM_STATUS_LABEL,
  type ProjectBlocker,
  type ProjectDecision,
  type WorkItem,
} from "@/domain/project-delivery";
import { isOpenProject, type ExecutionProject } from "@/domain/projects";

import { SURFACE_STATUS_LABEL, daysSince, daysUntil, surfaceStatus } from "./index-projection";

/* ----------------------------------------------------------------- work */

const IN_ORDER = (a: WorkItem, b: WorkItem) =>
  a.sequence - b.sequence || a.createdAt.localeCompare(b.createdAt);

export function sortWorkItems(items: WorkItem[]): WorkItem[] {
  return [...items].sort(IN_ORDER);
}

/** The single thing being worked on right now, or nothing when work is idle. */
export function currentWorkItem(items: WorkItem[]): WorkItem | null {
  return sortWorkItems(items).find((item) => item.status === "in_progress") ?? null;
}

/** The next item a person already marked Ready, in the order they sequenced it. */
export function upNextItem(items: WorkItem[]): WorkItem | null {
  return sortWorkItems(items).find((item) => item.status === "ready") ?? null;
}

export interface WorkProgress {
  complete: number;
  total: number;
  percent: number;
  /** "4 of 7 items complete", or an honest empty line. */
  line: string;
}

export function workProgress(items: WorkItem[]): WorkProgress {
  const total = items.length;
  const complete = items.filter((item) => item.status === "complete").length;
  if (total === 0) {
    return { complete: 0, total: 0, percent: 0, line: "No work items recorded yet." };
  }
  return {
    complete,
    total,
    percent: Math.round((complete / total) * 100),
    line: `${complete} of ${total} item${total === 1 ? "" : "s"} complete`,
  };
}

/* -------------------------------------------------------------- blockers */

export function openBlockers(blockers: ProjectBlocker[]): ProjectBlocker[] {
  return blockers
    .filter((blocker) => blocker.status === "open")
    .sort((a, b) => a.raisedAt.localeCompare(b.raisedAt));
}

export function blockerAgeDays(blocker: ProjectBlocker, now: Date = new Date()): number {
  return daysSince(blocker.raisedAt, now) ?? 0;
}

/* ----------------------------------------------------- where this stands */

export interface StandsModel {
  status: string;
  currentStage: string;
  progress: WorkProgress;
  because: string;
}

/**
 * One sentence about the state, derived only from the record: a live blocker,
 * an agreed date that has passed, work with nobody on it, or normal movement.
 */
export function standsLine(
  project: ExecutionProject,
  items: WorkItem[],
  blockers: ProjectBlocker[],
  now: Date = new Date(),
): string {
  if (!isOpenProject(project)) {
    return "This work is finished. What it changed is recorded below.";
  }
  const open = openBlockers(blockers);
  const first = open[0];
  if (first) {
    const days = blockerAgeDays(first, now);
    return `Delivery is stopped: ${first.reason} Blocked for ${days} day${days === 1 ? "" : "s"}.`;
  }
  const due = daysUntil(project.dueDate, now);
  if (due !== null && due < 0) {
    return `The agreed date passed ${Math.abs(due)} day${Math.abs(due) === 1 ? "" : "s"} ago and the work is still open.`;
  }
  if (!currentWorkItem(items)) {
    return items.length === 0
      ? "No work has been recorded yet, so there is nothing moving."
      : "Nothing is in progress right now. Start the next item when you are ready.";
  }
  return "Work is moving normally. No active blocker is preventing delivery.";
}

export function standsModel(
  project: ExecutionProject,
  items: WorkItem[],
  blockers: ProjectBlocker[],
  now: Date = new Date(),
): StandsModel {
  const current = currentWorkItem(items);
  return {
    status: SURFACE_STATUS_LABEL[surfaceStatus(project)],
    currentStage: current?.title ?? project.currentWork?.trim() ?? "Nothing in progress",
    progress: workProgress(items),
    because: standsLine(project, items, blockers, now),
  };
}

/* ---------------------------------------------------------------- health */

/** The signals behind the health word. No arbitrary score, only what is true. */
export function healthSignals(
  project: ExecutionProject,
  items: WorkItem[],
  blockers: ProjectBlocker[],
  now: Date = new Date(),
): string[] {
  const signals: string[] = [];
  const progress = workProgress(items);
  signals.push(progress.total > 0 ? progress.line : "No work items recorded");

  const open = openBlockers(blockers);
  signals.push(
    open.length === 0
      ? "No active blockers"
      : `${open.length} open blocker${open.length === 1 ? "" : "s"}`,
  );

  const nextDue = sortWorkItems(items)
    .filter((item) => item.status !== "complete" && item.dueDate)
    .map((item) => daysUntil(item.dueDate, now))
    .filter((days): days is number => days !== null)
    .sort((a, b) => a - b)[0];
  if (nextDue !== undefined) {
    signals.push(
      nextDue < 0
        ? `Next item overdue by ${Math.abs(nextDue)} day${Math.abs(nextDue) === 1 ? "" : "s"}`
        : `Next due item in ${nextDue} day${nextDue === 1 ? "" : "s"}`,
    );
  }

  const owned = Boolean(project.ownerUserId || project.ownerLabel?.trim());
  signals.push(
    owned ? `Carried by ${project.ownerLabel ?? "a named owner"}` : "Nobody carries this yet",
  );
  return signals;
}

/* ------------------------------------------------------- needs attention */

export interface AttentionItem {
  title: string;
  because: string;
  /** Where the judgment is asked for, so the rail can send you there. */
  tab: "work" | "blockers" | "decisions" | "overview";
}

/** Only what genuinely asks for a person's judgment, most urgent first. */
export function needsJudgment(
  project: ExecutionProject,
  items: WorkItem[],
  blockers: ProjectBlocker[],
  decisions: ProjectDecision[],
  now: Date = new Date(),
): AttentionItem[] {
  const out: AttentionItem[] = [];

  for (const decision of decisions.filter((entry) => entry.status === "open")) {
    out.push({
      title: decision.question,
      because: decision.whyItMatters?.trim() || "A delivery decision is waiting on an answer.",
      tab: "decisions",
    });
  }

  for (const blocker of openBlockers(blockers)) {
    const days = blockerAgeDays(blocker, now);
    out.push({
      title: blocker.reason,
      because: `Open for ${days} day${days === 1 ? "" : "s"}. ${blocker.nextMove?.trim() || "No next move recorded."}`,
      tab: "blockers",
    });
  }

  for (const item of sortWorkItems(items).filter((entry) => entry.status === "in_review")) {
    out.push({
      title: item.title,
      because: "Waiting on your review before it can be called complete.",
      tab: "work",
    });
  }

  if (isOpenProject(project) && !project.ownerLabel?.trim() && !project.ownerUserId) {
    out.push({
      title: "Nobody carries this project",
      because: "Delivery cannot move until someone owns it.",
      tab: "overview",
    });
  }

  return out;
}

/* ------------------------------------------------------------ completion */

export interface CompletionModel {
  outcome: string;
  changed: string[];
  /** What Roadmap should be told, phrased as a human's next move. */
  roadmapSignal: string | null;
  /** Work that keeps going after delivery, if a person recorded any. */
  ongoing: string[];
}

export function completionModel(
  project: ExecutionProject,
  items: WorkItem[],
  milestoneLabel?: string,
): CompletionModel {
  const changed = sortWorkItems(items)
    .filter((item) => item.status === "complete")
    .map((item) => item.title);
  return {
    outcome: project.pointB.trim() || "No outcome was agreed for this work.",
    changed,
    roadmapSignal:
      project.origin.kind === "roadmap_milestone"
        ? `${milestoneLabel ?? "This milestone"} is ready to be marked complete in Roadmap.`
        : null,
    ongoing: (project.deliveryItems ?? []).filter((item) => !item.done).map((item) => item.label),
  };
}

/* ---------------------------------------------------------------- people */

export interface PersonOnProject {
  label: string;
  role: string;
}

/** The people actually on the record for this work. Not a directory. */
export function peopleOnProject(project: ExecutionProject, items: WorkItem[]): PersonOnProject[] {
  const people: PersonOnProject[] = [];
  const owner = project.ownerLabel?.trim();
  if (owner) people.push({ label: owner, role: "Project owner" });

  const seen = new Set(people.map((person) => person.label.toLowerCase()));
  for (const item of sortWorkItems(items)) {
    const label = item.ownerLabel?.trim();
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    people.push({ label, role: "Contributor" });
  }
  return people;
}

export { WORK_ITEM_STATUS_LABEL };
