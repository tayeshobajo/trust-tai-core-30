/**
 * Revenue Ops today view.
 *
 * This is the read model for the daily operating loop: revenue target, actual
 * activity, queues, and blockers. It is intentionally read-only and uses the
 * browser Supabase client, so every answer still passes through RLS as the
 * signed-in person. A source that cannot be read is reported as unavailable,
 * never collapsed into a quiet zero.
 */

import { supabaseActivity } from "@/data/supabase/activities";
import {
  ACTIVITY_STREAMS,
  listActivityTargets,
  type ActivityCadence,
  type ActivityStream,
  type ActivityTargetRecord,
} from "@/data/supabase/activity-targets";
import {
  listClientCommercialState,
  readOrganizationWeeklyTargets,
  readWeeklyScoreboard,
  type ClientCommercialRecord,
  type WeeklyScoreboard,
} from "@/data/supabase/commercial-service";
import {
  RELATIONSHIP_COLUMNS,
  toRelationship,
  type RelationshipRow,
} from "@/data/supabase/comms-schema";
import { dueState, type Relationship } from "@/domain/comms";
import type { ActivityEvent } from "@/domain/activity";
import type { ID, ISODateTime } from "@/domain/entities";
import type { WeeklyTargets } from "@/domain/weekly-targets";
import { supabase } from "@/integrations/trust-tai/supabase";

type Row = Record<string, unknown>;

export interface RevenueSource<T> {
  available: boolean;
  value: T | null;
  because?: string;
}

async function sourced<T>(read: () => Promise<T>): Promise<RevenueSource<T>> {
  try {
    return { available: true, value: await read() };
  } catch (error) {
    return {
      available: false,
      value: null,
      because: error instanceof Error ? error.message : "That source could not be read.",
    };
  }
}

function unavailable<T>(because?: string): RevenueSource<T> {
  return {
    available: false,
    value: null,
    ...(because ? { because } : {}),
  };
}

function assertOk(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function startOfLocalDayISO(now: Date): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

function startOfLocalWeekISO(now: Date): string {
  const day = (now.getDay() + 6) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - day).toISOString();
}

const ACTIVITY_DEFAULTS: Record<ActivityStream, { targetCount: number; cadence: ActivityCadence }> =
  {
    linkedin_connections: { targetCount: 10, cadence: "day" },
    blog_posts: { targetCount: 2, cadence: "day" },
    scout_intros: { targetCount: 15, cadence: "week" },
  };

export interface ActivityStreamActual {
  stream: ActivityStream;
  targetCount: number;
  cadence: ActivityCadence;
  actual: number | null;
  actualWindow: "today" | "this_week";
  source: string;
}

export interface ActivityActuals {
  streams: ActivityStreamActual[];
  linkedInSendsToday: number | null;
  insightsPublishedToday: number | null;
  scoutIntrosSentThisWeek: number | null;
}

async function countLinkedInSendsToday(organizationId: ID, now: Date): Promise<number> {
  const { count, error } = await supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("event_type", "zenmode.connection_sent")
    .gte("payload->>sent_at", startOfLocalDayISO(now));
  assertOk(error);
  return count ?? 0;
}

async function countInsightsPublishedToday(organizationId: ID, now: Date): Promise<number> {
  const { count, error } = await supabase
    .from("content_items")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("published_at", startOfLocalDayISO(now));
  assertOk(error);
  return count ?? 0;
}

async function countScoutIntrosSentThisWeek(organizationId: ID, now: Date): Promise<number> {
  const { count, error } = await supabase
    .from("comms_drafts")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("register", "scout_intro")
    .eq("review_state", "sent")
    .gte("updated_at", startOfLocalWeekISO(now));
  assertOk(error);
  return count ?? 0;
}

