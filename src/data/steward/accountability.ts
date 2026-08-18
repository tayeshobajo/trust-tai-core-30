/**
 * Steward's accountability projection.
 *
 * Pure. It turns real workspace rows, confirmed commitments, project work
 * items and Paperclip agent work, into one checklist of who owes what. It
 * invents no person, no task, no due date and no count.
 */

import type { WorkItem } from "@/domain/project-delivery";
import type { ExecutionProject } from "@/domain/projects";
import type { Commitment } from "@/domain/steward";
import { personKeyOf } from "@/domain/steward";
import {
  initialsOf,
  STEWARD_FOCUS_ORDER,
  UNOWNED,
  type CompletionPath,
  type StewardAgent,
  type StewardFocus,
  type StewardOwner,
  type StewardTask,
  type StewardTaskState,
  type StewardTaskStateRecord,
} from "@/domain/steward-accountability";

const DAY = 86_400_000;

export interface AccountabilityInput {
  now: string;
  commitments: Commitment[];
  workItems: WorkItem[];
  projects: ExecutionProject[];
  agents: StewardAgent[];
  taskState: StewardTaskStateRecord[];
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((a - b) / DAY);
}

function humanOwner(name: string, email?: string, userId?: string): StewardOwner {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return UNOWNED;
  return {
    kind: "human",
    key: personKeyOf({ email: email ?? null, name: trimmed }),
    name: trimmed,
    initials: initialsOf(trimmed),
    ...(userId ? { userId } : {}),
  };
}

/** Focus Steward derives from real state. A human choice always wins. */
export function derivedFocus(input: {
  state: StewardTaskState;
  dueAt?: string | undefined;
  now: string;
  ownerKind: StewardOwner["kind"];
}): StewardFocus {
  if (input.ownerKind === "unowned") return "delegate";
  if (input.state === "blocked" || input.state === "waiting") return "delegate";
  if (input.state === "needs_approval") return "do_now";
  if (input.dueAt) {
    const days = daysBetween(input.dueAt, input.now);
    if (days <= 0) return "do_now";
    if (days <= 7) return "protect_time";
    return "protect_time";
  }
  return "protect_time";
}

function whyOf(task: {
  state: StewardTaskState;
  dueAt?: string | undefined;
  now: string;
  ownerKind: StewardOwner["kind"];
  overdue: boolean;
  sourceLabel: string;
}): string {
  if (task.ownerKind === "unowned") return "Nobody has taken this yet.";
  if (task.overdue && task.dueAt) {
    const days = Math.abs(daysBetween(task.dueAt, task.now));
    return `Past its date by ${days} day${days === 1 ? "" : "s"}.`;
  }
  if (task.state === "blocked") return "Recorded as blocked, so it cannot move on its own.";
  if (task.state === "waiting") return "Held with someone else.";
  if (task.state === "needs_approval") return "An agent is waiting on a human decision.";
  if (task.dueAt) {
    const days = daysBetween(task.dueAt, task.now);
    if (days === 0) return "Due today.";
    return `Due in ${days} day${days === 1 ? "" : "s"}.`;
  }
  return `Carried from ${task.sourceLabel}.`;
}

function commitmentState(commitment: Commitment): StewardTaskState {
  if (commitment.status === "kept") return "complete";
  if (commitment.status === "waiting") return "waiting";
  return "open";
}

function workState(item: WorkItem): StewardTaskState {
  switch (item.status) {
    case "in_progress":
      return "in_progress";
    case "in_review":
      return "in_review";
    case "blocked":
      return "blocked";
    case "complete":
      return "complete";
    default:
      return "open";
  }
}

function agentTaskState(status: string): StewardTaskState {
  const value = status.toLowerCase();
  if (value.includes("review") || value.includes("approval")) return "needs_approval";
  if (value.includes("block")) return "blocked";
  if (value.includes("progress") || value.includes("working")) return "in_progress";
  if (value.includes("done") || value.includes("complete")) return "complete";
  return "open";
}

