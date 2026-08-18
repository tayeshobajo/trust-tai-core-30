/**
 * Trust Tai OS, the intelligence audit trail.
 *
 * Project intelligence is only trustworthy if you can see how it got that
 * way. Every change to what a project believes, what an agent is accountable
 * for, and which evidence counts is written here: what changed, what it was
 * before, who did it, and when.
 *
 * The trail is append only. Nothing in the product edits or deletes an entry,
 * because a history that can be tidied up is not a history.
 */

import type { ID } from "./entities";

export type IntelligenceAuditAction =
  | "thinking.linked"
  | "thinking.removed"
  | "thinking.imported"
  | "knowledge.recorded"
  | "knowledge.confirmed"
  | "knowledge.superseded"
  | "knowledge.returned_to_review"
  | "asset.uploaded"
  | "asset.status_changed"
  | "connection.linked"
  | "connection.removed"
  | "agent.definition_saved"
  | "agent.required_context_changed"
  | "agent.evidence_expectation_changed";

export const AUDIT_ACTION_LABEL: Record<IntelligenceAuditAction, string> = {
  "thinking.linked": "Thinking room linked",
  "thinking.removed": "Thinking room removed",
  "thinking.imported": "Imported from a thinking room",
  "knowledge.recorded": "Knowledge recorded",
  "knowledge.confirmed": "Confirmed as project truth",
  "knowledge.superseded": "Superseded",
  "knowledge.returned_to_review": "Returned to review",
  "asset.uploaded": "Asset uploaded",
  "asset.status_changed": "Asset status changed",
  "connection.linked": "Build connection linked",
  "connection.removed": "Build connection removed",
  "agent.definition_saved": "Agent definition saved",
  "agent.required_context_changed": "Required context changed",
  "agent.evidence_expectation_changed": "Expected evidence changed",
};

/** Which part of the intelligence picture an entry belongs to. */
export type IntelligenceAuditArea = "thinking" | "knowledge" | "assets" | "connections" | "agents";

export function areaOf(action: IntelligenceAuditAction): IntelligenceAuditArea {
  if (action.startsWith("thinking.")) return "thinking";
  if (action.startsWith("knowledge.")) return "knowledge";
  if (action.startsWith("asset.")) return "assets";
  if (action.startsWith("connection.")) return "connections";
  return "agents";
}

export interface IntelligenceAuditEntry {
  id: ID;
  organizationId: ID;
  /** Project scoped entries carry a project. Agent definitions do not. */
  projectId?: ID;
  projectName?: string;
  agentId?: string;
  action: IntelligenceAuditAction;
  /** What the change was about, in the person's own words where possible. */
  subject: string;
  /** State before and after, when the change replaced something. */
  before?: string;
  after?: string;
  actorId: ID;
  actorLabel?: string;
  occurredAt: string;
}

export interface IntelligenceAuditInput {
  organizationId: ID;
  projectId?: ID | undefined;
  projectName?: string | undefined;
  agentId?: string | undefined;
  action: IntelligenceAuditAction;
  subject: string;
  before?: string | undefined;
  after?: string | undefined;
  actorId: ID;
  actorLabel?: string | undefined;
}

/** One line a person can read without opening anything else. */
export function auditSentence(entry: IntelligenceAuditEntry): string {
  const who = entry.actorLabel ?? "Someone";
  const change =
    entry.before && entry.after
      ? ` (${entry.before} → ${entry.after})`
      : entry.after
        ? ` (${entry.after})`
        : "";
  return `${who}: ${AUDIT_ACTION_LABEL[entry.action]}${change}`;
}

/** The plain difference between two lists, for required context and evidence. */
export function listDiff(
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[] } {
  const had = new Set(before.map((entry) => entry.trim()));
  const has = new Set(after.map((entry) => entry.trim()));
  return {
    added: [...has].filter((entry) => entry.length > 0 && !had.has(entry)),
    removed: [...had].filter((entry) => entry.length > 0 && !has.has(entry)),
  };
}
