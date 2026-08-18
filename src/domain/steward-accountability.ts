/**
 * Trust Tai OS, Steward accountability contracts.
 *
 * Steward connects what people and agents said they would do with what
 * actually happened. It owns meeting-derived commitments, ownership
 * visibility and follow-through. It never owns delivery truth: a task that
 * belongs to Projects is completed in Projects, and a task an agent is
 * running is completed only when Paperclip says so.
 */

import type { EvidenceRef } from "./confidence";
import type { ID, ISODateTime } from "./entities";

/* ------------------------------------------------------------------ focus */

export type StewardFocus = "do_now" | "protect_time" | "delegate" | "deprioritize";

export const STEWARD_FOCUS_ORDER: StewardFocus[] = [
  "do_now",
  "protect_time",
  "delegate",
  "deprioritize",
];

export const STEWARD_FOCUS_LABEL: Record<StewardFocus, string> = {
  do_now: "Do now",
  protect_time: "Protect time",
  delegate: "Delegate / challenge",
  deprioritize: "Deprioritize",
};

export const STEWARD_FOCUS_TONE: Record<StewardFocus, string> = {
  do_now: "border-destructive/25 bg-destructive/8 text-destructive",
  protect_time: "border-royal/25 bg-royal/8 text-royal",
  delegate: "border-warning/30 bg-warning/10 text-warning",
  deprioritize: "border-border bg-secondary text-muted-foreground",
};

/* ------------------------------------------------------------------ owner */

export type StewardOwnerKind = "human" | "agent" | "unowned";

export interface StewardOwner {
  kind: StewardOwnerKind;
  /** Lowercased email, agent id, or the literal `unowned`. */
  key: string;
  name: string;
  initials: string;
  userId?: ID;
  agentId?: string;
}

export const UNOWNED: StewardOwner = {
  kind: "unowned",
  key: "unowned",
  name: "No owner",
  initials: "?",
};

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase() || "?";
}

/* ------------------------------------------------------------------ state */

export type StewardTaskState =
  | "open"
  | "in_progress"
  | "waiting"
  | "blocked"
  | "in_review"
  | "needs_approval"
  | "complete";

export const STEWARD_STATE_LABEL: Record<StewardTaskState, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting: "Waiting",
  blocked: "Blocked",
  in_review: "In review",
  needs_approval: "Needs approval",
  complete: "Complete",
};

export const STEWARD_STATE_TONE: Record<StewardTaskState, string> = {
  open: "border-border bg-secondary text-muted-foreground",
  in_progress: "border-royal/25 bg-royal/8 text-royal",
  waiting: "border-warning/30 bg-warning/10 text-warning",
  blocked: "border-destructive/25 bg-destructive/8 text-destructive",
  in_review: "border-warning/30 bg-warning/10 text-warning",
  needs_approval: "border-warning/30 bg-warning/10 text-warning",
  complete: "border-success/25 bg-success/10 text-success",
};

/* ------------------------------------------------------------------- task */

/** Which system may record completion. Steward never overrides another room. */
export type CompletionPath = "steward" | "projects" | "paperclip" | "none";

export type StewardTaskOrigin = "commitment" | "project" | "agent";

export interface StewardTask {
  /** Stable across reloads: `<origin>:<id>`. Used as the task-state key. */
  key: string;
  id: ID;
  origin: StewardTaskOrigin;
  title: string;
  /** Where the task came from, in a person's language. */
  sourceLabel: string;
  sourceRoute?: string;
  owner: StewardOwner;
  focus: StewardFocus;
  /** True when a human set the focus, rather than Steward deriving it. */
  focusSetByHuman: boolean;
  dueAt?: ISODateTime;
  state: StewardTaskState;
  overdue: boolean;
  completionPath: CompletionPath;
  /** Plain sentence used when Steward may not record completion itself. */
  completionBecause?: string;
  projectId?: ID;
  projectName?: string;
  conversationId?: ID;
  companyLabel?: string;
  evidence: EvidenceRef[];
  /** Why this is a priority, from real state only. */
  why: string;
  rank: number;
  updatedAt: ISODateTime;
  completedBy?: string;
  completedAt?: ISODateTime;
  completionNote?: string;
}

/* ----------------------------------------------------- Steward task state */

/**
 * The only accountability state Steward genuinely owns: how a task is framed
 * and ordered for a human, plus a completion record for meeting-only
 * commitments. It never duplicates delivery or agent truth.
 */
export interface StewardTaskStateRecord {
  taskKey: string;
  organizationId: ID;
  focus?: StewardFocus;
  rank?: number;
  completedBy?: string;
  completedAt?: ISODateTime;
  completionNote?: string;
  updatedAt: ISODateTime;
}

/* ----------------------------------------------------------------- agents */

export type AgentLifecycle =
  | "idle"
  | "assigned"
  | "queued"
  | "working"
  | "waiting"
  | "needs_approval"
  | "failed"
  | "unknown";

export const AGENT_LIFECYCLE_LABEL: Record<AgentLifecycle, string> = {
  idle: "Idle",
  assigned: "Assigned",
  queued: "Queued",
  working: "Working",
  waiting: "Waiting",
  needs_approval: "Needs approval",
  failed: "Failed",
  unknown: "Unknown",
};

export interface StewardAgentTask {
  id: string;
  title: string;
  status: string;
  updatedAt?: string;
}

export interface StewardAgentRoutine {
  id: string;
  title: string;
  status: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunIssueTitle: string | null;
}

export interface StewardAgentActivityItem {
  id: string;
  kind: "comment" | "status_change" | "assignment";
  authorKind: "agent" | "human";
  body: string;
  createdAt: string;
}

/** A Paperclip agent as Steward sees it. Paperclip stays the source of truth. */
export interface StewardAgent {
  id: string;
  paperclipAgentId: string;
  name: string;
  responsibility: string;
  owningApp: string;
  lifecycle: AgentLifecycle;
  capabilities: string[];
  /** Explicit boundaries. Always shown before a person assigns work. */
  cannotDo: string[];
  currentWork: string | null;
  activeTasks: StewardAgentTask[];
  awaitingApproval: StewardAgentTask[];
  completedThisWeek: number;
  lastHeartbeatAt: string | null;
  recentOutcome: string | null;
  // Phase 4-6
  routines: StewardAgentRoutine[];
  activityTimeline: StewardAgentActivityItem[];
  pendingApprovals: number;
  isPaused: boolean;
}

export interface StewardAgentRead {
  agents: StewardAgent[];
  /** Honest connection state. Never faked. */
  connected: boolean;
  because: string;
  /** Sync health from paperclip_sync_state. Null if never synced or unavailable. */
  syncHealth: {
    lastSuccessAt: string | null;
    consecutiveFailures: number;
  } | null;
}
