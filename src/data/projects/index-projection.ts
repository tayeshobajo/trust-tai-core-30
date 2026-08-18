/**
 * Projects index — deterministic read models.
 *
 * Pure functions only. The page never decides anything here: it reads delivery
 * truth (projects, their origin, their recorded delivery detail) and projects
 * it into the smallest shape the screen needs, in the same order every time.
 *
 * Two rules hold throughout:
 *  1. Lineage is never lost. Every row can say which company, roadmap and
 *     milestone it came from, or say plainly that it was started here.
 *  2. Health explains itself in one sentence a person can argue with.
 */

import {
  HEALTH_LABEL,
  isOpenProject,
  projectHealth,
  type ExecutionProject,
  type ExecutionState,
  type ProjectHealth,
} from "@/domain/projects";

/* ----------------------------------------------------------------- status */

/** The status language the room speaks. Internal execution states map into it. */
export type SurfaceStatus =
  | "ready"
  | "in_progress"
  | "blocked"
  | "waiting"
  | "in_review"
  | "complete";

export const SURFACE_STATUS_LABEL: Record<SurfaceStatus, string> = {
  ready: "Ready",
  in_progress: "In progress",
  blocked: "Blocked",
  waiting: "Waiting",
  in_review: "In review",
  complete: "Complete",
};

/** Tone classes, by intent: blue moving, green landed, orange waiting, red blocked. */
export const SURFACE_STATUS_TONE: Record<SurfaceStatus, string> = {
  ready: "border-border bg-secondary text-muted-foreground",
  in_progress: "border-royal/25 bg-royal/8 text-royal",
  blocked: "border-destructive/25 bg-destructive/8 text-destructive",
  waiting: "border-warning/30 bg-warning/10 text-warning",
  in_review: "border-warning/30 bg-warning/10 text-warning",
  complete: "border-success/25 bg-success/10 text-success",
};

const STATE_TO_SURFACE: Record<ExecutionState, SurfaceStatus> = {
  not_started: "ready",
  in_flight: "in_progress",
  in_review: "in_review",
  blocked: "blocked",
  delivered: "complete",
  closed: "complete",
};

/**
 * Waiting is not a stored state: it is an in-flight project that cannot move
 * because nobody carries it or there is no next move on record.
 */
export function surfaceStatus(project: ExecutionProject): SurfaceStatus {
  const base = STATE_TO_SURFACE[project.state];
  if (base !== "in_progress") return base;
  if (project.waitingOn?.trim()) return "waiting";
  const owned = Boolean(project.ownerUserId || project.ownerLabel?.trim());
  if (!owned || !project.nextMove?.trim()) return "waiting";
  return "in_progress";
}

/* -------------------------------------------------------------- lineage */

export interface ProjectLineage {
  /** The company this work is for, as it reads upstream. */
  company: string;
  fromRoadmap: boolean;
  roadmapId?: string;
  milestoneId?: string;
  /** "02" when the milestone's place in the sequence is known. */
  milestoneOrdinal?: string;
  milestoneName?: string;
}

export interface LineageSources {
  /** Milestone id → its ordinal and name, sequenced as the roadmap sequenced it. */
  milestones: Record<string, { ordinal: string; name: string; roadmapId: string }>;
  /** Roadmap id → the company that roadmap is for. */
  roadmapCompany: Record<string, string>;
  /** Client id → company name, for work started here against a known client. */
  clientCompany: Record<string, string>;
}

export const EMPTY_LINEAGE_SOURCES: LineageSources = {
  milestones: {},
  roadmapCompany: {},
  clientCompany: {},
};

