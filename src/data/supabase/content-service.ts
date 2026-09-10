/**
 * Persistence for the Content Engine (Studio).
 *
 * This is the canonical home of an article: its brief, its draft, its SEO,
 * its image state, its publish receipt and its verification. Approvals holds
 * a pointer and a decision; it never holds the post. Every read is
 * organization-scoped in the query as well as by RLS, and a missing table
 * reads as an empty room rather than a crash, while writes refuse with the
 * migration named.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type { ExceptionReason } from "@/domain/approvals";
import {
  assertItemTransition,
  publishKeyFor,
  type ContentBatch,
  type ContentBatchState,
  type ContentGeneration,
  type ContentItem,
  type ContentItemState,
  type ContentPublish,
  type ContentVerification,
  type EditorialStep,
} from "@/domain/content";

type Row = Record<string, unknown>;

export const CONTENT_MIGRATION =
  "The Content Engine store is not in this database yet. Apply docs/content-engine-schema.sql.";

export interface ContentContext {
  organizationId: ID;
  userId: ID;
}

function missingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: string } | null)?.message ?? "");
  return code === "42P01" || /does not exist|schema cache/i.test(message);
}

function fail(error: unknown): never {
  throw new Error(missingTable(error) ? CONTENT_MIGRATION : String((error as Error).message));
}

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function json<T>(row: Row, key: string, fallback: T): T {
  const value = row[key];
  return value === null || value === undefined ? fallback : (value as T);
}

function str(row: Row, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

/* ---------------------------------------------------------------- mapping */

function toBatch(row: Row): ContentBatch {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    keyword: str(row, "keyword"),
    state: (str(row, "state") || "preparing") as ContentBatchState,
    topicCluster: json<string[]>(row, "topic_cluster", []),
    searchIntent: str(row, "search_intent"),
    audienceProblem: str(row, "audience_problem"),
    editorialPlan: json<EditorialStep[]>(row, "editorial_plan", []),
    whyTogether: str(row, "why_together"),
    provenance: json<Record<string, unknown>>(row, "provenance", {}),
    createdBy: (row["created_by"] as string | null) ?? null,
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
    updatedAt: String(row["updated_at"] ?? new Date().toISOString()),
  };
}

function toItem(row: Row): ContentItem {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    batchId: String(row["batch_id"]),
    position: Number(row["position"] ?? 0),
    slug: str(row, "slug"),
    title: str(row, "title"),
    angle: str(row, "angle"),
    readerJob: str(row, "reader_job"),
    brief: json(row, "brief", { outline: [], mustCover: [], sources: [] }),
    draftMarkdown: str(row, "draft_markdown"),
    hitRationale: str(row, "hit_rationale"),
    seo: json(row, "seo", { title: "", metaDescription: "", slug: "" }),
    internalLinks: json(row, "internal_links", []),
    cta: json(row, "cta", { readerNeed: "", offer: "", line: "" }),
    taxonomy: json(row, "taxonomy", { category: "", tags: [] }),
    image: json(row, "image", {
      state: "pending" as const,
      brief: "",
      altText: "",
      assetUrl: null,
      provider: null,
    }),
    generation: json<ContentGeneration | null>(row, "generation", null),
    state: (str(row, "state") || "preparing") as ContentItemState,
    exceptionReasons: json<ExceptionReason[]>(row, "exception_reasons", []),
    failureReason: (row["failure_reason"] as string | null) ?? null,
    publishKey: str(row, "publish_key"),
    publish: json<ContentPublish>(row, "publish", { state: "none" }),
    verification: json<ContentVerification>(row, "verification", {
      state: "unverified",
      because: "Not checked yet.",
    }),
    externalPostId: (row["external_post_id"] as string | null) ?? null,
    canonicalUrl: (row["canonical_url"] as string | null) ?? null,
    publishedAt: (row["published_at"] as string | null) ?? null,
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
    updatedAt: String(row["updated_at"] ?? new Date().toISOString()),
  };
}

/* ---------------------------------------------------------------- writing */

export interface NewBatch {
  keyword: string;
  topicCluster: string[];
  searchIntent: string;
  audienceProblem: string;
  editorialPlan: EditorialStep[];
  whyTogether: string;
  provenance: Record<string, unknown>;
}

export interface NewItem {
  position: number;
  slug: string;
  title: string;
  angle: string;
  readerJob: string;
  brief: ContentItem["brief"];
  draftMarkdown: string;
  hitRationale: string;
  seo: ContentItem["seo"];
  internalLinks: ContentItem["internalLinks"];
  cta: ContentItem["cta"];
  taxonomy: ContentItem["taxonomy"];
  image: ContentItem["image"];
  generation: ContentGeneration | null;
  state: Extract<ContentItemState, "ready" | "exception" | "failed">;
  exceptionReasons: ExceptionReason[];
  failureReason?: string | null;
}

