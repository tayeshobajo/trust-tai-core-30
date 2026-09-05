/**
 * Commercial truth, the one place commercial state is written and read.
 *
 * Everything here obeys the locked law in `docs/commercial-truth.md`:
 *
 *   * Recurring revenue is state on the canonical `clients` row.
 *   * One-off revenue is an event on the existing prospect -> roadmap lineage.
 *   * Every amount is human-entered. Nothing reads a document, a transcript or
 *     a model output to decide money.
 *   * Weekly numbers are derived at read time and never written down.
 *
 * Writes go through the authenticated browser client, so RLS applies as the
 * signed-in person and the organization boundary is enforced by the database,
 * not by this file. No service-role key is ever used here.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import { emitSuiteEvent } from "@/data/events/suite-events";
import type { ID, ISODateTime } from "@/domain/entities";
import {
  readClientCommercialState,
  readProposalCommercialState,
  type ClientCommercialState,
  type ClientTier,
  type MeetingKind,
  type ProposalCommercialState,
} from "@/domain/commercial";
import { countDiscoveryCalls, countRoadmapReviews, type CountableTouch } from "@/domain/discovery";
import { readTouchRecord } from "@/domain/comms-touch-record";
import {
  weekWindow,
  weeklyRevenue,
  type BuildPhaseEvent,
  type SignedProposalEvent,
  type WeeklyRevenue,
  type WeekWindow,
} from "@/domain/revenue";
import {
  DEFAULT_WEEKLY_TARGETS,
  readWeeklyTargets,
  type WeeklyTargets,
} from "@/domain/weekly-targets";

type Row = Record<string, unknown>;

export interface CommercialContext {
  organizationId: ID;
  userId: ID;
  /** Display name of the signed-in person, used only in written summaries. */
  userLabel?: string | undefined;
}

function assertOk(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/** A table may be absent in a workspace that has not migrated yet. */
async function safe<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

const CLIENT_COLUMNS =
  "id, organization_id, name, status, tier, mrr_cents, renewal_at, next_review_at, tier_changed_at, commercial_updated_by, commercial_updated_at, commercial_provenance";

const PROPOSAL_COLUMNS =
  "id, organization_id, title, client_id, prospect_id, relationship_id, proposal_sent_at, proposal_amount_cents, proposal_outcome, proposal_outcome_at, proposal_updated_by";

/* ------------------------------------------------------------------ clients */

export interface ClientCommercialRecord extends ClientCommercialState {
  id: ID;
  name: string;
  status: string | null;
}

function toClientRecord(row: Row): ClientCommercialRecord {
  return {
    id: String(row["id"]),
    name: String(row["name"] ?? "Client"),
    status: typeof row["status"] === "string" ? row["status"] : null,
    ...readClientCommercialState(row),
  };
}

export async function listClientCommercialState(
  organizationId: ID,
): Promise<ClientCommercialRecord[]> {
  return safe(async () => {
    const { data, error } = await supabase
      .from("clients")
      .select(CLIENT_COLUMNS)
      .eq("organization_id", organizationId)
      .order("name", { ascending: true });
    assertOk(error);
    return ((data ?? []) as Row[]).map(toClientRecord);
  }, [] as ClientCommercialRecord[]);
}

export interface ClientCommercialPatch {
  clientId: ID;
  /** Only the keys present are written. An absent key leaves the fact alone. */
  tier?: ClientTier;
  mrrCents?: number | null;
  renewalAt?: ISODateTime | null;
  nextReviewAt?: ISODateTime | null;
  /**
   * Human-entered phase amount, required by the law only when the tier is
   * moving into Build. Nothing infers it and nothing stores it as recurring.
   */
  buildPhaseAmountCents?: number | null;
  /** Why the person made this change, kept with the provenance. */
  because?: string;
}

/**
 * Write commercial state onto the canonical client row.
 *
 * A tier change is an event as well as a state change: `client.tier_changed`
 * is emitted once, with the human-entered phase amount when the new tier is
 * Build, so revenue recognition has a dated fact to read.
 */
export async function setClientCommercialState(
  patch: ClientCommercialPatch,
  context: CommercialContext,
): Promise<ClientCommercialRecord> {
  const { data: current, error: readError } = await supabase
    .from("clients")
    .select(CLIENT_COLUMNS)
    .eq("id", patch.clientId)
    .eq("organization_id", context.organizationId)
    .single();
  assertOk(readError);
  if (!current) throw new Error("That client could not be found.");

  const before = toClientRecord(current as Row);
  const at = new Date().toISOString();
  const tierChanged = patch.tier !== undefined && patch.tier !== before.tier;

  const update: Row = {
    commercial_updated_by: context.userId,
    commercial_updated_at: at,
    commercial_provenance: {
      ...(before.commercialProvenance ?? {}),
      app_key: "roadmap",
      actor: context.userId,
      ...(context.userLabel ? { actor_label: context.userLabel } : {}),
      updated_at: at,
      ...(patch.because ? { because: patch.because } : {}),
      ...(tierChanged ? { previous_tier: before.tier } : {}),
    },
  };
  if (patch.tier !== undefined) update["tier"] = patch.tier;
  if (patch.mrrCents !== undefined) update["mrr_cents"] = patch.mrrCents;
  if (patch.renewalAt !== undefined) update["renewal_at"] = patch.renewalAt;
  if (patch.nextReviewAt !== undefined) update["next_review_at"] = patch.nextReviewAt;
  if (tierChanged) update["tier_changed_at"] = at;

  const { data, error } = await supabase
    .from("clients")
    .update(update)
    .eq("id", patch.clientId)
    .eq("organization_id", context.organizationId)
    .select(CLIENT_COLUMNS)
    .single();
  assertOk(error);
  if (!data) throw new Error("That commercial state could not be saved.");
  const after = toClientRecord(data as Row);

  if (tierChanged) {
    const phaseAmountCents =
      patch.tier === "build" && typeof patch.buildPhaseAmountCents === "number"
        ? Math.trunc(patch.buildPhaseAmountCents)
        : null;
    await emitSuiteEvent({
      key: "CLIENT_TIER_CHANGED",
      organizationId: context.organizationId,
      actor: { type: "user", id: context.userId },
      subject: { type: "client", id: after.id, label: after.name },
      summary: `${after.name} moved to ${patch.tier}.`,
      metadata: {
        tier: patch.tier,
        previous_tier: before.tier,
        ...(phaseAmountCents !== null ? { phase_amount_cents: phaseAmountCents } : {}),
        ...(patch.because ? { because: patch.because } : {}),
      },
      sourceEventKey: `client.tier_changed:${after.id}:${at}`,
      occurredAt: at,
    });
  }

  return after;
}

/* ---------------------------------------------------------------- proposals */

export interface ProposalRecord extends ProposalCommercialState {
  id: ID;
  title: string;
  clientId: ID | null;
  prospectId: ID | null;
  relationshipId: ID | null;
}

function toProposalRecord(row: Row): ProposalRecord {
  const text = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : null);
  return {
    id: String(row["id"]),
    title: String(row["title"] ?? "Roadmap"),
    clientId: text("client_id"),
    prospectId: text("prospect_id"),
    relationshipId: text("relationship_id"),
    ...readProposalCommercialState(row),
  };
}

