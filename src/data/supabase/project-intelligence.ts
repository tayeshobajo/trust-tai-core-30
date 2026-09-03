/**
 * Project intelligence service: thinking rooms, knowledge, assets,
 * connections and agent effectiveness definitions.
 *
 * Everything is organization scoped and read under the person's own access
 * (RLS). Writes go through the Projects room authority guard, so a view-only
 * member cannot change anything even though the database only knows they are
 * a member. Assets are metadata over the canonical `project_files` rows, so
 * uploads reuse the existing private bucket rather than a second file system.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ActivityName } from "@/domain/activity";
import type { ID } from "@/domain/entities";
import type { ProjectFileKind } from "@/domain/project-delivery";
import {
  DEFAULT_ASSET_STATUS,
  initialReviewState,
  statusForNewConnection,
  syncStateFor,
  type AgentEffectiveness,
  type AgentEffectivenessInput,
  type AssetStatus,
  type AssetType,
  type ConnectionInput,
  type ConnectionType,
  type KnowledgeInput,
  type KnowledgeItem,
  type KnowledgeOrigin,
  type KnowledgeReviewState,
  type KnowledgeSection,
  type ProjectAsset,
  type ProjectConnection,
  type SourceSyncState,
  type ThinkingSource,
  type ThinkingSourceInput,
  type ThinkingSourceType,
} from "@/domain/project-intelligence";
import { knowledgeInputsFrom, parseThinkingImport } from "@/data/projects/thinking-import";
import { agentEvidenceFrom } from "@/data/steward/agent-evidence";
import type { AgentEvidence } from "@/domain/project-intelligence";
import type { StewardAgent } from "@/domain/steward-accountability";
import { listDiff, type IntelligenceAuditAction } from "@/domain/intelligence-audit";
import { assertRoomManage, guardRoomWrites } from "@/lib/room-authority";
import { intelligenceAudit } from "./intelligence-audit";

import { supabaseActivity } from "./activities";
import { projectDelivery, type DeliveryContext } from "./project-delivery";
import type { Row } from "./schema";

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function fail(message: string, error: { message: string } | null): never {
  throw new Error(error?.message ? `${message} ${error.message}` : message);
}

async function record(
  context: DeliveryContext,
  name: ActivityName,
  summary: string,
  payload: Record<string, unknown> = {},
) {
  const at = new Date().toISOString();
  try {
    await supabaseActivity.record({
      organizationId: context.organizationId,
      name,
      subject: { type: "project", id: context.projectId, label: context.projectName },
      summary,
      payload,
      provenance: {
        appId: "projects",
        actor: {
          type: "user",
          id: context.userId,
          ...(context.userLabel ? { label: context.userLabel } : {}),
        },
        observedAt: at,
        confidence: "observed",
      },
      occurredAt: at,
    });
  } catch {
    // History matters, never enough to lose the person's work.
  }
}

/**
 * Append to the intelligence audit trail. Separate from the activity stream:
 * activity is what the workspace saw happen, the audit trail is who changed
 * what a project believes, and what it said before.
 */
async function audit(
  context: DeliveryContext,
  action: IntelligenceAuditAction,
  subject: string,
  change: { before?: string; after?: string } = {},
) {
  await intelligenceAudit.record({
    organizationId: context.organizationId,
    projectId: context.projectId,
    projectName: context.projectName,
    action,
    subject,
    ...(change.before ? { before: change.before } : {}),
    ...(change.after ? { after: change.after } : {}),
    actorId: context.userId,
    ...(context.userLabel ? { actorLabel: context.userLabel } : {}),
  });
}

/* --------------------------------------------------------------- mappers */

