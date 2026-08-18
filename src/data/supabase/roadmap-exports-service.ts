/**
 * Roadmap client copies, execution links, and notes.
 *
 * These three tables are newer than the rest of the Roadmap schema, so every
 * read tolerates the table not existing yet and says so plainly instead of
 * blanking the page. Any other Postgrest error surfaces as itself.
 *
 * A client copy is frozen at creation. Nothing here rewrites a snapshot.
 */

import { guardRoomWrites } from "@/lib/room-authority";
import type { PostgrestError } from "@supabase/supabase-js";

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type {
  ExecutionLinkStatus,
  ExportSnapshot,
  ExportStatus,
  OwningApp,
  RoadmapDetailNote,
  RoadmapEvidenceInput,
  RoadmapEvidenceItem,
  RoadmapEvidenceKind,
  RoadmapExecutionLink,
  RoadmapExport,
} from "@/domain/roadmap-exports";

import { supabaseActivity } from "./activities";
import type { Row } from "./schema";

export interface ExportsContext {
  organizationId: ID;
  userId: ID;
  userLabel?: string | undefined;
}

/** True when the table has not been created in this backend yet. */
function missingTable(error: PostgrestError | null): boolean {
  if (!error) return false;
  const message = `${error.code ?? ""} ${error.message} ${error.details ?? ""}`;
  return /42P01|PGRST205|does not exist|schema cache/i.test(message);
}