function rankOf(task: {
  focus: StewardFocus;
  overdue: boolean;
  dueAt?: string | undefined;
  ownerKind: StewardOwner["kind"];
}): number {
  let rank = STEWARD_FOCUS_ORDER.indexOf(task.focus) * 1000;
  if (task.overdue) rank -= 500;
  if (task.ownerKind === "unowned") rank -= 250;
  if (task.dueAt) rank += Math.min(400, Math.max(0, Math.floor(Date.parse(task.dueAt) / DAY) % 400));
  return rank;
}

/** Build every accountability row Steward can see, sorted deterministically. */
export function buildStewardTasks(input: AccountabilityInput): StewardTask[] {
  const stateByKey = new Map(input.taskState.map((row) => [row.taskKey, row]));
  const projectName = new Map(input.projects.map((project) => [project.id, project.name]));
  const tasks: StewardTask[] = [];

  const push = (task: Omit<StewardTask, "focus" | "focusSetByHuman" | "rank" | "why">) => {
    const saved = stateByKey.get(task.key);
    const derived = derivedFocus({
      state: task.state,
      dueAt: task.dueAt,
      now: input.now,
      ownerKind: task.owner.kind,
    });
    const focus = saved?.focus ?? derived;
    tasks.push({
      ...task,
      focus,
      focusSetByHuman: Boolean(saved?.focus),
      why: whyOf({
        state: task.state,
        dueAt: task.dueAt,
        now: input.now,
        ownerKind: task.owner.kind,
        overdue: task.overdue,
        sourceLabel: task.sourceLabel,
      }),
      rank:
        saved?.rank != null
          ? saved.rank
          : rankOf({ focus, overdue: task.overdue, dueAt: task.dueAt, ownerKind: task.owner.kind }),
      ...(saved?.completedBy ? { completedBy: saved.completedBy } : {}),
      ...(saved?.completedAt ? { completedAt: saved.completedAt } : {}),
      ...(saved?.completionNote ? { completionNote: saved.completionNote } : {}),
    });
  };

  /* ---- meeting commitments ------------------------------------------- */
  for (const commitment of input.commitments) {
    if (commitment.status === "released") continue;
    const state = commitmentState(commitment);
    const owner = humanOwner(commitment.ownerName, commitment.ownerEmail, commitment.ownerUserId);
    const overdue = Boolean(
      commitment.dueAt && state !== "complete" && Date.parse(commitment.dueAt) < Date.parse(input.now),
    );
    const promoted = Boolean(commitment.projectId);
    const path: CompletionPath = promoted ? "projects" : "steward";
    push({
      key: `commitment:${commitment.id}`,
      id: commitment.id,
      origin: "commitment",
      title: commitment.what,
      sourceLabel: promoted
        ? `Meeting commitment · ${projectName.get(commitment.projectId!) ?? "Linked project"}`
        : "Meeting commitment",
      sourceRoute: `/modules/steward/meetings/${commitment.conversationId}`,
      owner,
      ...(commitment.dueAt ? { dueAt: commitment.dueAt } : {}),
      state,
      overdue,
      completionPath: path,
      ...(promoted
        ? {
            completionBecause:
              "This promise is delivered in Projects. Complete the work item there and Steward will follow.",
          }
        : {}),
      ...(commitment.projectId ? { projectId: commitment.projectId } : {}),
      ...(commitment.projectId && projectName.get(commitment.projectId)
        ? { projectName: projectName.get(commitment.projectId)! }
        : {}),
      conversationId: commitment.conversationId,
      ...(commitment.beneficiary ? { companyLabel: commitment.beneficiary } : {}),
      evidence: commitment.evidence,
      updatedAt: commitment.updatedAt,
    });
  }

  /* ---- project work items --------------------------------------------- */
  for (const item of input.workItems) {
    const state = workState(item);
    const owner = item.ownerLabel ? humanOwner(item.ownerLabel, undefined, item.ownerUserId) : UNOWNED;
    const overdue = Boolean(
      item.dueDate && state !== "complete" && Date.parse(item.dueDate) < Date.parse(input.now),
    );
    push({
      key: `project:${item.id}`,
      id: item.id,
      origin: "project",
      title: item.title,
      sourceLabel: projectName.get(item.projectId)
        ? `Project · ${projectName.get(item.projectId)}`
        : "Project work",
      sourceRoute: `/modules/projects/${item.projectId}`,
      owner,
      ...(item.dueDate ? { dueAt: item.dueDate } : {}),
      state,
      overdue,
      completionPath: "projects",
      completionBecause: "Projects owns delivery truth. Completing here opens the Projects work item.",
      projectId: item.projectId,
      ...(projectName.get(item.projectId) ? { projectName: projectName.get(item.projectId)! } : {}),
      evidence: [],
      updatedAt: item.updatedAt,
    });
  }

  /* ---- agent work ------------------------------------------------------ */
  for (const agent of input.agents) {
    const owner: StewardOwner = {
      kind: "agent",
      key: agent.paperclipAgentId,
      name: agent.name,
      initials: initialsOf(agent.name),
      agentId: agent.paperclipAgentId,
    };
    for (const item of [...agent.activeTasks, ...agent.awaitingApproval]) {
      const state = agentTaskState(item.status);
      push({
        key: `agent:${item.id}`,
        id: item.id,
        origin: "agent",
        title: item.title,
        sourceLabel: `${agent.name} · Paperclip`,
        owner,
        state,
        overdue: false,
        completionPath: "paperclip",
        completionBecause:
          "Paperclip reports agent completion. Steward will not mark an agent's work done on its behalf.",
        evidence: [],
        updatedAt: item.updatedAt ?? input.now,
      });
    }
  }

  return tasks.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
}

