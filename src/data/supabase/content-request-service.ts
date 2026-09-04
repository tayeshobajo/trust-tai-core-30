/**
 * Persistence for the Content Engine command layer.
 *
 * Two small stores: the material a person gave the room, and what they asked
 * it to write. Both are organization-scoped in the query as well as by RLS.
 * A missing table reads as an empty library rather than a crash, and writes
 * refuse with the migration named.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type { ContentSource, ContentSourceKind, ExtractionState } from "@/domain/content-source";
import type { ContentRequestSettings } from "@/domain/content-request";

type Row = Record<string, unknown>;

export const CONTENT_COMMAND_MIGRATION =
  "The Content Engine command layer is not in this database yet. Apply docs/content-engine-maya-schema.sql.";

export interface CommandContext {
  organizationId: ID;
  userId: ID;
}

export interface ContentRequestRecord {
  id: ID;
  organizationId: ID;
  prompt: string;
  keyword: string;
  postCount: number;
  settings: ContentRequestSettings | Record<string, unknown>;
  sourceIds: string[];
  state: "submitted" | "preparing" | "prepared" | "failed";
  because: string;
  batchId: string | null;
  createdAt: string;
}

function missingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: string } | null)?.message ?? "");
  return code === "42P01" || /does not exist|schema cache/i.test(message);
}

function fail(error: unknown): never {
  throw new Error(missingTable(error) ? CONTENT_COMMAND_MIGRATION : String((error as Error).message));
}

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function toSource(row: Row): ContentSource {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    kind: String(row["kind"] ?? "text") as ContentSourceKind,
    label: String(row["label"] ?? ""),
    origin: String(row["origin"] ?? ""),
    mimeType: String(row["mime_type"] ?? ""),
    byteSize: Number(row["byte_size"] ?? 0),
    extractedText: String(row["extracted_text"] ?? ""),
    extractionState: String(row["extraction_state"] ?? "pending") as ExtractionState,
    extractionNote: String(row["extraction_note"] ?? ""),
    provenance: (row["provenance"] ?? {}) as Record<string, unknown>,
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
    updatedAt: String(row["updated_at"] ?? new Date().toISOString()),
  };
}

function toRequest(row: Row): ContentRequestRecord {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    prompt: String(row["prompt"] ?? ""),
    keyword: String(row["keyword"] ?? ""),
    postCount: Number(row["post_count"] ?? 0),
    settings: (row["settings"] ?? {}) as Record<string, unknown>,
    sourceIds: Array.isArray(row["source_ids"]) ? (row["source_ids"] as string[]) : [],
    state: String(row["state"] ?? "submitted") as ContentRequestRecord["state"],
    because: String(row["because"] ?? ""),
    batchId: (row["batch_id"] as string | null) ?? null,
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
  };
}

export interface NewSource {
  kind: ContentSourceKind;
  label: string;
  origin: string;
  mimeType: string;
  byteSize: number;
  extractedText: string;
  extractionState: ExtractionState;
  extractionNote: string;
  provenance?: Record<string, unknown>;
}

export const contentCommandService = {
  /** Is the command layer's own store present? */
  async schemaReady(organizationId: ID): Promise<boolean> {
    const { error } = await supabase
      .from("content_sources")
      .select("id")
      .eq("organization_id", organizationId)
      .limit(1);
    return !error || !missingTable(error);
  },

  async listSources(organizationId: ID, limit = 60): Promise<ContentSource[]> {
    const { data, error } = await supabase
      .from("content_sources")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      if (missingTable(error)) return [];
      throw new Error(error.message);
    }
    return (data ?? []).map((row) => toSource(row as Row));
  },

  async addSource(context: CommandContext, input: NewSource): Promise<ContentSource> {
    const now = new Date().toISOString();
    const sourceId = id("csrc");
    const { error } = await supabase.from("content_sources").insert({
      id: sourceId,
      organization_id: context.organizationId,
      kind: input.kind,
      label: input.label,
      origin: input.origin,
      mime_type: input.mimeType,
      byte_size: input.byteSize,
      extracted_text: input.extractedText,
      extraction_state: input.extractionState,
      extraction_note: input.extractionNote,
      provenance: {
        ...(input.provenance ?? {}),
        importedBy: context.userId,
        importedAt: now,
      },
      created_by: context.userId,
      created_at: now,
      updated_at: now,
    });
    if (error) fail(error);

    const { data } = await supabase
      .from("content_sources")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("id", sourceId)
      .maybeSingle();
    if (!data) throw new Error(CONTENT_COMMAND_MIGRATION);
    return toSource(data as Row);
  },

  async removeSource(context: CommandContext, sourceId: ID): Promise<void> {
    const { error } = await supabase
      .from("content_sources")
      .delete()
      .eq("organization_id", context.organizationId)
      .eq("id", sourceId);
    if (error) fail(error);
  },

  /** What was asked for, before anything is written. Provenance starts here. */
  async recordRequest(
    context: CommandContext,
    input: {
      prompt: string;
      keyword: string;
      postCount: number;
      settings: ContentRequestSettings;
      sourceIds: string[];
    },
  ): Promise<ContentRequestRecord> {
    const now = new Date().toISOString();
    const requestId = id("creq");
    const { error } = await supabase.from("content_requests").insert({
      id: requestId,
      organization_id: context.organizationId,
      prompt: input.prompt,
      keyword: input.keyword,
      post_count: input.postCount,
      settings: input.settings,
      source_ids: input.sourceIds,
      state: "preparing",
      because: "Studio accepted the request and started preparing.",
      created_by: context.userId,
      created_at: now,
      updated_at: now,
    });
    if (error) fail(error);
    return {
      id: requestId,
      organizationId: context.organizationId,
      prompt: input.prompt,
      keyword: input.keyword,
      postCount: input.postCount,
      settings: input.settings,
      sourceIds: input.sourceIds,
      state: "preparing",
      because: "Studio accepted the request and started preparing.",
      batchId: null,
      createdAt: now,
    };
  },

  /** Close the loop: this request produced that canonical batch. */
  async settleRequest(
    context: CommandContext,
    requestId: ID,
    outcome: { state: "prepared" | "failed"; because: string; batchId?: string | null },
  ): Promise<void> {
    const { error } = await supabase
      .from("content_requests")
      .update({
        state: outcome.state,
        because: outcome.because,
        batch_id: outcome.batchId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", context.organizationId)
      .eq("id", requestId);
    if (error) fail(error);
  },

  async requestForBatch(organizationId: ID, batchId: ID): Promise<ContentRequestRecord | null> {
    const { data, error } = await supabase
      .from("content_requests")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("batch_id", batchId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (missingTable(error)) return null;
      throw new Error(error.message);
    }
    return data ? toRequest(data as Row) : null;
  },

  async listRequests(organizationId: ID, limit = 20): Promise<ContentRequestRecord[]> {
    const { data, error } = await supabase
      .from("content_requests")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      if (missingTable(error)) return [];
      throw new Error(error.message);
    }
    return (data ?? []).map((row) => toRequest(row as Row));
  },
};
