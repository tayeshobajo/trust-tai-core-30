/**
 * Persistence for Approvals, the suite's human judgment layer.
 *
 * Three tables, all governance: `approval_requests` (what was prepared and why
 * it needed a person), `approval_items` (the members of a batch) and
 * `approval_events` (the append-only trail of notes, decisions and handovers).
 * None of them holds a copy of a prospect, relationship, roadmap change,
 * project or post, only references and small audit snapshots.
 *
 * Every read is organization-scoped in the query as well as by RLS. A missing
 * table reads as an empty queue so the room still opens, and refuses to *write*
 * with the migration named rather than failing silently.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID, ISODateTime } from "@/domain/entities";
import {
  assertApprovalTransition,
  approvalSourceKey,
  summariseBatch,
  tabFilter,
  BOARD_COLUMNS,
  BOARD_COLUMN_STATUSES,
  OPEN_STATUSES,
  type ApprovalSort,
  type BoardColumn,
  type CategoryTab,
  type ApprovalCategory,
  type ApprovalDecision,
  type ApprovalEvent,
  type ApprovalEventKind,
  type ApprovalItem,
  type ApprovalItemState,
  type ApprovalRequest,
  type ApprovalSourceApp,
  type ApprovalStatus,
  type ApprovalType,
  type DownstreamResult,
  type ExceptionReason,
  type ImpactLevel,
  type SourceEntityRef,
  type UrgencyLevel,
} from "@/domain/approvals";

type Row = Record<string, unknown>;

const MISSING =
  "The Approvals ledger is not in this database yet. Apply docs/approvals-v1-schema.sql.";

export interface ApprovalsContext {
  organizationId: ID;
  userId: ID;
}

function text(row: Row, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function json<T>(row: Row, key: string, fallback: T): T {
  const value = row[key];
  return value === null || value === undefined ? fallback : (value as T);
}

function missingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: string } | null)?.message ?? "");
  return code === "42P01" || /does not exist|schema cache/i.test(message);
}

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/**
 * Key-order-independent comparison. Postgres jsonb reorders keys, so a payload
 * read back is never byte-identical to the one written; only the facts count.
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/* ------------------------------------------------------------- mapping */

function toRequest(row: Row, items: ApprovalItem[] = []): ApprovalRequest {
  const decision = json<ApprovalDecision | null>(row, "decision", null);
  const downstream = json<DownstreamResult | null>(row, "downstream", null);
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    sourceApp: (text(row, "source_app") ?? "ops") as ApprovalSourceApp,
    category: (text(row, "category") ?? "operations") as ApprovalCategory,
    approvalType: (text(row, "approval_type") ?? "delivery_change") as ApprovalType,
    title: text(row, "title") ?? "Untitled request",
    summary: text(row, "summary") ?? "",
    whyItNeedsYou: text(row, "why_it_needs_you") ?? "",
    status: (text(row, "status") ?? "needs_review") as ApprovalStatus,
    urgency: (text(row, "urgency") ?? "soon") as UrgencyLevel,
    impact: (text(row, "impact") ?? "medium") as ImpactLevel,
    sourceEntity: json<SourceEntityRef>(row, "source_entity", { type: "unknown", id: "unknown" }),
    submittedBy: json(row, "submitted_by", {
      type: "agent" as const,
      id: "system",
      label: "Trust Tai",
    }),
    sourceKey: text(row, "source_key") ?? "",
    requiredCapability: (text(row, "required_capability") ??
      "workspace.read") as ApprovalRequest["requiredCapability"],
    boundary: json(row, "boundary", { willDo: [] as string[], willNotDo: [] as string[] }),
    evidence: json(row, "evidence", []),
    payload: json<Record<string, unknown>>(row, "payload", {}),
    ...(items.length > 0 ? { batch: summariseBatch(items) } : {}),
    ...(decision ? { decision } : {}),
    revision: Number(row["revision"] ?? 1),
    ...(downstream ? { downstream } : {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
    updatedAt: String(row["updated_at"] ?? row["created_at"] ?? new Date().toISOString()),
  };
}

function toItem(row: Row): ApprovalItem {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    requestId: String(row["request_id"]),
    itemKey: text(row, "item_key") ?? String(row["id"]),
    title: text(row, "title") ?? "Untitled",
    state: (text(row, "state") ?? "ready") as ApprovalItemState,
    exceptionReasons: json<ExceptionReason[]>(row, "exception_reasons", []),
    facts: json<Record<string, unknown>>(row, "facts", {}),
    ...(row["source_entity"]
      ? { sourceEntity: json<SourceEntityRef>(row, "source_entity", { type: "", id: "" }) }
      : {}),
    position: Number(row["position"] ?? 0),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
    updatedAt: String(row["updated_at"] ?? row["created_at"] ?? new Date().toISOString()),
  };
}