/* ---------------------------------------------------------------- filters */

export type TeamFilter =
  | "all"
  | "needs_attention"
  | "overdue"
  | "blocked"
  | "no_owner"
  | "agents"
  | "team";

export const TEAM_FILTER_LABEL: Record<TeamFilter, string> = {
  all: "All",
  needs_attention: "Needs attention",
  overdue: "Overdue",
  blocked: "Blocked",
  no_owner: "No owner",
  agents: "Agents",
  team: "Team",
};

export function applyTeamFilter(tasks: StewardTask[], filter: TeamFilter): StewardTask[] {
  switch (filter) {
    case "needs_attention":
      return tasks.filter(
        (task) =>
          task.state !== "complete" &&
          (task.overdue ||
            task.owner.kind === "unowned" ||
            task.state === "blocked" ||
            task.state === "needs_approval"),
      );
    case "overdue":
      return tasks.filter((task) => task.overdue);
    case "blocked":
      return tasks.filter((task) => task.state === "blocked");
    case "no_owner":
      return tasks.filter((task) => task.owner.kind === "unowned");
    case "agents":
      return tasks.filter((task) => task.owner.kind === "agent");
    case "team":
      return tasks.filter((task) => task.owner.kind === "human");
    default:
      return tasks;
  }
}

export type TasksFilter =
  | "all"
  | "mine"
  | "team"
  | "agents"
  | "today"
  | "upcoming"
  | "overdue"
  | "completed"
  | "no_owner";

export const TASKS_FILTER_LABEL: Record<TasksFilter, string> = {
  all: "All",
  mine: "Mine",
  team: "Team",
  agents: "Agents",
  today: "Today",
  upcoming: "Upcoming",
  overdue: "Overdue",
  completed: "Completed",
  no_owner: "No owner",
};

export function applyTasksFilter(
  tasks: StewardTask[],
  filter: TasksFilter,
  context: { now: string; viewerKey: string },
): StewardTask[] {
  const today = context.now.slice(0, 10);
  switch (filter) {
    case "mine":
      return tasks.filter((task) => task.owner.key === context.viewerKey);
    case "team":
      return tasks.filter((task) => task.owner.kind === "human");
    case "agents":
      return tasks.filter((task) => task.owner.kind === "agent");
    case "today":
      return tasks.filter((task) => task.dueAt?.slice(0, 10) === today);
    case "upcoming":
      return tasks.filter(
        (task) => task.dueAt != null && task.dueAt.slice(0, 10) > today && task.state !== "complete",
      );
    case "overdue":
      return tasks.filter((task) => task.overdue);
    case "completed":
      return tasks.filter((task) => task.state === "complete");
    case "no_owner":
      return tasks.filter((task) => task.owner.kind === "unowned");
    default:
      return tasks.filter((task) => task.state !== "complete");
  }
}