export async function listProposals(organizationId: ID): Promise<ProposalRecord[]> {
  return safe(async () => {
    const { data, error } = await supabase
      .from("roadmaps")
      .select(PROPOSAL_COLUMNS)
      .eq("organization_id", organizationId)
      .order("proposal_sent_at", { ascending: false });
    assertOk(error);
    return ((data ?? []) as Row[])
      .map(toProposalRecord)
      .filter((proposal) => proposal.proposalSentAt !== null);
  }, [] as ProposalRecord[]);
}

async function writeProposal(
  roadmapId: ID,
  update: Row,
  context: CommercialContext,
): Promise<ProposalRecord> {
  const { data, error } = await supabase
    .from("roadmaps")
    .update({ ...update, proposal_updated_by: context.userId })
    .eq("id", roadmapId)
    .eq("organization_id", context.organizationId)
    .select(PROPOSAL_COLUMNS)
    .single();
  assertOk(error);
  if (!data) throw new Error("That proposal could not be saved.");
  return toProposalRecord(data as Row);
}

/** A person sent a proposal, at a stated amount. Nothing is recognised yet. */
export async function recordProposalSent(
  input: { roadmapId: ID; amountCents: number; sentAt?: ISODateTime },
  context: CommercialContext,
): Promise<ProposalRecord> {
  const sentAt = input.sentAt ?? new Date().toISOString();
  const proposal = await writeProposal(
    input.roadmapId,
    {
      proposal_sent_at: sentAt,
      proposal_amount_cents: Math.trunc(input.amountCents),
      proposal_outcome: "open",
      proposal_outcome_at: null,
    },
    context,
  );

  await emitSuiteEvent({
    key: "PROPOSAL_SENT",
    organizationId: context.organizationId,
    actor: { type: "user", id: context.userId },
    subject: { type: "roadmap", id: proposal.id, label: proposal.title },
    summary: `Proposal sent for ${proposal.title}.`,
    metadata: { amount_cents: proposal.proposalAmountCents, sent_at: sentAt },
    sourceEventKey: `proposal.sent:${proposal.id}:${sentAt}`,
    occurredAt: sentAt,
  });

  return proposal;
}