function toEvent(row: Row): ApprovalEvent {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    requestId: String(row["request_id"]),
    kind: (text(row, "kind") ?? "note") as ApprovalEventKind,
    body: text(row, "body") ?? "",
    actor: json(row, "actor", { type: "system" as const, id: "system", label: "Trust Tai" }),
    metadata: json<Record<string, unknown>>(row, "metadata", {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
  };
}

/* ------------------------------------------------------------ submission */

/** What a source room hands to Approvals. Everything else is derived here. */
export interface ApprovalSubmission {
  sourceApp: ApprovalSourceApp;
  category: ApprovalCategory;
  approvalType: ApprovalType;
  title: string;
  summary: string;
  whyItNeedsYou: string;
  sourceEntity: SourceEntityRef;
  requiredCapability: ApprovalRequest["requiredCapability"];
  boundary: { willDo: string[]; willNotDo: string[] };
  urgency?: UrgencyLevel;
  impact?: ImpactLevel;
  status?: Extract<ApprovalStatus, "needs_review" | "needs_context" | "ready">;
  evidence?: ApprovalRequest["evidence"];
  payload?: Record<string, unknown>;
  submittedBy?: ApprovalRequest["submittedBy"];
  /** Discriminator when one entity can raise more than one kind of request. */
  aspect?: string;
  items?: Array<{
    itemKey: string;
    title: string;
    state: ApprovalItemState;
    exceptionReasons?: ExceptionReason[];
    facts?: Record<string, unknown>;
    sourceEntity?: SourceEntityRef;
  }>;
}

async function writeEvent(
  context: ApprovalsContext,
  requestId: ID,
  kind: ApprovalEventKind,
  body: string,
  actor: ApprovalEvent["actor"],
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase.from("approval_events").insert({
    id: id("apev"),
    organization_id: context.organizationId,
    request_id: requestId,
    kind,
    body,
    actor,
    metadata,
    created_at: new Date().toISOString(),
  });
  if (error && !missingTable(error)) throw new Error(error.message);
}

async function loadItems(context: ApprovalsContext, requestId: ID): Promise<ApprovalItem[]> {
  const { data, error } = await supabase
    .from("approval_items")
    .select("*")
    .eq("organization_id", context.organizationId)
    .eq("request_id", requestId)
    .order("position", { ascending: true });
  if (error) {
    if (missingTable(error)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as Row[]).map(toItem);
}


/* ------------------------------------------------------- paged board reads */

/**
 * One column's worth of the queue, asked for in the database rather than in
 * the browser.
 *
 * The board is built for hundreds of open decisions, so filtering, searching,
 * ordering and counting all happen server side and only a bounded page of rows
 * ever crosses the wire. Counts come from `count: exact` over the whole filtered
 * set, never from the rows on screen.
 */
export interface ApprovalPageQuery {
  tab: CategoryTab;
  /** The board column to read, or explicit statuses when not a column read. */
  column?: BoardColumn;
  statuses?: ApprovalStatus[];
  search?: string;
  sort?: ApprovalSort;
  limit?: number;
  offset?: number;
}

export interface ApprovalPage {
  rows: ApprovalRequest[];
  /** Everything matching the filter, not just this page. */
  total: number;
  hasMore: boolean;
  offset: number;
}

/** Escape the characters PostgREST's filter mini-language treats specially. */
function safeTerm(term: string): string {
  return term.replace(/[,()"\\%]/g, " ").trim();
}

function applyTab(query: PostgrestLike, tab: CategoryTab): PostgrestLike {
  if (tab === "all") return query;
  const filter = tabFilter(tab);
  const clauses: string[] = [];
  if (filter.sourceApps.length > 0) {
    clauses.push(`source_app.in.(${filter.sourceApps.join(",")})`);
  }
  if (filter.otherApps.length > 0 && filter.categories.length > 0) {
    clauses.push(
      `and(source_app.in.(${filter.otherApps.join(",")}),category.in.(${filter.categories.join(",")}))`,
    );
  }
  return clauses.length > 0 ? query.or(clauses.join(",")) : query;
}

function applySearch(query: PostgrestLike, search: string | undefined): PostgrestLike {
  const term = safeTerm(search ?? "");
  if (term.length === 0) return query;
  return query.or(
    [
      `title.ilike.%${term}%`,
      `summary.ilike.%${term}%`,
      `why_it_needs_you.ilike.%${term}%`,
    ].join(","),
  );
}

/** The minimum of the Supabase builder these helpers rely on. */
interface PostgrestLike {
  or: (expression: string) => PostgrestLike;
  in: (column: string, values: unknown[]) => PostgrestLike;
  eq: (column: string, value: unknown) => PostgrestLike;
  order: (column: string, options?: { ascending?: boolean }) => PostgrestLike;
  range: (from: number, to: number) => PostgrestLike;
}

/**
 * Server-side ordering.
 *
 * `priority` is an approximation of the in-memory rank the card list uses:
 * urgency first (now, soon, whenever sorts alphabetically in that order),
 * then the longest waiting. It is deliberately coarse rather than pretending
 * the database can reproduce a rank that reads irreversibility and batch
 * exceptions.
 */
function applySort(query: PostgrestLike, sort: ApprovalSort): PostgrestLike {
  if (sort === "newest") return query.order("created_at", { ascending: false });
  if (sort === "oldest") return query.order("created_at", { ascending: true });
  return query.order("urgency", { ascending: true }).order("created_at", { ascending: true });
}

function statusesFor(query: ApprovalPageQuery): ApprovalStatus[] {
  if (query.statuses?.length) return query.statuses;
  if (query.column) return BOARD_COLUMN_STATUSES[query.column];
  return OPEN_STATUSES;
}

export const approvalsService = {
  /**
   * Submit work for judgment, idempotently.
   *
   * The same source state resubmitted resolves to the same row: a retry, a
   * rerender or a second agent pass cannot flood the queue with duplicates. If
   * the existing row was already decided, it is left alone and returned, so a
   * late resubmit can never quietly reopen a closed decision.
   */
  async submit(context: ApprovalsContext, input: ApprovalSubmission): Promise<ApprovalRequest> {
    const sourceKey = approvalSourceKey({
      sourceApp: input.sourceApp,
      approvalType: input.approvalType,
      sourceEntity: input.sourceEntity,
      ...(input.aspect ? { aspect: input.aspect } : {}),
    });
    const now = new Date().toISOString();

    const existingRow = await supabase
      .from("approval_requests")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("source_key", sourceKey)
      .maybeSingle();

    if (existingRow.error && missingTable(existingRow.error)) {
      throw new Error(MISSING);
    }

    const submittedBy = input.submittedBy ?? {
      type: "agent" as const,
      id: "trust-tai",
      label: "Trust Tai",
    };

    const base = {
      organization_id: context.organizationId,
      source_app: input.sourceApp,
      category: input.category,
      approval_type: input.approvalType,
      title: input.title,
      summary: input.summary,
      why_it_needs_you: input.whyItNeedsYou,
      urgency: input.urgency ?? "soon",
      impact: input.impact ?? "medium",
      source_entity: input.sourceEntity,
      submitted_by: submittedBy,
      source_key: sourceKey,
      required_capability: input.requiredCapability,
      boundary: input.boundary,
      evidence: input.evidence ?? [],
      payload: input.payload ?? {},
      updated_at: now,
    };

    let requestId: string;
    let existing: ApprovalRequest | null = null;

    if (existingRow.data) {
      existing = toRequest(existingRow.data as Row);
      requestId = existing.id;

      /* A decided request is history. A resubmit does not reopen it. */
      if (
        !["needs_review", "needs_context", "ready", "revision_requested"].includes(existing.status)
      ) {
        const settled = await loadItems(context, requestId);
        return toRequest(existingRow.data as Row, settled);
      }
      /* A resubmit is only news when the work changed or a revision was asked
         for. Re-offering the identical request must leave the record exactly
         as it was, or the history stops meaning anything. */
      const afterRevision = existing.status === "revision_requested";
      const changed =
        afterRevision ||
        existing.title !== input.title ||
        existing.summary !== input.summary ||
        existing.whyItNeedsYou !== input.whyItNeedsYou ||
        stableJson(existing.payload ?? {}) !== stableJson(input.payload ?? {});

      const { error } = await supabase
        .from("approval_requests")
        .update({
          ...base,
          status: input.status ?? "needs_review",
          revision: afterRevision ? existing.revision + 1 : existing.revision,
        })
        .eq("organization_id", context.organizationId)
        .eq("id", requestId);
      if (error) throw new Error(missingTable(error) ? MISSING : error.message);

      if (changed) {
        await writeEvent(
          context,
          requestId,
          "resubmitted",
          afterRevision
            ? `${submittedBy.label} resubmitted this after a revision request.`
            : `${submittedBy.label} updated this before you decided.`,
          { type: submittedBy.type, id: submittedBy.id, label: submittedBy.label },
        );
      }
    } else {
      requestId = id("apr");
      const { error } = await supabase.from("approval_requests").insert({
        ...base,
        id: requestId,
        status: input.status ?? "needs_review",
        revision: 1,
        created_at: now,
      });
      if (error) throw new Error(missingTable(error) ? MISSING : error.message);

      await writeEvent(
        context,
        requestId,
        "submitted",
        input.whyItNeedsYou || `${submittedBy.label} prepared this for review.`,
        { type: submittedBy.type, id: submittedBy.id, label: submittedBy.label },
      );
    }

    /* Batch members are keyed too, so a resubmit updates rather than doubles. */
    const items: ApprovalItem[] = [];
    if (input.items?.length) {
      const current = await loadItems(context, requestId);
      const byKey = new Map(current.map((item) => [item.itemKey, item]));
      let position = 0;
      for (const item of input.items) {
        const known = byKey.get(item.itemKey);
        const row = {
          organization_id: context.organizationId,
          request_id: requestId,
          item_key: item.itemKey,
          title: item.title,
          state: item.state,
          exception_reasons: item.exceptionReasons ?? [],
          facts: item.facts ?? {},
          source_entity: item.sourceEntity ?? null,
          position: position++,
          updated_at: now,
        };
        if (known) {
          /* An already-decided item keeps its decision. */
          if (["approved", "rejected", "executed"].includes(known.state)) {
            items.push(known);
            continue;
          }
          const { error } = await supabase
            .from("approval_items")
            .update(row)
            .eq("organization_id", context.organizationId)
            .eq("id", known.id);
          if (error) throw new Error(missingTable(error) ? MISSING : error.message);
          items.push({ ...known, ...toItem({ ...row, id: known.id, created_at: known.createdAt }) });
        } else {
          const itemId = id("api");
          const { error } = await supabase
            .from("approval_items")
            .insert({ ...row, id: itemId, created_at: now });
          if (error) throw new Error(missingTable(error) ? MISSING : error.message);
          items.push(toItem({ ...row, id: itemId, created_at: now }));
        }
      }
    }

    const stored = await supabase
      .from("approval_requests")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("id", requestId)
      .maybeSingle();

    return toRequest((stored.data ?? {}) as Row, items);
  },

  /** The whole queue for this organization, newest first. Empty when unmigrated. */
  async list(context: ApprovalsContext): Promise<ApprovalRequest[]> {
    const { data, error } = await supabase
      .from("approval_requests")
      .select("*")
      .eq("organization_id", context.organizationId)
      .order("created_at", { ascending: false });
    if (error) {
      if (missingTable(error)) return [];
      throw new Error(error.message);
    }

    const rows = (data ?? []) as Row[];
    const itemRows = await supabase
      .from("approval_items")
      .select("*")
      .eq("organization_id", context.organizationId);
    const items = itemRows.error ? [] : ((itemRows.data ?? []) as Row[]).map(toItem);

    return rows.map((row) =>
      toRequest(
        row,
        items.filter((item) => item.requestId === String(row["id"])),
      ),
    );
  },

  /**
   * A bounded page of one column. Nothing outside the page is fetched, and the
   * batch summaries for the page are loaded in one extra query, never one per
   * card.
   */
  async listPage(context: ApprovalsContext, query: ApprovalPageQuery): Promise<ApprovalPage> {
    const limit = Math.max(1, Math.min(query.limit ?? 25, 100));
    const offset = Math.max(0, query.offset ?? 0);

    let builder = supabase
      .from("approval_requests")
      .select("*", { count: "exact" })
      .eq("organization_id", context.organizationId)
      .in("status", statusesFor(query)) as unknown as PostgrestLike;
    builder = applyTab(builder, query.tab);
    builder = applySearch(builder, query.search);
    builder = applySort(builder, query.sort ?? "priority").range(offset, offset + limit - 1);

    const { data, error, count } = (await (builder as unknown as PromiseLike<{
      data: unknown;
      error: unknown;
      count: number | null;
    }>)) as { data: unknown; error: unknown; count: number | null };

    if (error) {
      if (missingTable(error)) return { rows: [], total: 0, hasMore: false, offset };
      throw new Error((error as { message: string }).message);
    }

    const rows = (data ?? []) as Row[];
    const total = count ?? rows.length;

    /* One query for every batch on the page. No per-card lookup. */
    let items: ApprovalItem[] = [];
    if (rows.length > 0) {
      const itemRows = await supabase
        .from("approval_items")
        .select("*")
        .eq("organization_id", context.organizationId)
        .in(
          "request_id",
          rows.map((row) => String(row["id"])),
        );
      items = itemRows.error ? [] : ((itemRows.data ?? []) as Row[]).map(toItem);
    }

    return {
      rows: rows.map((row) =>
        toRequest(
          row,
          items.filter((item) => item.requestId === String(row["id"])),
        ),
      ),
      total,
      hasMore: offset + rows.length < total,
      offset,
    };
  },

  /** How many rows match, without reading any of them. */
  async count(
    context: ApprovalsContext,
    query: Omit<ApprovalPageQuery, "limit" | "offset" | "sort">,
  ): Promise<number> {
    let builder = supabase
      .from("approval_requests")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", context.organizationId)
      .in("status", statusesFor(query)) as unknown as PostgrestLike;
    builder = applyTab(builder, query.tab);
    builder = applySearch(builder, query.search);

    const { error, count } = (await (builder as unknown as PromiseLike<{
      error: unknown;
      count: number | null;
    }>)) as { error: unknown; count: number | null };
    if (error) {
      if (missingTable(error)) return 0;
      throw new Error((error as { message: string }).message);
    }
    return count ?? 0;
  },

  /** Open-decision totals per category tab, from counts rather than rows. */
  async tabTotals(
    context: ApprovalsContext,
    options: { search?: string } = {},
  ): Promise<Record<CategoryTab, number>> {
    const tabs: CategoryTab[] = ["marketing", "comms", "scout", "roadmap", "delivery"];
    const counted = await Promise.all(
      tabs.map((tab) =>
        this.count(context, { tab, ...(options.search ? { search: options.search } : {}) }),
      ),
    );
    const totals = { all: 0, marketing: 0, comms: 0, scout: 0, roadmap: 0, delivery: 0 } as Record<
      CategoryTab,
      number
    >;
    tabs.forEach((tab, index) => {
      totals[tab] = counted[index] ?? 0;
      totals.all += counted[index] ?? 0;
    });
    return totals;
  },

  /** Column totals for the tab on screen, from counts rather than rows. */
  async columnTotals(
    context: ApprovalsContext,
    options: { tab: CategoryTab; search?: string },
  ): Promise<Record<BoardColumn, number>> {
    const counted = await Promise.all(
      BOARD_COLUMNS.map((column) =>
        this.count(context, {
          tab: options.tab,
          column,
          ...(options.search ? { search: options.search } : {}),
        }),
      ),
    );
    const totals = {} as Record<BoardColumn, number>;
    BOARD_COLUMNS.forEach((column, index) => {
      totals[column] = counted[index] ?? 0;
    });
    return totals;
  },

  async get(
    context: ApprovalsContext,
    requestId: ID,
  ): Promise<{ request: ApprovalRequest; items: ApprovalItem[]; events: ApprovalEvent[] } | null> {
    const { data, error } = await supabase
      .from("approval_requests")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("id", requestId)
      .maybeSingle();
    if (error) {
      if (missingTable(error)) return null;
      throw new Error(error.message);
    }
    if (!data) return null;

    const items = await loadItems(context, requestId);
    const eventRows = await supabase
      .from("approval_events")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("request_id", requestId)
      .order("created_at", { ascending: false });
    const events = eventRows.error ? [] : ((eventRows.data ?? []) as Row[]).map(toEvent);

    return { request: toRequest(data as Row, items), items, events };
  },

  /**
   * Record a decision.
   *
   * The transition is asserted, not assumed, so nothing can reach an executed
   * state without a human having passed through `approved` first. Approving
   * writes the decision only. Execution is a separate, later act.
   */
  async decide(
    context: ApprovalsContext,
    input: {
      requestId: ID;
      to: ApprovalStatus;
      decision: ApprovalDecision;
      /** For a batch: only these child items were authorised. */
      itemIds?: ID[];
    },
  ): Promise<ApprovalRequest> {
    const current = await this.get(context, input.requestId);
    if (!current) throw new Error("That approval no longer exists.");

    assertApprovalTransition(current.request.status, input.to);

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("approval_requests")
      .update({ status: input.to, decision: input.decision, updated_at: now })
      .eq("organization_id", context.organizationId)
      .eq("id", input.requestId);
    if (error) throw new Error(missingTable(error) ? MISSING : error.message);

    if (input.itemIds?.length) {
      const nextState: ApprovalItemState =
        input.decision.decision === "approve" ? "approved" : "rejected";
      for (const itemId of input.itemIds) {
        const { error: itemError } = await supabase
          .from("approval_items")
          .update({ state: nextState, updated_at: now })
          .eq("organization_id", context.organizationId)
          .eq("id", itemId);
        if (itemError) throw new Error(itemError.message);
      }
    }

    await writeEvent(
      context,
      input.requestId,
      "decision",
      input.decision.reason ?? `${input.decision.decidedBy.label} recorded a decision.`,
      { type: "user", id: input.decision.decidedBy.id, label: input.decision.decidedBy.label },
      {
        decision: input.decision.decision,
        to: input.to,
        ...(input.itemIds ? { itemIds: input.itemIds } : {}),
      },
    );

    const after = await this.get(context, input.requestId);
    return after!.request;
  },

  /** Move state without a decision: a source app enriching context, say. */
  async setStatus(
    context: ApprovalsContext,
    requestId: ID,
    to: ApprovalStatus,
    because: string,
  ): Promise<void> {
    const current = await this.get(context, requestId);
    if (!current) throw new Error("That approval no longer exists.");
    assertApprovalTransition(current.request.status, to);

    const { error } = await supabase
      .from("approval_requests")
      .update({ status: to, updated_at: new Date().toISOString() })
      .eq("organization_id", context.organizationId)
      .eq("id", requestId);
    if (error) throw new Error(missingTable(error) ? MISSING : error.message);

    await writeEvent(context, requestId, "state_changed", because, {
      type: "system",
      id: "trust-tai",
      label: "Trust Tai",
    });
  },

  /** Record where an approved decision went, including "nowhere yet". */
  async recordDownstream(
    context: ApprovalsContext,
    requestId: ID,
    result: DownstreamResult,
    nextStatus?: Extract<ApprovalStatus, "queued" | "executed">,
  ): Promise<void> {
    const patch: Row = { downstream: result, updated_at: new Date().toISOString() };
    if (nextStatus) {
      const current = await this.get(context, requestId);
      if (current) assertApprovalTransition(current.request.status, nextStatus);
      patch["status"] = nextStatus;
    }
    const { error } = await supabase
      .from("approval_requests")
      .update(patch)
      .eq("organization_id", context.organizationId)
      .eq("id", requestId);
    if (error) throw new Error(missingTable(error) ? MISSING : error.message);

    await writeEvent(context, requestId, "downstream", result.because, {
      type: "system",
      id: result.adapterId,
      label: result.adapterId,
    });
  },

  async addNote(
    context: ApprovalsContext,
    requestId: ID,
    body: string,
    actor: { id: ID; label: string },
  ): Promise<void> {
    await writeEvent(context, requestId, "note", body, {
      type: "user",
      id: actor.id,
      label: actor.label,
    });
  },

  async events(context: ApprovalsContext, requestId: ID): Promise<ApprovalEvent[]> {
    const { data, error } = await supabase
      .from("approval_events")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("request_id", requestId)
      .order("created_at", { ascending: false });
    if (error) {
      if (missingTable(error)) return [];
      throw new Error(error.message);
    }
    return ((data ?? []) as Row[]).map(toEvent);
  },
};

/**
 * Is the ledger actually in this database?
 *
 * The room says so plainly rather than showing a convincing empty queue that
 * is really a missing migration.
 */
export async function approvalsSchemaReady(organizationId: ID): Promise<boolean> {
  const { error } = await supabase
    .from("approval_requests")
    .select("id")
    .eq("organization_id", organizationId)
    .limit(1);
  if (!error) return true;
  if (missingTable(error)) return false;
  throw new Error(error.message);
}

export const APPROVALS_MIGRATION = MISSING;

export type ApprovalsService = typeof approvalsService;

export type { ISODateTime };