async function readActivityActuals(
  organizationId: ID,
  targets: ActivityTargetRecord[],
  now: Date,
): Promise<ActivityActuals> {
  const [linkedInSendsToday, insightsPublishedToday, scoutIntrosSentThisWeek] = await Promise.all([
    countLinkedInSendsToday(organizationId, now),
    countInsightsPublishedToday(organizationId, now),
    countScoutIntrosSentThisWeek(organizationId, now),
  ]);

  const byStream = new Map(targets.map((target) => [target.stream, target]));
  const streams = ACTIVITY_STREAMS.map((stream) => {
    const target = byStream.get(stream);
    const configured = target ?? { stream, ...ACTIVITY_DEFAULTS[stream] };
    if (stream === "linkedin_connections") {
      return {
        stream,
        targetCount: configured.targetCount,
        cadence: configured.cadence,
        actual: linkedInSendsToday,
        actualWindow: "today" as const,
        source: "ZenMode activity mirror",
      };
    }
    if (stream === "blog_posts") {
      return {
        stream,
        targetCount: configured.targetCount,
        cadence: configured.cadence,
        actual: insightsPublishedToday,
        actualWindow: "today" as const,
        source: "Studio publish ledger",
      };
    }
    return {
      stream,
      targetCount: configured.targetCount,
      cadence: configured.cadence,
      actual: scoutIntrosSentThisWeek,
      actualWindow: "this_week" as const,
      source: "Comms draft ledger",
    };
  });

  return { streams, linkedInSendsToday, insightsPublishedToday, scoutIntrosSentThisWeek };
}

export interface ClientRevenueSummary {
  currentMrrCents: number;
  targetMrrCents: number | null;
  gapCents: number | null;
  runClients: number;
  clientsTotal: number;
  clientsWithoutMrr: { id: ID; name: string; tier: string | null }[];
  reviewsOverdue: { id: ID; name: string; dueAt: ISODateTime }[];
  renewalsSoon: { id: ID; name: string; dueAt: ISODateTime; daysAway: number }[];
}

function mrr(client: ClientCommercialRecord): number {
  return typeof client.mrrCents === "number" && Number.isFinite(client.mrrCents)
    ? Math.trunc(client.mrrCents)
    : 0;
}

function readClientRevenue(
  clients: ClientCommercialRecord[],
  targets: WeeklyTargets,
  now: Date,
): ClientRevenueSummary {
  const currentMrrCents = clients.reduce(
    (sum, client) => (client.tier === "run" ? sum + mrr(client) : sum),
    0,
  );
  const targetMrrCents = targets.revenueTargetCents;
  const dayStart = new Date(startOfLocalDayISO(now)).getTime();
  const thirtyDays = dayStart + 30 * 86_400_000;

  return {
    currentMrrCents,
    targetMrrCents,
    gapCents: targetMrrCents === null ? null : Math.max(targetMrrCents - currentMrrCents, 0),
    runClients: clients.filter((client) => client.tier === "run").length,
    clientsTotal: clients.length,
    clientsWithoutMrr: clients
      .filter((client) => client.tier !== "build" && mrr(client) === 0)
      .map((client) => ({ id: client.id, name: client.name, tier: client.tier })),
    reviewsOverdue: clients
      .filter((client) => client.nextReviewAt && new Date(client.nextReviewAt).getTime() < dayStart)
      .map((client) => ({ id: client.id, name: client.name, dueAt: client.nextReviewAt! })),
    renewalsSoon: clients
      .filter((client) => {
        if (!client.renewalAt) return false;
        const due = new Date(client.renewalAt).getTime();
        return due >= dayStart && due <= thirtyDays;
      })
      .map((client) => {
        const due = new Date(client.renewalAt!).getTime();
        return {
          id: client.id,
          name: client.name,
          dueAt: client.renewalAt!,
          daysAway: Math.max(Math.ceil((due - dayStart) / 86_400_000), 0),
        };
      }),
  };
}

export interface ResponseDebtItem {
  id: ID;
  name: string;
  company?: string;
  kind: "reply" | "follow_up";
  dueAt: ISODateTime;
}

export interface ResponseDebtSummary {
  overdueReplies: number;
  dueTodayReplies: number;
  overdueFollowUps: number;
  dueTodayFollowUps: number;
  items: ResponseDebtItem[];
}

async function readResponseDebt(organizationId: ID, now: Date): Promise<ResponseDebtSummary> {
  const { data, error } = await supabase
    .from("comms_relationships")
    .select(RELATIONSHIP_COLUMNS)
    .eq("organization_id", organizationId)
    .or("response_due_at.not.is.null,follow_up_due_at.not.is.null");
  assertOk(error);

  const summary: ResponseDebtSummary = {
    overdueReplies: 0,
    dueTodayReplies: 0,
    overdueFollowUps: 0,
    dueTodayFollowUps: 0,
    items: [],
  };

  for (const row of (data ?? []) as unknown as RelationshipRow[]) {
    const relationship = toRelationship(row);
    if (relationship.responseDueAt) {
      const replyOnly: Relationship = { ...relationship };
      delete replyOnly.followUpDueAt;
      const state = dueState(replyOnly, now);
      if (state === "overdue") summary.overdueReplies += 1;
      else if (state === "today") summary.dueTodayReplies += 1;
      if (state === "overdue" || state === "today") {
        summary.items.push({
          id: relationship.id,
          name: relationship.fullName,
          ...(relationship.companyName ? { company: relationship.companyName } : {}),
          kind: "reply",
          dueAt: relationship.responseDueAt,
        });
      }
      continue;
    }

    if (relationship.followUpDueAt) {
      const state = dueState(relationship, now);
      if (state === "overdue") summary.overdueFollowUps += 1;
      else if (state === "today") summary.dueTodayFollowUps += 1;
      if (state === "overdue" || state === "today") {
        summary.items.push({
          id: relationship.id,
          name: relationship.fullName,
          ...(relationship.companyName ? { company: relationship.companyName } : {}),
          kind: "follow_up",
          dueAt: relationship.followUpDueAt,
        });
      }
    }
  }

  summary.items.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  return summary;
}