function toThinking(row: Row): ThinkingSource {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    projectId: String(row["project_id"] ?? ""),
    sourceType: (str(row["source_type"]) as ThinkingSourceType | undefined) ?? "other",
    title: String(row["title"] ?? "Untitled source"),
    url: String(row["url"] ?? ""),
    isPrimary: row["is_primary"] === true,
    syncState: (str(row["sync_state"]) as SourceSyncState | undefined) ?? "link_saved",
    ...(str(row["notes"]) ? { notes: String(row["notes"]) } : {}),
    ...(str(row["last_reviewed_at"]) ? { lastReviewedAt: String(row["last_reviewed_at"]) } : {}),
    ...(str(row["added_by"]) ? { addedBy: String(row["added_by"]) } : {}),
    ...(str(row["added_by_label"]) ? { addedByLabel: String(row["added_by_label"]) } : {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
  };
}

function toKnowledge(row: Row): KnowledgeItem {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    projectId: String(row["project_id"] ?? ""),
    section: (str(row["section"]) as KnowledgeSection | undefined) ?? "reference",
    body: String(row["body"] ?? ""),
    origin: (str(row["origin"]) as KnowledgeOrigin | undefined) ?? "human",
    reviewState: (str(row["review_state"]) as KnowledgeReviewState | undefined) ?? "needs_review",
    ...(str(row["source_reference"]) ? { sourceReference: String(row["source_reference"]) } : {}),
    ...(str(row["source_label"]) ? { sourceLabel: String(row["source_label"]) } : {}),
    ...(typeof row["confidence"] === "number" ? { confidence: row["confidence"] as number } : {}),
    ...(str(row["captured_by"]) ? { capturedBy: String(row["captured_by"]) } : {}),
    ...(str(row["captured_by_label"]) ? { capturedByLabel: String(row["captured_by_label"]) } : {}),
    capturedAt: String(row["captured_at"] ?? new Date().toISOString()),
    ...(str(row["supersedes_id"]) ? { supersedesId: String(row["supersedes_id"]) } : {}),
  };
}