export function lineageOf(
  project: ExecutionProject,
  sources: LineageSources = EMPTY_LINEAGE_SOURCES,
): ProjectLineage {
  const origin = project.origin;
  const milestone = origin.milestoneId ? sources.milestones[origin.milestoneId] : undefined;
  const roadmapId = origin.roadmapId ?? milestone?.roadmapId;
  const company =
    origin.subjectLabel?.trim() ||
    (roadmapId ? sources.roadmapCompany[roadmapId] : undefined) ||
    (project.clientId ? sources.clientCompany[project.clientId] : undefined) ||
    "No company attached";

  return {
    company,
    fromRoadmap: origin.kind === "roadmap_milestone",
    ...(roadmapId ? { roadmapId } : {}),
    ...(origin.milestoneId ? { milestoneId: origin.milestoneId } : {}),
    ...(milestone ? { milestoneOrdinal: milestone.ordinal, milestoneName: milestone.name } : {}),
  };
}

/* ------------------------------------------------------------- progress */

export interface DeliveryProgress {
  /** True when a person actually recorded delivery items. */
  counted: boolean;
  complete: number;
  total: number;
  /** "4 of 7 delivery items complete", or the current stage when none exist. */
  line: string;
  percent: number;
}

export function deliveryProgress(project: ExecutionProject): DeliveryProgress {
  const items = project.deliveryItems ?? [];
  if (items.length === 0) {
    return {
      counted: false,
      complete: 0,
      total: 0,
      line: `Current stage · ${SURFACE_STATUS_LABEL[surfaceStatus(project)]}`,
      percent: 0,
    };
  }
  const complete = items.filter((item) => item.done).length;
  return {
    counted: true,
    complete,
    total: items.length,
    line: `${complete} of ${items.length} delivery items complete`,
    percent: Math.round((complete / items.length) * 100),
  };
}

/* --------------------------------------------------------------- dates */

const DAY = 86_400_000;

export function daysUntil(at: string | undefined, now: Date = new Date()): number | null {
  if (!at) return null;
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return null;
  return Math.ceil((then - now.getTime()) / DAY);
}

export function daysSince(at: string | undefined, now: Date = new Date()): number | null {
  const ahead = daysUntil(at, now);
  return ahead === null ? null : -ahead;
}