/**
 * A person recorded the answer. A signed proposal recognises Diagnose revenue
 * in full in the week of the outcome; a declined one recognises nothing.
 */
export async function recordProposalOutcome(
  input: { roadmapId: ID; outcome: "signed" | "declined"; at?: ISODateTime },
  context: CommercialContext,
): Promise<ProposalRecord> {
  const at = input.at ?? new Date().toISOString();
  const proposal = await writeProposal(
    input.roadmapId,
    { proposal_outcome: input.outcome, proposal_outcome_at: at },
    context,
  );

  await emitSuiteEvent({
    key: input.outcome === "signed" ? "PROPOSAL_SIGNED" : "PROPOSAL_DECLINED",
    organizationId: context.organizationId,
    actor: { type: "user", id: context.userId },
    subject: { type: "roadmap", id: proposal.id, label: proposal.title },
    summary:
      input.outcome === "signed"
        ? `Proposal signed for ${proposal.title}.`
        : `Proposal declined for ${proposal.title}.`,
    metadata: { amount_cents: proposal.proposalAmountCents, outcome: input.outcome },
    sourceEventKey: `proposal.${input.outcome}:${proposal.id}:${at}`,
    occurredAt: at,
  });

  return proposal;
}

/* ------------------------------------------------------------ meeting kind */

/**
 * Say what a logged meeting was. Human set only: this is never called by an
 * importer, a transcript reader or a model.
 */
export async function setMeetingKind(
  input: { touchId: ID; meetingKind: MeetingKind | null },
  context: CommercialContext,
): Promise<void> {
  const at = new Date().toISOString();
  const { data: current, error: readError } = await supabase
    .from("comms_touches")
    .select("id, provenance")
    .eq("id", input.touchId)
    .eq("organization_id", context.organizationId)
    .single();
  assertOk(readError);

  const provenance =
    current && typeof (current as Row)["provenance"] === "object"
      ? ((current as Row)["provenance"] as Row)
      : {};

  const { error } = await supabase
    .from("comms_touches")
    .update({
      meeting_kind: input.meetingKind,
      provenance: {
        ...provenance,
        meeting_kind_set_by: context.userId,
        meeting_kind_set_at: at,
      },
    })
    .eq("id", input.touchId)
    .eq("organization_id", context.organizationId);
  assertOk(error);
}

/* --------------------------------------------------------- weekly targets */

export async function readOrganizationWeeklyTargets(organizationId: ID): Promise<WeeklyTargets> {
  return safe(async () => {
    const { data, error } = await supabase
      .from("organization_weekly_targets")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle();
    assertOk(error);
    return readWeeklyTargets((data as Row) ?? null);
  }, { ...DEFAULT_WEEKLY_TARGETS });
}

/** Configuration only. Admin write is enforced by RLS, not by this file. */
export async function saveOrganizationWeeklyTargets(
  targets: WeeklyTargets,
  context: CommercialContext,
): Promise<WeeklyTargets> {
  const at = new Date().toISOString();
  const row: Row = {
    organization_id: context.organizationId,
    first_touch_target_low: targets.firstTouchTargetLow,
    first_touch_target_high: targets.firstTouchTargetHigh,
    discovery_target_low: targets.discoveryTargetLow,
    discovery_target_high: targets.discoveryTargetHigh,
    diagnose_proposals_target_low: targets.diagnoseProposalsTargetLow,
    diagnose_proposals_target_high: targets.diagnoseProposalsTargetHigh,
    run_clients_target: targets.runClientsTarget,
    revenue_target_cents: targets.revenueTargetCents,
    updated_by: context.userId,
    updated_at: at,
  };

  const { data: existing, error: readError } = await supabase
    .from("organization_weekly_targets")
    .select("id")
    .eq("organization_id", context.organizationId)
    .maybeSingle();
  assertOk(readError);

  if (existing && (existing as Row)["id"]) {
    const { data, error } = await supabase
      .from("organization_weekly_targets")
      .update(row)
      .eq("organization_id", context.organizationId)
      .select("*")
      .single();
    assertOk(error);
    return readWeeklyTargets((data as Row) ?? null);
  }

  const { data, error } = await supabase
    .from("organization_weekly_targets")
    .insert(row)
    .select("*")
    .single();
  assertOk(error);
  return readWeeklyTargets((data as Row) ?? null);
}

/* --------------------------------------------------------- weekly scoreboard */

