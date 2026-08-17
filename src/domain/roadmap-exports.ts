/**
 * Trust Tai OS — Roadmap client copies, execution links, and notes.
 *
 * An export is a frozen snapshot of approved roadmap state, not a live view.
 * Once created it is never regenerated: a change to the roadmap produces a new
 * version, and the earlier one keeps saying exactly what the client was sent.
 *
 * Execution links are correlation only. Projects and Ops keep owning their own
 * state; Roadmap reads it back as a progress signal and never replaces it.
 */

import type { ID, ISODateTime } from "./entities";

/* ------------------------------------------------------------------ exports */

export type ExportStatus = "draft" | "ready" | "sent" | "superseded";

export const EXPORT_STATUS_LABEL: Record<ExportStatus, string> = {
  draft: "Draft",
  ready: "Ready to send",
  sent: "Sent to client",
  superseded: "Superseded",
};

/** One milestone as the client sees it. Internal scoring never travels. */
export interface ExportMilestone {
  ordinal: string;
  name: string;
  whatWeBuild: string;
  whatItUnlocks: string;
  status: string;
}

export interface ExportEvidence {
  label: string;
  url?: string;
  observedAt?: ISODateTime;
}

/** Client-safe roadmap content. No internal notes, scores, or reasoning. */
export interface ExportSnapshot {
  company: string;
  websiteUrl?: string;
  pointA: string[];
  pointB: string;
  /** True when Point B was still a proposal at export time. Labelled, never hidden. */
  pointBProposed: boolean;
  milestones: ExportMilestone[];
  evidence: ExportEvidence[];
  noteFromTai?: string;
  generatedAt: ISODateTime;
}

export interface RoadmapExport {
  id: ID;
  organizationId: ID;
  roadmapId: ID;
  version: string;
  status: ExportStatus;
  snapshot: ExportSnapshot;
  createdBy?: ID;
  createdAt: ISODateTime;
  sentAt?: ISODateTime;
  commsRelationshipId?: ID;
  commsMessageId?: ID;
}

/* --------------------------------------------------------- execution links */

export type OwningApp = "projects" | "ops" | "studio";

export const OWNING_APP_LABEL: Record<OwningApp, string> = {
  projects: "Projects",
  ops: "Ops",
  studio: "Studio",
};

export type ExecutionLinkStatus =
  "requested" | "accepted" | "in_progress" | "complete" | "withdrawn";

export const EXECUTION_STATUS_LABEL: Record<ExecutionLinkStatus, string> = {
  requested: "Requested",
  accepted: "Accepted",
  in_progress: "In progress",
  complete: "Complete",
  withdrawn: "Withdrawn",
};

export interface RoadmapExecutionLink {
  id: ID;
  organizationId: ID;
  roadmapId: ID;
  milestoneId: ID;
  owningApp: OwningApp;
  projectId?: ID;
  opsReference?: string;
  status: ExecutionLinkStatus;
  createdAt: ISODateTime;
}

/* -------------------------------------------------------------------- notes */

export interface RoadmapDetailNote {
  id: ID;
  organizationId: ID;
  roadmapId: ID;
  body: string;
  authorUserId?: ID;
  authorLabel?: string;
  createdAt: ISODateTime;
}

/** Next semantic version for a client copy: 1.0, 2.0, 3.0 … */
export function nextVersion(existing: RoadmapExport[]): string {
  const highest = existing.reduce((top, entry) => {
    const major = Number.parseInt(entry.version.split(".")[0] ?? "0", 10);
    return Number.isFinite(major) && major > top ? major : top;
  }, 0);
  return `${highest + 1}.0`;
}