function toAsset(row: Row): ProjectAsset {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    projectId: String(row["project_id"] ?? ""),
    fileId: String(row["file_id"] ?? ""),
    assetType: (str(row["asset_type"]) as AssetType | undefined) ?? "other",
    title: String(row["title"] ?? "Untitled asset"),
    version: Number(row["version"] ?? 1),
    status: (str(row["status"]) as AssetStatus | undefined) ?? DEFAULT_ASSET_STATUS,
    ...(str(row["work_item_id"]) ? { workItemId: String(row["work_item_id"]) } : {}),
    ...(str(row["decision_id"]) ? { decisionId: String(row["decision_id"]) } : {}),
    ...(str(row["uploaded_by"]) ? { uploadedBy: String(row["uploaded_by"]) } : {}),
    ...(str(row["uploaded_by_label"]) ? { uploadedByLabel: String(row["uploaded_by_label"]) } : {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
    updatedAt: String(row["updated_at"] ?? row["created_at"] ?? new Date().toISOString()),
  };
}

function toConnection(row: Row): ProjectConnection {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    projectId: String(row["project_id"] ?? ""),
    connectionType: (str(row["connection_type"]) as ConnectionType | undefined) ?? "other",
    label: String(row["label"] ?? ""),
    ...(str(row["url"]) ? { url: String(row["url"]) } : {}),
    ...(str(row["external_id"]) ? { externalId: String(row["external_id"]) } : {}),
    status: (str(row["status"]) as ProjectConnection["status"] | undefined) ?? "linked",
    ...(str(row["last_synced_at"]) ? { lastSyncedAt: String(row["last_synced_at"]) } : {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
  };
}

function toEffectiveness(row: Row): AgentEffectiveness {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    agentId: String(row["agent_id"] ?? ""),
    responsibility: String(row["responsibility"] ?? ""),
    expectedWeeklyOutcomes: strings(row["expected_weekly_outcomes"]),
    successCriteria: strings(row["success_criteria"]),
    surfaceWhen: strings(row["surface_when"]),
    requiredContext: strings(row["required_context"]),
    escalationRules: strings(row["escalation_rules"]),
    evidenceExpected: strings(row["evidence_expected"]),
    ...(str(row["updated_by"]) ? { updatedBy: String(row["updated_by"]) } : {}),
    updatedAt: String(row["updated_at"] ?? new Date().toISOString()),
  };
}

/* --------------------------------------------------------------- service */

const service = {
  /* thinking rooms */

  async listThinking(context: DeliveryContext): Promise<ThinkingSource[]> {
    const { data, error } = await supabase
      .from("project_thinking_sources")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("project_id", context.projectId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) fail("The thinking rooms could not be read.", error);
    return (data ?? []).map((row) => toThinking(row as Row));
  },

  async addThinking(input: ThinkingSourceInput, context: DeliveryContext): Promise<ThinkingSource> {
    const payload = {
      organization_id: context.organizationId,
      project_id: context.projectId,
      source_type: input.sourceType,
      title: input.title.trim(),
      url: input.url.trim(),
      is_primary: input.isPrimary === true,
      sync_state: syncStateFor(input.sourceType),
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
      added_by: context.userId,
      ...(context.userLabel ? { added_by_label: context.userLabel } : {}),
    };
    const { data, error } = await supabase
      .from("project_thinking_sources")
      .insert(payload)
      .select("*")
      .single();
    if (error || !data) fail("That thinking room could not be saved.", error);
    const saved = toThinking(data as Row);
    if (saved.isPrimary) await service.markPrimaryThinking(saved, context);
    await record(context, "project.updated", `Thinking room added: ${saved.title}`, {
      sourceType: saved.sourceType,
      syncState: saved.syncState,
    });
    await audit(context, "thinking.linked", saved.title, { after: saved.url });
    return saved;
  },

  /** Exactly one primary per project. */
  async markPrimaryThinking(source: ThinkingSource, context: DeliveryContext): Promise<void> {
    await supabase
      .from("project_thinking_sources")
      .update({ is_primary: false })
      .eq("organization_id", context.organizationId)
      .eq("project_id", context.projectId)
      .neq("id", source.id);
    const { error } = await supabase
      .from("project_thinking_sources")
      .update({ is_primary: true })
      .eq("id", source.id);
    if (error) fail("That source could not be made primary.", error);
  },

  /** Honest state changes only: a real import, or a person marking it read. */
  async setThinkingSyncState(
    source: ThinkingSource,
    syncState: SourceSyncState,
    context: DeliveryContext,
  ): Promise<ThinkingSource> {
    const { data, error } = await supabase
      .from("project_thinking_sources")
      .update({ sync_state: syncState, last_reviewed_at: new Date().toISOString() })
      .eq("id", source.id)
      .eq("organization_id", context.organizationId)
      .select("*")
      .single();
    if (error || !data) fail("That source state could not be saved.", error);
    return toThinking(data as Row);
  },

  /**
   * Import pasted or uploaded content from a thinking room. Everything lands
   * as Needs review, attached to the source, so only a person can make it
   * canonical.
   */
  async importThinking(
    source: ThinkingSource,
    text: string,
    context: DeliveryContext,
  ): Promise<{ source: ThinkingSource; imported: KnowledgeItem[] }> {
    const candidates = parseThinkingImport(text);
    if (candidates.length === 0) {
      throw new Error(
        "Nothing in that text reads like a decision, a constraint or an open question yet.",
      );
    }
    const inputs = knowledgeInputsFrom(candidates, source);
    const payload = inputs.map((input) => ({
      organization_id: context.organizationId,
      project_id: context.projectId,
      section: input.section,
      body: input.body,
      origin: input.origin ?? "thinking_room",
      review_state: input.reviewState ?? "needs_review",
      ...(input.sourceReference ? { source_reference: input.sourceReference } : {}),
      ...(input.sourceLabel ? { source_label: input.sourceLabel } : {}),
      ...(typeof input.confidence === "number" ? { confidence: input.confidence } : {}),
      captured_by: context.userId,
      ...(context.userLabel ? { captured_by_label: context.userLabel } : {}),
    }));
    const { data, error } = await supabase.from("project_knowledge").insert(payload).select("*");
    if (error || !data) fail("That import could not be saved.", error);
    const imported = (data as Row[]).map((row) => toKnowledge(row));
    const updated = await service.setThinkingSyncState(source, "imported", context);
    await record(
      context,
      "project.updated",
      `Imported ${imported.length} candidate${imported.length === 1 ? "" : "s"} from ${source.title}`,
      { sourceId: source.id, reviewState: "needs_review" },
    );
    await audit(context, "thinking.imported", source.title, {
      after: `${imported.length} candidate${imported.length === 1 ? "" : "s"} awaiting review`,
    });
    return { source: updated, imported };
  },

  /** Removing the link never removes knowledge a person already confirmed. */
  async removeThinking(source: ThinkingSource, context: DeliveryContext): Promise<void> {
    const { error } = await supabase
      .from("project_thinking_sources")
      .delete()
      .eq("id", source.id)
      .eq("organization_id", context.organizationId);
    if (error) fail("That thinking room could not be removed.", error);
    await record(context, "project.updated", `Thinking room removed: ${source.title}`);
    await audit(context, "thinking.removed", source.title, { before: source.url });
  },

  /* knowledge */

  async listKnowledge(context: DeliveryContext): Promise<KnowledgeItem[]> {
    const { data, error } = await supabase
      .from("project_knowledge")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("project_id", context.projectId)
      .order("captured_at", { ascending: false });
    if (error) fail("Project knowledge could not be read.", error);
    return (data ?? []).map((row) => toKnowledge(row as Row));
  },

  async addKnowledge(input: KnowledgeInput, context: DeliveryContext): Promise<KnowledgeItem> {
    const origin: KnowledgeOrigin = input.origin ?? "human";
    const payload = {
      organization_id: context.organizationId,
      project_id: context.projectId,
      section: input.section,
      body: input.body.trim(),
      origin,
      review_state: input.reviewState ?? initialReviewState(origin),
      ...(input.sourceReference ? { source_reference: input.sourceReference } : {}),
      ...(input.sourceLabel ? { source_label: input.sourceLabel } : {}),
      ...(typeof input.confidence === "number" ? { confidence: input.confidence } : {}),
      captured_by: context.userId,
      ...(context.userLabel ? { captured_by_label: context.userLabel } : {}),
    };
    const { data, error } = await supabase
      .from("project_knowledge")
      .insert(payload)
      .select("*")
      .single();
    if (error || !data) fail("That knowledge could not be saved.", error);
    const saved = toKnowledge(data as Row);
    await record(
      context,
      "project.updated",
      `Project knowledge recorded: ${saved.body.slice(0, 90)}`,
      {
        section: saved.section,
        reviewState: saved.reviewState,
      },
    );
    await audit(context, "knowledge.recorded", saved.body, { after: saved.reviewState });
    return saved;
  },

  /** Confirming is the human act that turns a source into project truth. */
  async setKnowledgeReview(
    item: KnowledgeItem,
    reviewState: KnowledgeReviewState,
    context: DeliveryContext,
  ): Promise<KnowledgeItem> {
    const { data, error } = await supabase
      .from("project_knowledge")
      .update({ review_state: reviewState })
      .eq("id", item.id)
      .eq("organization_id", context.organizationId)
      .select("*")
      .single();
    if (error || !data) fail("That review state could not be saved.", error);
    await record(
      context,
      reviewState === "confirmed" ? "decision.decided" : "project.updated",
      `${reviewState === "confirmed" ? "Confirmed" : "Marked " + reviewState}: ${item.body.slice(0, 90)}`,
      { section: item.section },
    );
    const auditAction: IntelligenceAuditAction =
      reviewState === "confirmed"
        ? "knowledge.confirmed"
        : reviewState === "superseded"
          ? "knowledge.superseded"
          : "knowledge.returned_to_review";
    await audit(context, auditAction, item.body, {
      before: item.reviewState,
      after: reviewState,
    });
    return toKnowledge(data as Row);
  },

  /* assets */

  async listAssets(context: DeliveryContext): Promise<ProjectAsset[]> {
    const { data, error } = await supabase
      .from("project_assets")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("project_id", context.projectId)
      .order("created_at", { ascending: false });
    if (error) fail("Project assets could not be read.", error);
    return (data ?? []).map((row) => toAsset(row as Row));
  },

  /**
   * Upload once, through the canonical project file path, then describe it as
   * an asset. Never approved on the way in.
   */
  async uploadAsset(
    file: File,
    options: { assetType: AssetType; title?: string; workItemId?: ID; kind?: ProjectFileKind },
    context: DeliveryContext,
  ): Promise<ProjectAsset> {
    const stored = await projectDelivery.uploadFile(
      file,
      {
        kind: options.kind ?? "working",
        ...(options.workItemId ? { workItemId: options.workItemId } : {}),
      },
      context,
    );
    const existing = await service.listAssets(context);
    const version = existing.filter((asset) => asset.assetType === options.assetType).length + 1;
    const payload = {
      organization_id: context.organizationId,
      project_id: context.projectId,
      file_id: stored.id,
      asset_type: options.assetType,
      title: options.title?.trim() || stored.name,
      version,
      status: DEFAULT_ASSET_STATUS,
      ...(options.workItemId ? { work_item_id: options.workItemId } : {}),
      uploaded_by: context.userId,
      ...(context.userLabel ? { uploaded_by_label: context.userLabel } : {}),
    };
    const { data, error } = await supabase
      .from("project_assets")
      .insert(payload)
      .select("*")
      .single();
    if (error || !data) fail("That asset could not be recorded.", error);
    const saved = toAsset(data as Row);
    await record(context, "project.updated", `Asset uploaded: ${saved.title}`, {
      assetType: saved.assetType,
      status: saved.status,
    });
    await audit(context, "asset.uploaded", saved.title, { after: saved.status });
    return saved;
  },

  async setAssetStatus(
    asset: ProjectAsset,
    status: AssetStatus,
    context: DeliveryContext,
  ): Promise<ProjectAsset> {
    const { data, error } = await supabase
      .from("project_assets")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", asset.id)
      .eq("organization_id", context.organizationId)
      .select("*")
      .single();
    if (error || !data) fail("That asset status could not be saved.", error);
    await record(context, "project.updated", `Asset ${status}: ${asset.title}`, {
      assetId: asset.id,
      status,
    });
    await audit(context, "asset.status_changed", asset.title, {
      before: asset.status,
      after: status,
    });
    return toAsset(data as Row);
  },

  async linkAsset(
    asset: ProjectAsset,
    link: { workItemId?: ID | null; decisionId?: ID | null },
    context: DeliveryContext,
  ): Promise<ProjectAsset> {
    const { data, error } = await supabase
      .from("project_assets")
      .update({
        ...(link.workItemId !== undefined ? { work_item_id: link.workItemId } : {}),
        ...(link.decisionId !== undefined ? { decision_id: link.decisionId } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", asset.id)
      .eq("organization_id", context.organizationId)
      .select("*")
      .single();
    if (error || !data) fail("That asset link could not be saved.", error);
    return toAsset(data as Row);
  },

  /* connections */

  async listConnections(context: DeliveryContext): Promise<ProjectConnection[]> {
    const { data, error } = await supabase
      .from("project_connections")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("project_id", context.projectId)
      .order("created_at", { ascending: true });
    if (error) fail("Connections could not be read.", error);
    return (data ?? []).map((row) => toConnection(row as Row));
  },

  /** A saved URL is Linked. Only a real reader may ever write Connected. */
  async addConnection(
    input: ConnectionInput,
    context: DeliveryContext,
  ): Promise<ProjectConnection> {
    const payload = {
      organization_id: context.organizationId,
      project_id: context.projectId,
      connection_type: input.connectionType,
      label: input.label.trim(),
      ...(input.url?.trim() ? { url: input.url.trim() } : {}),
      ...(input.externalId?.trim() ? { external_id: input.externalId.trim() } : {}),
      status: statusForNewConnection(),
      created_by: context.userId,
    };
    const { data, error } = await supabase
      .from("project_connections")
      .insert(payload)
      .select("*")
      .single();
    if (error || !data) fail("That link could not be saved.", error);
    const saved = toConnection(data as Row);
    await record(context, "project.updated", `Linked ${saved.connectionType}: ${saved.label}`, {
      status: saved.status,
    });
    await audit(context, "connection.linked", saved.label, { after: saved.connectionType });
    return saved;
  },

  async removeConnection(connection: ProjectConnection, context: DeliveryContext): Promise<void> {
    const { error } = await supabase
      .from("project_connections")
      .delete()
      .eq("id", connection.id)
      .eq("organization_id", context.organizationId);
    if (error) fail("That link could not be removed.", error);
    await audit(context, "connection.removed", connection.label, {
      before: connection.connectionType,
    });
  },

  /* agent effectiveness */

  async listEffectiveness(organizationId: ID): Promise<AgentEffectiveness[]> {
    const { data, error } = await supabase
      .from("agent_effectiveness")
      .select("*")
      .eq("organization_id", organizationId);
    if (error) fail("Agent effectiveness definitions could not be read.", error);
    return (data ?? []).map((row) => toEffectiveness(row as Row));
  },

  /**
   * Writing an agent definition decides what an agent is held to, so it is a
   * Manage act in Steward, not everyday work. The previous definition is read
   * first so the trail can say what changed rather than only that something did.
   */
  async saveEffectiveness(
    input: AgentEffectivenessInput,
    organizationId: ID,
    userId: ID,
    userLabel?: string,
  ): Promise<AgentEffectiveness> {
    assertRoomManage("steward", "Steward", "Changing what an agent is accountable for");
    const previous =
      (await service.listEffectiveness(organizationId)).find(
        (entry) => entry.agentId === input.agentId,
      ) ?? null;
    const payload = {
      organization_id: organizationId,
      agent_id: input.agentId,
      responsibility: input.responsibility.trim(),
      expected_weekly_outcomes: input.expectedWeeklyOutcomes ?? [],
      success_criteria: input.successCriteria ?? [],
      surface_when: input.surfaceWhen ?? [],
      required_context: input.requiredContext ?? [],
      escalation_rules: input.escalationRules ?? [],
      evidence_expected: input.evidenceExpected ?? [],
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("agent_effectiveness")
      .upsert(payload, { onConflict: "organization_id,agent_id" })
      .select("*")
      .single();
    if (error || !data) fail("That agent definition could not be saved.", error);
    const saved = toEffectiveness(data as Row);

    const base = {
      organizationId,
      agentId: saved.agentId,
      actorId: userId,
      ...(userLabel ? { actorLabel: userLabel } : {}),
    };
    await intelligenceAudit.record({
      ...base,
      action: "agent.definition_saved",
      subject: saved.responsibility,
      ...(previous ? { before: previous.responsibility } : {}),
      after: saved.responsibility,
    });
    const contextChange = listDiff(previous?.requiredContext ?? [], saved.requiredContext);
    if (contextChange.added.length > 0 || contextChange.removed.length > 0) {
      await intelligenceAudit.record({
        ...base,
        action: "agent.required_context_changed",
        subject: `Required context for ${saved.agentId}`,
        before: (previous?.requiredContext ?? []).join(", "),
        after: saved.requiredContext.join(", "),
      });
    }
    const evidenceChange = listDiff(previous?.evidenceExpected ?? [], saved.evidenceExpected);
    if (evidenceChange.added.length > 0 || evidenceChange.removed.length > 0) {
      await intelligenceAudit.record({
        ...base,
        action: "agent.evidence_expectation_changed",
        subject: `Expected evidence for ${saved.agentId}`,
        before: (previous?.evidenceExpected ?? []).join(", "),
        after: saved.evidenceExpected.join(", "),
      });
    }
    return saved;
  },
};

export const projectIntelligence = guardRoomWrites("projects", "Projects", service, [
  "listThinking",
  "listKnowledge",
  "listAssets",
  "listConnections",
  "listEffectiveness",
]);

/**
 * Agent definitions are written from Steward, so they are guarded by Steward
 * authority. A person with view access can read what good looks like and
 * still cannot change it.
 */
export const agentEffectivenessService = guardRoomWrites(
  "steward",
  "Steward",
  {
    list: (organizationId: ID) => service.listEffectiveness(organizationId),
    save: (input: AgentEffectivenessInput, organizationId: ID, userId: ID, userLabel?: string) =>
      service.saveEffectiveness(input, organizationId, userId, userLabel),
    /**
     * Observed evidence is not general reading. It says how an agent is
     * performing against a definition, so it stays with the people who carry
     * Steward authority. A view-only member sees that it exists, not what it says.
     */
    evidence: (agent: StewardAgent, definition: AgentEffectiveness | null): AgentEvidence =>
      agentEvidenceFrom(agent, definition),
    /** The audit trail for one agent. Manage access only, same as the edits. */
    history: (organizationId: ID, agentId: string) => {
      assertRoomManage("steward", "Steward", "Reading the agent audit trail");
      return intelligenceAudit.list({ organizationId, agentId, limit: 30 });
    },
  },
  ["list", "history"],
);