export interface DraftQueueSummary {
  totalNeedsReview: number;
  scoutNeedsReview: number;
  followUpNeedsReview: number;
  warmIntroNeedsReview: number;
  logisticsNeedsReview: number;
  scoutCreatedToday: number;
  byRegister: Record<string, number>;
}

async function readDraftQueue(organizationId: ID, now: Date): Promise<DraftQueueSummary> {
  const { data, error } = await supabase
    .from("comms_drafts")
    .select("id, register, review_state, created_at")
    .eq("organization_id", organizationId);
  assertOk(error);

  const start = new Date(startOfLocalDayISO(now)).getTime();
  const summary: DraftQueueSummary = {
    totalNeedsReview: 0,
    scoutNeedsReview: 0,
    followUpNeedsReview: 0,
    warmIntroNeedsReview: 0,
    logisticsNeedsReview: 0,
    scoutCreatedToday: 0,
    byRegister: {},
  };

  for (const row of (data ?? []) as Row[]) {
    const register = String(row["register"] ?? "unknown");
    const reviewState = String(row["review_state"] ?? "draft");
    const createdAt = new Date(String(row["created_at"] ?? "")).getTime();
    if (register === "scout_intro" && !Number.isNaN(createdAt) && createdAt >= start) {
      summary.scoutCreatedToday += 1;
    }
    if (reviewState !== "needs_human_review") continue;
    summary.totalNeedsReview += 1;
    summary.byRegister[register] = (summary.byRegister[register] ?? 0) + 1;
    if (register === "scout_intro") summary.scoutNeedsReview += 1;
    else if (register === "follow_up") summary.followUpNeedsReview += 1;
    else if (register === "warm_intro") summary.warmIntroNeedsReview += 1;
    else if (register === "logistics") summary.logisticsNeedsReview += 1;
  }

  return summary;
}

export interface ProspectSummary {
  total: number;
  unscored: number;
  scored: number;
  readyForComms: number;
  discovered: number;
  passed: number;
  byStatus: Record<string, number>;
}

async function readProspects(organizationId: ID): Promise<ProspectSummary> {
  const { data, error } = await supabase
    .from("prospects")
    .select("id, status, score")
    .eq("organization_id", organizationId)
    .limit(2000);
  assertOk(error);

  const summary: ProspectSummary = {
    total: 0,
    unscored: 0,
    scored: 0,
    readyForComms: 0,
    discovered: 0,
    passed: 0,
    byStatus: {},
  };

  for (const row of (data ?? []) as Row[]) {
    const status = String(row["status"] ?? "unknown");
    const score = row["score"];
    summary.total += 1;
    summary.byStatus[status] = (summary.byStatus[status] ?? 0) + 1;
    if (typeof score === "number" && Number.isFinite(score)) summary.scored += 1;
    else summary.unscored += 1;
    if (status === "ready_for_comms") summary.readyForComms += 1;
    else if (status === "discovered") summary.discovered += 1;
    else if (status === "passed") summary.passed += 1;
  }

  return summary;
}

export interface ContentSummary {
  itemsTotal: number;
  publishedPosts: number;
  publishedToday: number;
  exceptionItems: number;
  verifiedItems: number;
  requestCount: number;
  batchStates: Record<string, number>;
  itemStates: Record<string, number>;
}

