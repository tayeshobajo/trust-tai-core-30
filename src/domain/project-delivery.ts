/**
 * Trust Tai OS — what a delivery room holds.
 *
 * A project is the agreement. These are the things that actually move inside
 * it: the work, what is stopping it, the delivery decisions it needs, and the
 * files it produced. Each one is recorded by a person, never inferred.
 *
 * Truth boundary: Roadmap decides direction. A decision recorded here is a
 * delivery decision, and it never rewrites roadmap truth.
 */

import type { ID, ISODateTime } from "./entities";

/* -------------------------------------------------------------- work items */

export type WorkItemStatus = "ready" | "in_progress" | "in_review" | "blocked" | "complete";

export const WORK_ITEM_STATUSES: WorkItemStatus[] = [
  "ready",
  "in_progress",
  "in_review",
  "blocked",
  "complete",
];

export const WORK_ITEM_STATUS_LABEL: Record<WorkItemStatus, string> = {
  ready: "Ready",
  in_progress: "In progress",
  in_review: "In review",
  blocked: "Blocked",
  complete: "Complete",
};

export const WORK_ITEM_STATUS_TONE: Record<WorkItemStatus, string> = {
  ready: "border-border bg-secondary text-muted-foreground",
  in_progress: "border-royal/25 bg-royal/8 text-royal",
  in_review: "border-warning/30 bg-warning/10 text-warning",
  blocked: "border-destructive/25 bg-destructive/8 text-destructive",
  complete: "border-success/25 bg-success/10 text-success",
};

export interface WorkItem {
  id: ID;
  organizationId: ID;
  projectId: ID;
  title: string;
  description?: string;
  status: WorkItemStatus;
  ownerUserId?: ID;
  ownerLabel?: string;
  dueDate?: ISODateTime;
  startedAt?: ISODateTime;
  completedAt?: ISODateTime;
  /** The order a person put the work in. Up next reads this, nothing else. */
  sequence: number;
  reviewState?: string;
  /** Only ever a dependency somebody actually recorded. */
  dependsOn?: ID;
  milestoneId?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface WorkItemInput {
  title: string;
  description?: string;
  status?: WorkItemStatus;
  ownerLabel?: string;
  ownerUserId?: ID;
  dueDate?: string;
  sequence?: number;
  dependsOn?: ID;
  milestoneId?: ID;
}

/* ---------------------------------------------------------------- blockers */

export type BlockerStatus = "open" | "resolved";

export interface ProjectBlocker {
  id: ID;
  organizationId: ID;
  projectId: ID;
  workItemId?: ID;
  reason: string;
  impact?: string;
  ownerLabel?: string;
  nextMove?: string;
  status: BlockerStatus;
  raisedAt: ISODateTime;
  resolvedAt?: ISODateTime;
  resolution?: string;
  createdAt: ISODateTime;
}

export interface BlockerInput {
  reason: string;
  impact?: string;
  ownerLabel?: string;
  nextMove?: string;
  workItemId?: ID;
}

/* --------------------------------------------------------------- decisions */

export type ProjectDecisionStatus = "open" | "answered";

export interface ProjectDecision {
  id: ID;
  organizationId: ID;
  projectId: ID;
  workItemId?: ID;
  question: string;
  whyItMatters?: string;
  ownerLabel?: string;
  status: ProjectDecisionStatus;
  answer?: string;
  decidedAt?: ISODateTime;
  createdAt: ISODateTime;
}

export interface ProjectDecisionInput {
  question: string;
  whyItMatters?: string;
  ownerLabel?: string;
  workItemId?: ID;
}

/* ------------------------------------------------------------------- files */

export type ProjectFileKind = "working" | "deliverable" | "reference";

export const FILE_KINDS: ProjectFileKind[] = ["working", "deliverable", "reference"];

export const FILE_KIND_LABEL: Record<ProjectFileKind, string> = {
  working: "Working files",
  deliverable: "Client deliverables",
  reference: "References",
};

export interface ProjectFile {
  id: ID;
  organizationId: ID;
  projectId: ID;
  workItemId?: ID;
  name: string;
  kind: ProjectFileKind;
  storagePath: string;
  contentType?: string;
  sizeBytes?: number;
  uploadedByLabel?: string;
  createdAt: ISODateTime;
}

/** The bucket every project file lives in. Private; read through signed urls. */
export const PROJECT_FILES_BUCKET = "project-files";

/** `<organization>/<project>/<unique>-<name>` — the org id gates the policy. */
export function projectFilePath(organizationId: ID, projectId: ID, fileName: string): string {
  const safe = fileName.replace(/[^\w.\-]+/g, "-").slice(-120) || "file";
  const unique =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : String(Date.now());
  return `${organizationId}/${projectId}/${unique}-${safe}`;
}