export function dueLabel(at: string | undefined, now: Date = new Date()): string {
  const days = daysUntil(at, now);
  if (days === null) return "No date agreed";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due ${new Date(at as string).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}

/* ---------------------------------------------------------------- rows */

export interface ProjectRowModel {
  project: ExecutionProject;
  status: SurfaceStatus;
  health: ProjectHealth;
  healthLabel: string;
  /** One sentence a person can argue with. */
  because: string;
  lineage: ProjectLineage;
  progress: DeliveryProgress;
  ownerLabel: string;
  due: string;
  dueInDays: number | null;
  blockedForDays: number | null;
  outcome: string;
  currentWork: string | null;
  blocker: string | null;
  /** What a person said this is paused on, when they said so. */
  waitingOn: string | null;
  open: boolean;
}

/** Health, restated with the delivery detail this room actually shows. */
function explain(
  project: ExecutionProject,
  progress: DeliveryProgress,
  dueInDays: number | null,
  base: { level: ProjectHealth; because: string },
): { level: ProjectHealth; because: string } {
  if (!isOpenProject(project)) return base;
  if (base.level === "at_risk") return base;
  if (dueInDays !== null && dueInDays <= 2 && progress.counted) {
    const left = progress.total - progress.complete;
    if (left > 0) {
      return {
        level: dueInDays < 0 ? "at_risk" : "needs_attention",
        because:
          dueInDays < 0
            ? `The agreed date passed ${Math.abs(dueInDays)} day${Math.abs(dueInDays) === 1 ? "" : "s"} ago and ${left} delivery item${left === 1 ? " remains" : "s remain"}.`
            : `Due in ${dueInDays === 0 ? "0 days" : `${dueInDays} day${dueInDays === 1 ? "" : "s"}`} and ${left} delivery item${left === 1 ? " remains" : "s remain"}.`,
      };
    }
  }
  if (dueInDays !== null && dueInDays < 0) {
    return {
      level: "at_risk",
      because: `The agreed date passed ${Math.abs(dueInDays)} day${Math.abs(dueInDays) === 1 ? "" : "s"} ago.`,
    };
  }
  return base;
}

export function buildProjectRow(
  project: ExecutionProject,
  sources: LineageSources = EMPTY_LINEAGE_SOURCES,
  now: Date = new Date(),
): ProjectRowModel {
  const progress = deliveryProgress(project);
  const dueInDays = daysUntil(project.dueDate, now);
  const health = explain(project, progress, dueInDays, projectHealth(project, now));
  const blockedForDays = project.state === "blocked" ? daysSince(project.blockedSince, now) : null;

  return {
    project,
    status: surfaceStatus(project),
    health: health.level,
    healthLabel: HEALTH_LABEL[health.level],
    because: health.because,
    lineage: lineageOf(project, sources),
    progress,
    ownerLabel: project.ownerLabel?.trim() || "No one yet",
    due: dueLabel(project.dueDate, now),
    dueInDays,
    blockedForDays,
    outcome: project.pointB.trim() || "No outcome agreed yet.",
    currentWork: project.currentWork?.trim() || project.nextMove?.trim() || null,
    blocker: project.blockedBecause?.trim() || null,
    waitingOn: project.waitingOn?.trim() || null,
    open: isOpenProject(project),
  };
}

export function buildProjectRows(
  projects: ExecutionProject[],
  sources: LineageSources = EMPTY_LINEAGE_SOURCES,
  now: Date = new Date(),
): ProjectRowModel[] {
  return projects.map((project) => buildProjectRow(project, sources, now));
}

/* --------------------------------------------------------------- tabs */

export type ProjectsTab = "all" | "in_progress" | "attention" | "waiting" | "completed";

export const PROJECTS_TABS: { value: ProjectsTab; label: string }[] = [
  { value: "all", label: "All projects" },
  { value: "in_progress", label: "In progress" },
  { value: "attention", label: "Needs attention" },
  { value: "waiting", label: "Waiting" },
  { value: "completed", label: "Completed" },
];

export function inTab(row: ProjectRowModel, tab: ProjectsTab): boolean {
  switch (tab) {
    case "in_progress":
      return row.open && row.status === "in_progress";
    case "attention":
      return row.open && (row.health === "at_risk" || row.health === "needs_attention");
    case "waiting":
      return row.open && (row.status === "waiting" || row.status === "in_review");
    case "completed":
      return !row.open;
    default:
      return true;
  }
}

/* ------------------------------------------------------------ filters */

export interface ProjectFilters {
  query: string;
  company: string;
  owner: string;
  status: string;
  /** Milestone name, as the roadmap wrote it. */
  milestone: string;
  due: "all" | "overdue" | "week" | "month" | "none";
}

export const EMPTY_PROJECT_FILTERS: ProjectFilters = {
  query: "",
  company: "all",
  owner: "all",
  status: "all",
  milestone: "all",
  due: "all",
};


function matchesDue(row: ProjectRowModel, due: ProjectFilters["due"]): boolean {
  if (due === "all") return true;
  if (due === "none") return row.dueInDays === null;
  if (row.dueInDays === null) return false;
  if (due === "overdue") return row.dueInDays < 0;
  if (due === "week") return row.dueInDays >= 0 && row.dueInDays <= 7;
  return row.dueInDays >= 0 && row.dueInDays <= 31;
}

export function filterProjectRows(
  rows: ProjectRowModel[],
  filters: ProjectFilters,
): ProjectRowModel[] {
  const query = filters.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.company !== "all" && row.lineage.company !== filters.company) return false;
    if (filters.owner !== "all" && row.ownerLabel !== filters.owner) return false;
    if (filters.status !== "all" && row.status !== filters.status) return false;
    if (filters.milestone !== "all" && (row.lineage.milestoneName ?? "") !== filters.milestone) {
      return false;
    }
    if (!matchesDue(row, filters.due)) return false;
    if (!query) return true;
    const haystack = [
      row.project.name,
      row.lineage.company,
      row.lineage.milestoneName ?? "",
      row.outcome,
      row.ownerLabel,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function companyOptions(rows: ProjectRowModel[]): string[] {
  return [...new Set(rows.map((row) => row.lineage.company))].sort((a, b) => a.localeCompare(b));
}

export function ownerOptions(rows: ProjectRowModel[]): string[] {
  return [...new Set(rows.map((row) => row.ownerLabel))].sort((a, b) => a.localeCompare(b));
}

/** Only milestones that actually carried work into this room. */
export function milestoneOptions(rows: ProjectRowModel[]): string[] {
  return [
    ...new Set(
      rows
        .map((row) => row.lineage.milestoneName ?? "")
        .filter((name) => name.trim().length > 0),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

export function statusOptions(rows: ProjectRowModel[]): SurfaceStatus[] {
  const present = new Set(rows.map((row) => row.status));
  return (Object.keys(SURFACE_STATUS_LABEL) as SurfaceStatus[]).filter((status) =>
    present.has(status),
  );
}


/* --------------------------------------------------------------- rail */

export interface ProjectsGlance {
  active: number;
  attention: number;
  dueThisWeek: number;
  blocked: number;
  companies: number;
  reviews: number;
}

export function projectsGlance(rows: ProjectRowModel[]): ProjectsGlance {
  const open = rows.filter((row) => row.open);
  return {
    active: open.length,
    attention: open.filter((row) => row.health === "at_risk" || row.health === "needs_attention")
      .length,
    dueThisWeek: open.filter((row) => row.dueInDays !== null && row.dueInDays <= 7).length,
    blocked: open.filter((row) => row.status === "blocked").length,
    companies: new Set(rows.map((row) => row.lineage.company)).size,
    reviews: open.filter((row) => row.status === "in_review").length,
  };
}

/** Genuine exceptions only. Blocked first, then at risk, then reviews landing soon. */
export function needsAttention(rows: ProjectRowModel[]): ProjectRowModel[] {
  const rank = (row: ProjectRowModel): number => {
    if (row.status === "blocked") return 0;
    if (row.health === "at_risk") return 1;
    if (row.status === "in_review" && row.dueInDays !== null && row.dueInDays <= 2) return 2;
    return 99;
  };
  return rows
    .filter((row) => row.open && rank(row) < 99)
    .sort((a, b) => rank(a) - rank(b) || (a.dueInDays ?? 999) - (b.dueInDays ?? 999));
}

/** What is waiting on the person, rather than on the work. */
export function needsYou(rows: ProjectRowModel[]): ProjectRowModel[] {
  return rows
    .filter(
      (row) =>
        row.open &&
        (row.status === "in_review" ||
          !row.project.pointB.trim() ||
          row.ownerLabel === "No one yet"),
    )
    .slice(0, 4);
}

export function recentlyCompleted(rows: ProjectRowModel[]): ProjectRowModel[] {
  return rows
    .filter((row) => !row.open)
    .sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt))
    .slice(0, 4);
}

/* ----------------------------------------------------------- companies */

export interface CompanyGroup {
  company: string;
  rows: ProjectRowModel[];
  active: number;
  complete: number;
}

export function groupByCompany(rows: ProjectRowModel[]): CompanyGroup[] {
  const map = new Map<string, ProjectRowModel[]>();
  for (const row of rows) {
    const list = map.get(row.lineage.company) ?? [];
    list.push(row);
    map.set(row.lineage.company, list);
  }
  return [...map.entries()]
    .map(([company, list]) => ({
      company,
      rows: list,
      active: list.filter((row) => row.open).length,
      complete: list.filter((row) => !row.open).length,
    }))
    .sort((a, b) => b.active - a.active || a.company.localeCompare(b.company));
}