function assertOk(error: PostgrestError | null): void {
  if (error) throw new Error(error.message);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** What a read returns when the migration has not been applied yet. */
export interface Availability<T> {
  available: boolean;
  items: T[];
}

const unavailable = <T>(): Availability<T> => ({ available: false, items: [] });

/* ----------------------------------------------------------------- mapping */

function toExport(row: Row): RoadmapExport {
  const status = (["draft", "ready", "sent", "superseded"] as ExportStatus[]).includes(
    row["status"] as ExportStatus,
  )
    ? (row["status"] as ExportStatus)
    : "draft";
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    roadmapId: String(row["roadmap_id"]),
    version: String(row["version"] ?? "1.0"),
    status,
    snapshot: (row["snapshot"] ?? {}) as ExportSnapshot,
    ...(text(row["created_by"]) ? { createdBy: text(row["created_by"])! } : {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
    ...(text(row["sent_at"]) ? { sentAt: text(row["sent_at"])! } : {}),
    ...(text(row["comms_relationship_id"])
      ? { commsRelationshipId: text(row["comms_relationship_id"])! }
      : {}),
    ...(text(row["comms_draft_id"]) ? { commsDraftId: text(row["comms_draft_id"])! } : {}),
    ...(text(row["comms_message_id"]) ? { commsMessageId: text(row["comms_message_id"])! } : {}),
  };
}

function toLink(row: Row): RoadmapExecutionLink {
  const status = (
    ["requested", "accepted", "in_progress", "complete", "withdrawn"] as ExecutionLinkStatus[]
  ).includes(row["status"] as ExecutionLinkStatus)
    ? (row["status"] as ExecutionLinkStatus)
    : "requested";
  const app = (["projects", "ops", "studio"] as OwningApp[]).includes(
    row["owning_app"] as OwningApp,
  )
    ? (row["owning_app"] as OwningApp)
    : "projects";
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    roadmapId: String(row["roadmap_id"]),
    milestoneId: String(row["milestone_id"]),
    owningApp: app,
    ...(text(row["project_id"]) ? { projectId: text(row["project_id"])! } : {}),
    ...(text(row["ops_reference"]) ? { opsReference: text(row["ops_reference"])! } : {}),
    status,
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
  };
}

function toNote(row: Row): RoadmapDetailNote {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    roadmapId: String(row["roadmap_id"]),
    body: String(row["body"] ?? ""),
    ...(text(row["author_user_id"]) ? { authorUserId: text(row["author_user_id"])! } : {}),
    ...(text(row["author_label"]) ? { authorLabel: text(row["author_label"])! } : {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
  };
}

const EVIDENCE_KINDS: RoadmapEvidenceKind[] = ["page", "provider", "human", "computed"];

function toEvidence(row: Row): RoadmapEvidenceItem {
  const kind = EVIDENCE_KINDS.includes(row["kind"] as RoadmapEvidenceKind)
    ? (row["kind"] as RoadmapEvidenceKind)
    : "page";
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    roadmapId: String(row["roadmap_id"]),
    ...(text(row["milestone_id"]) ? { milestoneId: text(row["milestone_id"])! } : {}),
    label: String(row["label"] ?? ""),
    ...(text(row["url"]) ? { url: text(row["url"])! } : {}),
    kind,
    ...(text(row["source_note"]) ? { sourceNote: text(row["source_note"])! } : {}),
    ...(text(row["observed_at"]) ? { observedAt: text(row["observed_at"])! } : {}),
    ...(text(row["created_by"]) ? { createdBy: text(row["created_by"])! } : {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
  };
}

/* ----------------------------------------------------------------- service */

const roadmapExportsServiceRaw = {
  async listExports(roadmapId: ID): Promise<Availability<RoadmapExport>> {
    const { data, error } = await supabase
      .from("roadmap_exports")
      .select("*")
      .eq("roadmap_id", roadmapId)
      .order("created_at", { ascending: false });
    if (missingTable(error)) return unavailable<RoadmapExport>();
    assertOk(error);
    return { available: true, items: ((data ?? []) as Row[]).map(toExport) };
  },

  async createExport(
    input: { roadmapId: ID; version: string; snapshot: ExportSnapshot; subjectLabel: string },
    context: ExportsContext,
  ): Promise<RoadmapExport> {
    const { data, error } = await supabase
      .from("roadmap_exports")
      .insert({
        organization_id: context.organizationId,
        roadmap_id: input.roadmapId,
        version: input.version,
        status: "ready",
        snapshot: input.snapshot as unknown as Row,
        created_by: context.userId,
      })
      .select("*")
      .maybeSingle();
    if (missingTable(error)) {
      throw new Error(
        "Client copies are not set up in this backend yet. Apply docs/roadmap-exports-schema.sql.",
      );
    }
    assertOk(error);
    const created = toExport((data ?? {}) as Row);

    await supabaseActivity
      .record({
        organizationId: context.organizationId,
        name: "roadmap.published",
        subject: { type: "roadmap", id: input.roadmapId, label: input.subjectLabel },
        summary: `Client copy ${input.version} created for ${input.subjectLabel}.`,
        payload: { version: input.version, export_id: created.id },
        provenance: {
          appId: "roadmap",
          actor: {
            type: "user",
            id: context.userId,
            ...(context.userLabel ? { label: context.userLabel } : {}),
          },
          observedAt: new Date().toISOString(),
        },
        occurredAt: new Date().toISOString(),
      })
      .catch(() => undefined);

    return created;
  },

  async markSent(exportId: ID, context: ExportsContext): Promise<void> {
    const { error } = await supabase
      .from("roadmap_exports")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", exportId)
      .eq("organization_id", context.organizationId);
    assertOk(error);
  },

  async listLinks(roadmapId: ID): Promise<Availability<RoadmapExecutionLink>> {
    const { data, error } = await supabase
      .from("roadmap_execution_links")
      .select("*")
      .eq("roadmap_id", roadmapId);
    if (missingTable(error)) return unavailable<RoadmapExecutionLink>();
    assertOk(error);
    return { available: true, items: ((data ?? []) as Row[]).map(toLink) };
  },

  async linkExecution(
    input: { roadmapId: ID; milestoneId: ID; owningApp: OwningApp; projectId?: ID },
    context: ExportsContext,
  ): Promise<RoadmapExecutionLink | null> {
    const { data, error } = await supabase
      .from("roadmap_execution_links")
      .insert({
        organization_id: context.organizationId,
        roadmap_id: input.roadmapId,
        milestone_id: input.milestoneId,
        owning_app: input.owningApp,
        ...(input.projectId ? { project_id: input.projectId } : {}),
        status: "requested",
        created_by: context.userId,
      })
      .select("*")
      .maybeSingle();
    // The link is correlation, never the source of truth for the work itself:
    // a backend without the table must not block the handoff.
    if (missingTable(error)) return null;
    if (error && /duplicate key/i.test(error.message)) return null;
    assertOk(error);
    return data ? toLink(data as Row) : null;
  },

  async listNotes(roadmapId: ID): Promise<Availability<RoadmapDetailNote>> {
    const { data, error } = await supabase
      .from("roadmap_notes")
      .select("*")
      .eq("roadmap_id", roadmapId)
      .order("created_at", { ascending: false });
    if (missingTable(error)) return unavailable<RoadmapDetailNote>();
    assertOk(error);
    return { available: true, items: ((data ?? []) as Row[]).map(toNote) };
  },

  async addNote(
    input: { roadmapId: ID; body: string },
    context: ExportsContext,
  ): Promise<RoadmapDetailNote> {
    const { data, error } = await supabase
      .from("roadmap_notes")
      .insert({
        organization_id: context.organizationId,
        roadmap_id: input.roadmapId,
        body: input.body.trim(),
        author_user_id: context.userId,
        ...(context.userLabel ? { author_label: context.userLabel } : {}),
      })
      .select("*")
      .maybeSingle();
    if (missingTable(error)) {
      throw new Error(
        "Roadmap notes are not set up in this backend yet. Apply docs/roadmap-exports-schema.sql.",
      );
    }
    assertOk(error);
    return toNote((data ?? {}) as Row);
  },
  /* --------------------------------------------------------------- evidence */

  async listEvidence(roadmapId: ID): Promise<Availability<RoadmapEvidenceItem>> {
    const { data, error } = await supabase
      .from("roadmap_evidence")
      .select("*")
      .eq("roadmap_id", roadmapId)
      .order("created_at", { ascending: false });
    if (missingTable(error)) return unavailable<RoadmapEvidenceItem>();
    assertOk(error);
    return { available: true, items: ((data ?? []) as Row[]).map(toEvidence) };
  },

  /** A person links a real proof point. Nothing is generated on their behalf. */
  async addEvidence(
    roadmapId: ID,
    input: RoadmapEvidenceInput,
    context: ExportsContext,
  ): Promise<RoadmapEvidenceItem> {
    const label = input.label.trim();
    if (!label) throw new Error("Give this proof point a label first.");
    const { data, error } = await supabase
      .from("roadmap_evidence")
      .insert({
        organization_id: context.organizationId,
        roadmap_id: roadmapId,
        label,
        kind: input.kind,
        ...(input.url?.trim() ? { url: input.url.trim() } : {}),
        ...(input.sourceNote?.trim() ? { source_note: input.sourceNote.trim() } : {}),
        ...(input.milestoneId ? { milestone_id: input.milestoneId } : {}),
        observed_at: new Date().toISOString(),
        created_by: context.userId,
      })
      .select("*")
      .maybeSingle();
    if (missingTable(error)) {
      throw new Error(
        "Roadmap evidence is not set up in this backend yet. Apply docs/roadmap-exports-schema.sql.",
      );
    }
    assertOk(error);
    return toEvidence((data ?? {}) as Row);
  },

  async updateEvidence(
    id: ID,
    input: RoadmapEvidenceInput,
    context: ExportsContext,
  ): Promise<RoadmapEvidenceItem> {
    const label = input.label.trim();
    if (!label) throw new Error("Give this proof point a label first.");
    const { data, error } = await supabase
      .from("roadmap_evidence")
      .update({
        label,
        kind: input.kind,
        url: input.url?.trim() || null,
        source_note: input.sourceNote?.trim() || null,
        milestone_id: input.milestoneId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .select("*")
      .maybeSingle();
    assertOk(error);
    if (!data) throw new Error("That proof point could not be updated.");
    return toEvidence(data as Row);
  },

  async removeEvidence(id: ID, context: ExportsContext): Promise<void> {
    const { error } = await supabase
      .from("roadmap_evidence")
      .delete()
      .eq("id", id)
      .eq("organization_id", context.organizationId);
    assertOk(error);
  },

  /* -------------------------------------------------- execution link status */

  /**
   * Roadmap never owns delivery state. This mirrors what the owning room
   * already says, so the roadmap can show progress read-only.
   */
  async setLinkStatus(
    link: RoadmapExecutionLink,
    status: ExecutionLinkStatus,
    context: ExportsContext,
  ): Promise<void> {
    if (link.status === status) return;
    const { error } = await supabase
      .from("roadmap_execution_links")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", link.id)
      .eq("organization_id", context.organizationId);
    if (missingTable(error)) return;
    assertOk(error);
  },

  /* ------------------------------------------------------ export → Comms */

  /** Record which Comms conversation and draft carry a client copy. */
  async attachComms(
    exportId: ID,
    input: { relationshipId: ID; draftId: ID },
    context: ExportsContext,
  ): Promise<void> {
    const { error } = await supabase
      .from("roadmap_exports")
      .update({
        comms_relationship_id: input.relationshipId,
        comms_draft_id: input.draftId,
      })
      .eq("id", exportId)
      .eq("organization_id", context.organizationId);
    assertOk(error);
  },
};

export const roadmapExportsService = guardRoomWrites(
  "roadmap",
  "Roadmap",
  roadmapExportsServiceRaw,
  ["listExports", "listLinks", "listNotes", "listEvidence"],
);