export function searchTasks(tasks: StewardTask[], query: string): StewardTask[] {
  const term = query.trim().toLowerCase();
  if (!term) return tasks;
  return tasks.filter((task) =>
    `${task.title} ${task.sourceLabel} ${task.owner.name} ${task.projectName ?? ""}`
      .toLowerCase()
      .includes(term),
  );
}

/* ----------------------------------------------------------------- counts */

export interface TeamGlance {
  teamMembers: number;
  activeTasks: number;
  overdue: number;
  blocked: number;
  noOwner: number;
  agents: number;
  awaitingApproval: number;
}

export function glanceOf(tasks: StewardTask[]): TeamGlance {
  const open = tasks.filter((task) => task.state !== "complete");
  const people = new Set(
    open.filter((task) => task.owner.kind === "human").map((task) => task.owner.key),
  );
  const agents = new Set(
    open.filter((task) => task.owner.kind === "agent").map((task) => task.owner.key),
  );
  return {
    teamMembers: people.size,
    activeTasks: open.length,
    overdue: open.filter((task) => task.overdue).length,
    blocked: open.filter((task) => task.state === "blocked").length,
    noOwner: open.filter((task) => task.owner.kind === "unowned").length,
    agents: agents.size,
    awaitingApproval: open.filter((task) => task.state === "needs_approval").length,
  };
}

export interface PersonRead {
  owner: StewardOwner;
  tasks: StewardTask[];
  active: number;
  overdue: number;
  blocked: number;
  completedThisWeek: number;
  mainPriority: StewardTask | null;
  byFocus: { focus: StewardFocus; tasks: StewardTask[] }[];
}

export function personRead(tasks: StewardTask[], ownerKey: string, now: string): PersonRead | null {
  const mine = tasks.filter((task) => task.owner.key === ownerKey);
  const first = mine[0];
  if (!first) return null;
  const open = mine.filter((task) => task.state !== "complete");
  const weekAgo = new Date(Date.parse(now) - 7 * DAY).toISOString();
  return {
    owner: first.owner,
    tasks: mine,
    active: open.length,
    overdue: open.filter((task) => task.overdue).length,
    blocked: open.filter((task) => task.state === "blocked").length,
    completedThisWeek: mine.filter(
      (task) => task.state === "complete" && (task.completedAt ?? task.updatedAt) >= weekAgo,
    ).length,
    mainPriority: open[0] ?? null,
    byFocus: STEWARD_FOCUS_ORDER.map((focus) => ({
      focus,
      tasks: open.filter((task) => task.focus === focus),
    })).filter((group) => group.tasks.length > 0),
  };
}

export function groupByFocus(tasks: StewardTask[]): { focus: StewardFocus; tasks: StewardTask[] }[] {
  return STEWARD_FOCUS_ORDER.map((focus) => ({
    focus,
    tasks: tasks.filter((task) => task.focus === focus),
  })).filter((group) => group.tasks.length > 0);
}

export function groupByOwner(tasks: StewardTask[]): { label: string; tasks: StewardTask[] }[] {
  const map = new Map<string, { label: string; tasks: StewardTask[] }>();
  for (const task of tasks) {
    const entry = map.get(task.owner.key) ?? { label: task.owner.name, tasks: [] };
    entry.tasks.push(task);
    map.set(task.owner.key, entry);
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function groupByProject(tasks: StewardTask[]): { label: string; tasks: StewardTask[] }[] {
  const map = new Map<string, { label: string; tasks: StewardTask[] }>();
  for (const task of tasks) {
    const key = task.projectId ?? "unlinked";
    const entry = map.get(key) ?? { label: task.projectName ?? "Not linked to a project", tasks: [] };
    entry.tasks.push(task);
    map.set(key, entry);
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function groupByDue(tasks: StewardTask[]): { label: string; tasks: StewardTask[] }[] {
  const map = new Map<string, { label: string; tasks: StewardTask[] }>();
  for (const task of tasks) {
    const key = task.dueAt?.slice(0, 10) ?? "no-date";
    const entry = map.get(key) ?? { label: task.dueAt?.slice(0, 10) ?? "No date", tasks: [] };
    entry.tasks.push(task);
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] === "no-date" ? 1 : b[0] === "no-date" ? -1 : a[0].localeCompare(b[0])))
    .map(([, value]) => value);
}