export interface WeeklyScoreboard {
  week: WeekWindow;
  targets: WeeklyTargets;
  revenue: WeeklyRevenue;
  /** Companies currently on the Run tier. State, not an event. */
  runClients: number;
  /** Proposals sent this week. */
  proposalsSent: number;
  /** Discovery calls that have already happened this week. */
  discoveryCalls: number;
  /** Roadmap reviews that have already happened this week. */
  roadmapReviews: number;
  /** Relationships whose very first logged interaction happened this week. */
  firstTouches: number;
}

async function readTouchesInWeek(organizationId: ID, week: WeekWindow): Promise<Row[]> {
  return safe(async () => {
    const { data, error } = await supabase
      .from("comms_touches")
      .select("id, relationship_id, occurred_at, direction, meeting_kind, provenance")
      .eq("organization_id", organizationId)
      .gte("occurred_at", week.start)
      .lt("occurred_at", week.end);
    assertOk(error);
    return (data ?? []) as Row[];
  }, [] as Row[]);
}

/** Of the relationships touched this week, how many had never been touched before. */
async function countFirstTouches(
  organizationId: ID,
  week: WeekWindow,
  touches: Row[],
): Promise<number> {
  const ids = [...new Set(touches.map((touch) => String(touch["relationship_id"] ?? "")))].filter(
    Boolean,
  );
  if (ids.length === 0) return 0;
  return safe(async () => {
    const { data, error } = await supabase
      .from("comms_touches")
      .select("relationship_id")
      .eq("organization_id", organizationId)
      .in("relationship_id", ids)
      .lt("occurred_at", week.start);
    assertOk(error);
    const earlier = new Set(
      ((data ?? []) as Row[]).map((row) => String(row["relationship_id"] ?? "")),
    );
    return ids.filter((id) => !earlier.has(id)).length;
  }, 0);
}

async function readTierChangeEvents(
  organizationId: ID,
  week: WeekWindow,
): Promise<BuildPhaseEvent[]> {
  return safe(async () => {
    const { data, error } = await supabase
      .from("activities")
      .select("occurred_at, payload")
      .eq("organization_id", organizationId)
      .eq("event_type", "client.tier_changed")
      .gte("occurred_at", week.start)
      .lt("occurred_at", week.end);
    assertOk(error);
    return ((data ?? []) as Row[])
      .map((row) => {
        const payload = (row["payload"] ?? {}) as Row;
        if (payload["tier"] !== "build") return null;
        const amount = payload["phase_amount_cents"];
        return {
          occurredAt: String(row["occurred_at"] ?? ""),
          phaseAmountCents: typeof amount === "number" ? Math.trunc(amount) : null,
        } satisfies BuildPhaseEvent;
      })
      .filter((event): event is BuildPhaseEvent => event !== null);
  }, [] as BuildPhaseEvent[]);
}

/**
 * Everything the week actually is, derived at read time from state and dated
 * events. Nothing computed here is written back anywhere.
 */
export async function readWeeklyScoreboard(
  organizationId: ID,
  now: Date | string = new Date(),
): Promise<WeeklyScoreboard> {
  const week = weekWindow(now);
  const [clients, proposals, targets, touches, buildPhases] = await Promise.all([
    listClientCommercialState(organizationId),
    listProposals(organizationId),
    readOrganizationWeeklyTargets(organizationId),
    readTouchesInWeek(organizationId, week),
    readTierChangeEvents(organizationId, week),
  ]);

  const signedProposals: SignedProposalEvent[] = proposals
    .filter((proposal) => proposal.proposalOutcome === "signed" && proposal.proposalOutcomeAt)
    .map((proposal) => ({
      occurredAt: proposal.proposalOutcomeAt as ISODateTime,
      amountCents: proposal.proposalAmountCents,
    }));

  const countable: CountableTouch[] = touches.map((touch) => ({
    meetingKind: (touch["meeting_kind"] ?? null) as CountableTouch["meetingKind"],
    occurredAt: String(touch["occurred_at"] ?? ""),
    retracted: readTouchRecord(touch["provenance"]).retracted,
  }));

  const firstTouches = await countFirstTouches(organizationId, week, touches);

  return {
    week,
    targets,
    revenue: weeklyRevenue({
      week,
      clients: clients.map((client) => ({ tier: client.tier, mrrCents: client.mrrCents })),
      signedProposals,
      buildPhases,
    }),
    runClients: clients.filter((client) => client.tier === "run").length,
    proposalsSent: proposals.filter(
      (proposal) =>
        proposal.proposalSentAt !== null &&
        proposal.proposalSentAt >= week.start &&
        proposal.proposalSentAt < week.end,
    ).length,
    discoveryCalls: countDiscoveryCalls(countable, { now, week }),
    roadmapReviews: countRoadmapReviews(countable, { now, week }),
    firstTouches,
  };
}