export const contentService = {
  async schemaReady(organizationId: ID): Promise<boolean> {
    const { error } = await supabase
      .from("content_batches")
      .select("id")
      .eq("organization_id", organizationId)
      .limit(1);
    return !error || !missingTable(error);
  },

  async createBatch(context: ContentContext, input: NewBatch): Promise<ContentBatch> {
    const now = new Date().toISOString();
    const batchId = id("cbat");
    const { error } = await supabase.from("content_batches").insert({
      id: batchId,
      organization_id: context.organizationId,
      keyword: input.keyword,
      state: "preparing",
      topic_cluster: input.topicCluster,
      search_intent: input.searchIntent,
      audience_problem: input.audienceProblem,
      editorial_plan: input.editorialPlan,
      why_together: input.whyTogether,
      provenance: input.provenance,
      created_by: context.userId,
      created_at: now,
      updated_at: now,
    });
    if (error) fail(error);
    const batch = await this.getBatch(context, batchId);
    if (!batch) throw new Error(CONTENT_MIGRATION);
    return batch.batch;
  },

  async setBatchState(
    context: ContentContext,
    batchId: ID,
    state: ContentBatchState,
  ): Promise<void> {
    const { error } = await supabase
      .from("content_batches")
      .update({ state, updated_at: new Date().toISOString() })
      .eq("organization_id", context.organizationId)
      .eq("id", batchId);
    if (error) fail(error);
  },

  /** Write one prepared post. Keyed by slug, so a rerun updates rather than doubles. */
  async saveItem(context: ContentContext, batchId: ID, input: NewItem): Promise<ContentItem> {
    const now = new Date().toISOString();
    const existing = await supabase
      .from("content_items")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("batch_id", batchId)
      .eq("slug", input.slug)
      .maybeSingle();
    if (existing.error && missingTable(existing.error)) fail(existing.error);

    const row = {
      organization_id: context.organizationId,
      batch_id: batchId,
      position: input.position,
      slug: input.slug,
      title: input.title,
      angle: input.angle,
      reader_job: input.readerJob,
      brief: input.brief,
      draft_markdown: input.draftMarkdown,
      hit_rationale: input.hitRationale,
      seo: input.seo,
      internal_links: input.internalLinks,
      cta: input.cta,
      taxonomy: input.taxonomy,
      image: input.image,
      generation: input.generation,
      state: input.state,
      exception_reasons: input.exceptionReasons,
      failure_reason: input.failureReason ?? null,
      publish_key: publishKeyFor(batchId, input.slug),
      updated_at: now,
    };

    if (existing.data) {
      const current = toItem(existing.data as Row);
      /* A post a person already decided on is history. A rerun leaves it. */
      if (current.state !== "preparing" && current.state !== "ready" && current.state !== "exception" && current.state !== "failed") {
        return current;
      }
      const { error } = await supabase
        .from("content_items")
        .update(row)
        .eq("organization_id", context.organizationId)
        .eq("id", current.id);
      if (error) fail(error);
      return toItem({ ...(existing.data as Row), ...row });
    }

    const itemId = id("citm");
    const { error } = await supabase
      .from("content_items")
      .insert({ ...row, id: itemId, publish: { state: "none" }, verification: { state: "unverified", because: "Not checked yet." }, created_at: now });
    if (error) fail(error);
    return toItem({ ...row, id: itemId, created_at: now });
  },

  /* ---------------------------------------------------------------- reads */

  async listBatches(context: ContentContext, limit = 20): Promise<ContentBatch[]> {
    const { data, error } = await supabase
      .from("content_batches")
      .select("*")
      .eq("organization_id", context.organizationId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      if (missingTable(error)) return [];
      fail(error);
    }
    return ((data ?? []) as Row[]).map(toBatch);
  },

  async getBatch(
    context: ContentContext,
    batchId: ID,
  ): Promise<{ batch: ContentBatch; items: ContentItem[] } | null> {
    const { data, error } = await supabase
      .from("content_batches")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("id", batchId)
      .maybeSingle();
    if (error) {
      if (missingTable(error)) return null;
      fail(error);
    }
    if (!data) return null;
    return { batch: toBatch(data as Row), items: await this.listItems(context, batchId) };
  },

  async listItems(context: ContentContext, batchId: ID): Promise<ContentItem[]> {
    const { data, error } = await supabase
      .from("content_items")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("batch_id", batchId)
      .order("position", { ascending: true });
    if (error) {
      if (missingTable(error)) return [];
      fail(error);
    }
    return ((data ?? []) as Row[]).map(toItem);
  },

  async getItem(context: ContentContext, itemId: ID): Promise<ContentItem | null> {
    const { data, error } = await supabase
      .from("content_items")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("id", itemId)
      .maybeSingle();
    if (error) {
      if (missingTable(error)) return null;
      fail(error);
    }
    return data ? toItem(data as Row) : null;
  },

  /* -------------------------------------------------------------- states */

  /** Move one post, asserting the transition. Fails closed on an illegal move. */
  async setItemState(
    context: ContentContext,
    itemId: ID,
    to: ContentItemState,
  ): Promise<ContentItem> {
    const current = await this.getItem(context, itemId);
    if (!current) throw new Error("That post is no longer in this workspace.");
    assertItemTransition(current.state, to);
    const { error } = await supabase
      .from("content_items")
      .update({ state: to, updated_at: new Date().toISOString() })
      .eq("organization_id", context.organizationId)
      .eq("id", itemId);
    if (error) fail(error);
    return { ...current, state: to };
  },

  /**
   * Record the human decision on children of a batch, by slug.
   *
   * Approvals owns the decision; this writes what the decision means in the
   * room that owns the article. Nothing else may put a post into `approved`.
   */
  async applyChildDecisions(
    context: ContentContext,
    batchId: ID,
    decisions: { slug: string; decision: "approve" | "reject" | "request_revision" }[],
  ): Promise<ContentItem[]> {
    const items = await this.listItems(context, batchId);
    const bySlug = new Map(items.map((item) => [item.slug, item]));
    const changed: ContentItem[] = [];
    for (const entry of decisions) {
      const item = bySlug.get(entry.slug);
      if (!item) continue;
      const to: ContentItemState =
        entry.decision === "approve"
          ? "approved"
          : entry.decision === "reject"
            ? "rejected"
            : "revision_requested";
      if (item.state === to) continue;
      if (!["ready", "exception", "failed"].includes(item.state)) continue;
      changed.push(await this.setItemState(context, item.id, to));
    }
    return changed;
  },

  /**
   * Accept the posts a person authorised in Approvals into the publish queue.
   *
   * Approved and queued stay distinct: approving records the judgment, and
   * queuing is Studio accepting the work. Anything not named here is left
   * exactly where it was, and a post already past the queue is not moved back.
   */
  async queueApproved(context: ContentContext, batchId: ID, itemIds: ID[]): Promise<number> {
    const items = await this.listItems(context, batchId);
    const wanted = new Set(itemIds);
    let queued = 0;
    for (const item of items) {
      if (!wanted.has(item.id)) continue;
      if (item.state === "queued") {
        queued += 1;
        continue;
      }
      let current = item;
      if (["ready", "exception", "failed"].includes(current.state)) {
        current = await this.setItemState(context, current.id, "approved");
      }
      if (current.state !== "approved") continue;
      await this.setItemState(context, current.id, "queued");
      queued += 1;
    }
    return queued;
  },

  /* ------------------------------------------------------------- publish */


  async recordAttempt(
    context: ContentContext,
    item: ContentItem,
    input: { state: "attempted" | "executed" | "failed"; provider: string; because: string; receipt?: Record<string, unknown> },
  ): Promise<void> {
    const { error } = await supabase.from("content_publish_attempts").insert({
      id: id("cpub"),
      organization_id: context.organizationId,
      item_id: item.id,
      publish_key: item.publishKey,
      state: input.state,
      provider: input.provider,
      because: input.because,
      receipt: input.receipt ?? {},
      created_at: new Date().toISOString(),
    });
    if (error && !missingTable(error)) throw new Error(error.message);
  },

  async savePublishResult(
    context: ContentContext,
    itemId: ID,
    input: {
      publish: ContentPublish;
      externalPostId?: string | null;
      canonicalUrl?: string | null;
      publishedAt?: string | null;
    },
  ): Promise<void> {
    const { error } = await supabase
      .from("content_items")
      .update({
        publish: input.publish,
        external_post_id: input.externalPostId ?? null,
        canonical_url: input.canonicalUrl ?? null,
        published_at: input.publishedAt ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", context.organizationId)
      .eq("id", itemId);
    if (error) fail(error);
  },

  async saveVerification(
    context: ContentContext,
    itemId: ID,
    verification: ContentVerification,
  ): Promise<void> {
    const { error } = await supabase
      .from("content_items")
      .update({ verification, updated_at: new Date().toISOString() })
      .eq("organization_id", context.organizationId)
      .eq("id", itemId);
    if (error) fail(error);
  },

  /** The live post already recorded against this transport key, if any. */
  async byPublishKey(context: ContentContext, publishKey: string): Promise<ContentItem | null> {
    const { data, error } = await supabase
      .from("content_items")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("publish_key", publishKey)
      .maybeSingle();
    if (error) {
      if (missingTable(error)) return null;
      fail(error);
    }
    return data ? toItem(data as Row) : null;
  },
};
