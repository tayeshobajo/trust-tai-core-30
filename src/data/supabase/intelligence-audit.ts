/**
 * The intelligence audit trail, persisted.
 *
 * Writes are best effort and never block a person's work: if the trail cannot
 * be written the change still stands, and the failure is reported to the
 * console rather than to the person mid-task. Reads are RLS scoped, so a
 * person only ever sees their own organization's history.
 *
 * There is deliberately no update and no delete here. The only shape of this
 * module is append and read.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type {
  IntelligenceAuditAction,
  IntelligenceAuditEntry,
  IntelligenceAuditInput,
} from "@/domain/intelligence-audit";

import { writeTolerant, type Row } from "./schema";

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function toEntry(row: Row): IntelligenceAuditEntry {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    ...(str(row["project_id"]) ? { projectId: String(row["project_id"]) } : {}),
    ...(str(row["project_name"]) ? { projectName: String(row["project_name"]) } : {}),
    ...(str(row["agent_id"]) ? { agentId: String(row["agent_id"]) } : {}),
    action: (str(row["action"]) as IntelligenceAuditAction) ?? "knowledge.recorded",
    subject: String(row["subject"] ?? ""),
    ...(str(row["before_state"]) ? { before: String(row["before_state"]) } : {}),
    ...(str(row["after_state"]) ? { after: String(row["after_state"]) } : {}),
    actorId: String(row["actor_id"] ?? ""),
    ...(str(row["actor_label"]) ? { actorLabel: String(row["actor_label"]) } : {}),
    occurredAt: String(row["occurred_at"] ?? row["created_at"] ?? new Date().toISOString()),
  };
}

export interface AuditQuery {
  organizationId: ID;
  projectId?: ID;
  agentId?: string;
  limit?: number;
}

export const intelligenceAudit = {
  /** Append one entry. Never throws into the caller's flow. */
  async record(input: IntelligenceAuditInput): Promise<void> {
    const payload: Row = {
      organization_id: input.organizationId,
      action: input.action,
      subject: input.subject.slice(0, 400),
      actor_id: input.actorId,
      occurred_at: new Date().toISOString(),
      ...(input.projectId ? { project_id: input.projectId } : {}),
      ...(input.projectName ? { project_name: input.projectName } : {}),
      ...(input.agentId ? { agent_id: input.agentId } : {}),
      ...(input.before ? { before_state: input.before.slice(0, 400) } : {}),
      ...(input.after ? { after_state: input.after.slice(0, 400) } : {}),
      ...(input.actorLabel ? { actor_label: input.actorLabel } : {}),
    };
    try {
      const { error } = await writeTolerant(
        payload,
        ["organization_id", "action", "subject", "actor_id"],
        async (body) =>
          await supabase.from("intelligence_audit").insert(body).select("id").maybeSingle(),
      );
      if (error) console.warn("intelligence audit not written", error.message);
    } catch (error) {
      console.warn("intelligence audit not written", error);
    }
  },

  /** Newest first. An unreadable trail reads as empty, never as an error page. */
  async list(query: AuditQuery): Promise<IntelligenceAuditEntry[]> {
    let request = supabase
      .from("intelligence_audit")
      .select("*")
      .eq("organization_id", query.organizationId)
      .order("occurred_at", { ascending: false })
      .limit(query.limit ?? 50);
    if (query.projectId) request = request.eq("project_id", query.projectId);
    if (query.agentId) request = request.eq("agent_id", query.agentId);
    const { data, error } = await request;
    if (error) {
      console.warn("intelligence audit not read", error.message);
      return [];
    }
    return (data ?? []).map((row) => toEntry(row as Row));
  },
};