async function readContent(organizationId: ID, now: Date): Promise<ContentSummary> {
  const [items, batches, publishedPosts, requests] = await Promise.all([
    supabase
      .from("content_items")
      .select("id, state, published_at")
      .eq("organization_id", organizationId)
      .limit(1000),
    supabase
      .from("content_batches")
      .select("id, state")
      .eq("organization_id", organizationId)
      .limit(200),
    supabase
      .from("published_posts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabase
      .from("content_requests")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
  ]);
  assertOk(items.error);
  assertOk(batches.error);
  assertOk(publishedPosts.error);
  assertOk(requests.error);

  const start = new Date(startOfLocalDayISO(now)).getTime();
  const itemStates: Record<string, number> = {};
  let publishedToday = 0;
  for (const row of (items.data ?? []) as Row[]) {
    const state = String(row["state"] ?? "unknown");
    itemStates[state] = (itemStates[state] ?? 0) + 1;
    const publishedAt = row["published_at"];
    if (typeof publishedAt === "string") {
      const at = new Date(publishedAt).getTime();
      if (!Number.isNaN(at) && at >= start) publishedToday += 1;
    }
  }

  const batchStates: Record<string, number> = {};
  for (const row of (batches.data ?? []) as Row[]) {
    const state = String(row["state"] ?? "unknown");
    batchStates[state] = (batchStates[state] ?? 0) + 1;
  }

  return {
    itemsTotal: (items.data ?? []).length,
    publishedPosts: publishedPosts.count ?? 0,
    publishedToday,
    exceptionItems: itemStates["exception"] ?? 0,
    verifiedItems: itemStates["verified"] ?? 0,
    requestCount: requests.count ?? 0,
    batchStates,
    itemStates,
  };
}

export interface RevenueOpsBlocker {
  id: string;
  severity: "attention" | "risk";
  title: string;
  detail: string;
  route: RevenueOpsRoute;
}

export type RevenueOpsRoute =
  | "/modules/comms/queue"
  | "/modules/scout/outreach"
  | "/modules/clients"
  | "/settings/outcomes"
  | "/modules/studio";

export interface RevenueOpsToday {
  organizationId: ID;
  readAt: ISODateTime;
  sources: {
    activityTargets: RevenueSource<ActivityTargetRecord[]>;
    activityActuals: RevenueSource<ActivityActuals>;
    weeklyTargets: RevenueSource<WeeklyTargets>;
    weeklyScoreboard: RevenueSource<WeeklyScoreboard>;
    clients: RevenueSource<ClientRevenueSummary>;
    responseDebt: RevenueSource<ResponseDebtSummary>;
    drafts: RevenueSource<DraftQueueSummary>;
    prospects: RevenueSource<ProspectSummary>;
    content: RevenueSource<ContentSummary>;
    recent: RevenueSource<ActivityEvent[]>;
  };
  blockers: RevenueOpsBlocker[];
}

function target(streams: ActivityStreamActual[] | null, stream: ActivityStream): number | null {
  return streams?.find((entry) => entry.stream === stream)?.targetCount ?? null;
}

function buildBlockers(sources: RevenueOpsToday["sources"]): RevenueOpsBlocker[] {
  const blockers: RevenueOpsBlocker[] = [];
  const unreadableSources = (
    [
      ["Activity targets", sources.activityTargets],
      ["Activity actuals", sources.activityActuals],
      ["Weekly targets", sources.weeklyTargets],
      ["Scoreboard", sources.weeklyScoreboard],
      ["Revenue", sources.clients],
      ["Comms", sources.responseDebt],
      ["Drafts", sources.drafts],
      ["Scout", sources.prospects],
      ["Studio", sources.content],
      ["Movement", sources.recent],
    ] as const
  ).filter(([, source]) => !source.available);

  if (unreadableSources.length > 0) {
    const labels = unreadableSources.map(([label]) => label);
    blockers.push({
      id: "unreadable-ledgers",
      severity: "risk",
      title: `${unreadableSources.length} revenue ledger${
        unreadableSources.length === 1 ? "" : "s"
      } unreadable`,
      detail: `Do not trust a green day until ${labels
        .slice(0, 3)
        .join(", ")}${labels.length > 3 ? " and others" : ""} read cleanly.`,
      route: "/settings/outcomes",
    });
  }

  const activity = sources.activityActuals.value;
  const streams = activity?.streams ?? null;

  const debt = sources.responseDebt.value;
  if (debt && debt.overdueReplies > 0) {
    blockers.push({
      id: "overdue-replies",
      severity: "risk",
      title: `${debt.overdueReplies} overdue ${debt.overdueReplies === 1 ? "reply" : "replies"}`,
      detail: "Response debt closes before new outbound. It is the highest-leverage queue.",
      route: "/modules/comms/queue",
    });
  }

  const drafts = sources.drafts.value;
  if (drafts && drafts.totalNeedsReview > 0) {
    blockers.push({
      id: "draft-review",
      severity: "attention",
      title: `${drafts.totalNeedsReview} draft${drafts.totalNeedsReview === 1 ? "" : "s"} need review`,
      detail: `${drafts.scoutNeedsReview} Scout intro${drafts.scoutNeedsReview === 1 ? "" : "s"} are waiting for Tai's send hand.`,
      route: "/modules/scout/outreach",
    });
  }

  const clients = sources.clients.value;
  if (clients && clients.clientsWithoutMrr.length > 0) {
    const names = clients.clientsWithoutMrr
      .map((client) => client.name)
      .slice(0, 2)
      .join(", ");
    blockers.push({
      id: "missing-client-mrr",
      severity: "attention",
      title: "Client value is missing",
      detail: `${names}${clients.clientsWithoutMrr.length > 2 ? " and others" : ""} need recorded MRR before the goal math is fully trusted.`,
      route: "/modules/clients",
    });
  }

  if (clients && clients.reviewsOverdue.length > 0) {
    blockers.push({
      id: "client-review-overdue",
      severity: "risk",
      title: `${clients.reviewsOverdue.length} client review overdue`,
      detail: "Retention protects the base before outbound adds to it.",
      route: "/modules/clients",
    });
  }

  const linkedInTarget = target(streams, "linkedin_connections");
  if (
    activity &&
    linkedInTarget !== null &&
    linkedInTarget > 0 &&
    (activity.linkedInSendsToday ?? 0) < linkedInTarget
  ) {
    blockers.push({
      id: "linkedin-under-target",
      severity: "attention",
      title: "LinkedIn is under today's target",
      detail: `${activity.linkedInSendsToday ?? 0}/${linkedInTarget} invitations recorded today.`,
      route: "/settings/outcomes",
    });
  }

  const contentTarget = target(streams, "blog_posts");
  if (
    activity &&
    contentTarget !== null &&
    contentTarget > 0 &&
    (activity.insightsPublishedToday ?? 0) < contentTarget
  ) {
    blockers.push({
      id: "insights-under-target",
      severity: "attention",
      title: "Insights output is under today's target",
      detail: `${activity.insightsPublishedToday ?? 0}/${contentTarget} published today.`,
      route: "/modules/studio",
    });
  }

  const content = sources.content.value;
  if (content && content.exceptionItems > 0) {
    blockers.push({
      id: "content-exceptions",
      severity: "attention",
      title: `${content.exceptionItems} content item${content.exceptionItems === 1 ? "" : "s"} in exception`,
      detail: "The content engine has work it could not turn into publishable output.",
      route: "/modules/studio",
    });
  }

  return blockers;
}

export async function readRevenueOpsToday(organizationId: ID): Promise<RevenueOpsToday> {
  const now = new Date();
  const readAt = now.toISOString();

  const activityTargets = await sourced(() => listActivityTargets(organizationId));
  const weeklyTargets = await sourced(() => readOrganizationWeeklyTargets(organizationId));

  const [
    activityActuals,
    weeklyScoreboard,
    clients,
    responseDebt,
    drafts,
    prospects,
    content,
    recent,
  ] = await Promise.all([
    activityTargets.available
      ? sourced(() => readActivityActuals(organizationId, activityTargets.value ?? [], now))
      : Promise.resolve(unavailable<ActivityActuals>(activityTargets.because)),
    sourced(() => readWeeklyScoreboard(organizationId, now)),
    weeklyTargets.available
      ? sourced(async () =>
          readClientRevenue(
            await listClientCommercialState(organizationId),
            weeklyTargets.value!,
            now,
          ),
        )
      : Promise.resolve(unavailable<ClientRevenueSummary>(weeklyTargets.because)),
    sourced(() => readResponseDebt(organizationId, now)),
    sourced(() => readDraftQueue(organizationId, now)),
    sourced(() => readProspects(organizationId)),
    sourced(() => readContent(organizationId, now)),
    sourced(() => supabaseActivity.list({ organizationId, limit: 8 })),
  ]);

  const sources: RevenueOpsToday["sources"] = {
    activityTargets,
    activityActuals,
    weeklyTargets,
    weeklyScoreboard,
    clients,
    responseDebt,
    drafts,
    prospects,
    content,
    recent,
  };

  return {
    organizationId,
    readAt,
    sources,
    blockers: buildBlockers(sources),
  };
}
