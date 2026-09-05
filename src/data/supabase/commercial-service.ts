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
import { businessWeek, resolveBusinessTimeZone } from "@/domain/business-week";
import { countFirstTouches, type FirstTouchCandidate } from "@/domain/first-touch";
import { readTouchRecord } from "@/domain/comms-touch-record";
import {
  weeklyRevenue,
  type BuildPhaseEvent,
  type SignedProposalEvent,
  type WeeklyRevenue,
  type WeekWindow,
} from "@/domain/revenue";
import {
  assertWeeklyTargets,
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

/**
 * A read that either answered or did not. An empty answer is a real zero; a
 * failed read is an unknown, and the difference is never collapsed, because a
 * source that is down must not be shown to a person as a quiet zero.
 */
export interface Sourced<T> {
  available: boolean;
  value: T | null;
  because?: string;
}

async function sourced<T>(run: () => Promise<T>): Promise<Sourced<T>> {
  try {
    return { available: true, value: await run() };
  } catch (error) {
    return {
      available: false,
      value: null,
      because: error instanceof Error ? error.message : "That source could not be read.",
    };
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
  const { data, error } = await supabase
    .from("clients")
    .select(CLIENT_COLUMNS)
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  assertOk(error);
  return ((data ?? []) as Row[]).map(toClientRecord);
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

  // A move into Build recognises one-off revenue, so the amount is part of the
  // move, not an afterthought. Without it, nothing is written and nothing is
  // claimed: an event with no amount would be a silent zero.
  const movingIntoBuild = tierChanged && patch.tier === "build";
  const buildPhaseAmountCents =
    typeof patch.buildPhaseAmountCents === "number" && Number.isFinite(patch.buildPhaseAmountCents)
      ? Math.trunc(patch.buildPhaseAmountCents)
      : null;
  if (movingIntoBuild && (buildPhaseAmountCents === null || buildPhaseAmountCents < 0)) {
    throw new Error(
      "Moving a client into Build needs the phase amount a person actually agreed, in cents.",
    );
  }



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
    const phaseAmountCents = movingIntoBuild ? buildPhaseAmountCents : null;

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
  const { data, error } = await supabase
    .from("roadmaps")
    .select(PROPOSAL_COLUMNS)
    .eq("organization_id", organizationId)
    .order("proposal_sent_at", { ascending: false });
  assertOk(error);
  return ((data ?? []) as Row[])
    .map(toProposalRecord)
    .filter((proposal) => proposal.proposalSentAt !== null);
}

async function readProposal(roadmapId: ID, context: CommercialContext): Promise<ProposalRecord> {
  const { data, error } = await supabase
    .from("roadmaps")
    .select(PROPOSAL_COLUMNS)
    .eq("id", roadmapId)
    .eq("organization_id", context.organizationId)
    .single();
  assertOk(error);
  if (!data) throw new Error("That proposal could not be found.");
  return toProposalRecord(data as Row);
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

/**
 * A person sent a proposal, at a stated amount. Nothing is recognised yet.
 *
 * This is a transition, not a blind write. Recording the same sending twice
 * (the same date and the same amount, still open) replays the fact it already
 * knows and emits nothing further, so a double click cannot double count. A
 * proposal that has already been answered is never quietly reopened.
 */
export async function recordProposalSent(
  input: { roadmapId: ID; amountCents: number; sentAt?: ISODateTime },
  context: CommercialContext,
): Promise<ProposalRecord> {
  const amountCents =
    typeof input.amountCents === "number" && Number.isFinite(input.amountCents)
      ? Math.trunc(input.amountCents)
      : null;
  if (amountCents === null || amountCents < 0) {
    throw new Error("A sent proposal needs the amount a person actually put in it, in cents.");
  }

  const before = await readProposal(input.roadmapId, context);
  const sentAt = input.sentAt ?? new Date().toISOString();

  if (before.proposalOutcome === "signed" || before.proposalOutcome === "declined") {
    throw new Error(
      "That proposal has already been answered. Recording it as sent again would erase the answer.",
    );
  }

  const alreadyRecorded =
    before.proposalSentAt === sentAt &&
    before.proposalAmountCents === amountCents &&
    before.proposalOutcome === "open";
  if (alreadyRecorded) return before;

  const proposal = await writeProposal(
    input.roadmapId,
    {
      proposal_sent_at: sentAt,
      proposal_amount_cents: amountCents,
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
    // Tied to the transition itself: the same proposal sent on the same date
    // is the same fact, however many times the action is repeated.
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

/**
 * Whether a number on the board is a real answer or an unknown. An empty table
 * is a real zero; a source we could not read is not a zero and must never be
 * shown as one.
 */
export interface ScoreboardSource {
  available: boolean;
  because?: string;
}

export interface WeeklyScoreboard {
  week: WeekWindow;
  /** The organization's own timezone, which is what defined the week. */
  timeZone: string;
  /** True when the organization had no usable timezone and the fallback was used. */
  timeZoneFallback: boolean;
  timeZoneBecause?: string;
  targets: WeeklyTargets;
  /** Null when a source the number depends on could not be read. */
  revenue: WeeklyRevenue | null;
  /** Companies currently on the Run tier. State, not an event. */
  runClients: number | null;
  /** Proposals sent this week. */
  proposalsSent: number | null;
  /** Discovery calls that have already happened this week. */
  discoveryCalls: number | null;
  /** Roadmap reviews that have already happened this week. */
  roadmapReviews: number | null;
  /** Relationships that received their first human outreach this week. */
  firstTouches: number | null;
  sources: {
    organization: ScoreboardSource;
    clients: ScoreboardSource;
    proposals: ScoreboardSource;
    targets: ScoreboardSource;
    touches: ScoreboardSource;
    tierChanges: ScoreboardSource;
    firstTouches: ScoreboardSource;
  };
}

const TOUCH_SELECT =
  "id, relationship_id, occurred_at, channel, direction, logged_by, meeting_kind, provenance";

async function readTouchesInWeek(organizationId: ID, week: WeekWindow): Promise<Row[]> {
  const { data, error } = await supabase
    .from("comms_touches")
    .select(TOUCH_SELECT)
    .eq("organization_id", organizationId)
    .gte("occurred_at", week.start)
    .lt("occurred_at", week.end);
  assertOk(error);
  return (data ?? []) as Row[];
}

/** Everything outbound we had already sent these relationships before this week. */
async function readEarlierOutbound(
  organizationId: ID,
  week: WeekWindow,
  relationshipIds: string[],
): Promise<Row[]> {
  if (relationshipIds.length === 0) return [];
  const { data, error } = await supabase
    .from("comms_touches")
    .select(TOUCH_SELECT)
    .eq("organization_id", organizationId)
    .in("relationship_id", relationshipIds)
    .lt("occurred_at", week.start);
  assertOk(error);
  return (data ?? []) as Row[];
}

function toFirstTouchCandidate(row: Row): FirstTouchCandidate {
  return {
    relationshipId: String(row["relationship_id"] ?? ""),
    channel: row["channel"],
    direction: row["direction"],
    occurredAt: String(row["occurred_at"] ?? ""),
    loggedBy: typeof row["logged_by"] === "string" ? row["logged_by"] : null,
    retracted: readTouchRecord(row["provenance"]).retracted,
  };
}

async function readTierChangeEvents(
  organizationId: ID,
  week: WeekWindow,
): Promise<BuildPhaseEvent[]> {
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
}

/** The organization's own timezone, which is what a week means to the people in it. */
async function readOrganizationTimeZone(organizationId: ID): Promise<unknown> {
  const { data, error } = await supabase
    .from("organizations")
    .select("timezone")
    .eq("id", organizationId)
    .maybeSingle();
  assertOk(error);
  return (data as Row | null)?.["timezone"] ?? null;
}

/**
 * Everything the week actually is, derived at read time from state and dated
 * events, in the organization's own timezone. Nothing computed here is written
 * back anywhere, and nothing unreadable is reported as a zero.
 */
export async function readWeeklyScoreboard(
  organizationId: ID,
  now: Date | string = new Date(),
  options: { timeZone?: string } = {},
): Promise<WeeklyScoreboard> {
  const organizationSource = await sourced(() => readOrganizationTimeZone(organizationId));
  const zone = resolveBusinessTimeZone(options.timeZone ?? organizationSource.value);
  const week = businessWeek(now, zone.timeZone);

  const [clients, proposals, targets, touches, buildPhases] = await Promise.all([
    sourced(() => listClientCommercialState(organizationId)),
    sourced(() => listProposals(organizationId)),
    sourced(() => readOrganizationWeeklyTargets(organizationId)),
    sourced(() => readTouchesInWeek(organizationId, week)),
    sourced(() => readTierChangeEvents(organizationId, week)),
  ]);

  const weekTouches = touches.value ?? [];
  const relationshipIds = [
    ...new Set(weekTouches.map((touch) => String(touch["relationship_id"] ?? ""))),
  ].filter(Boolean);

  const earlier = touches.available
    ? await sourced(() => readEarlierOutbound(organizationId, week, relationshipIds))
    : ({ available: false, value: null, because: touches.because } satisfies Sourced<Row[]>);

  const signedProposals: SignedProposalEvent[] = (proposals.value ?? [])
    .filter((proposal) => proposal.proposalOutcome === "signed" && proposal.proposalOutcomeAt)
    .map((proposal) => ({
      occurredAt: proposal.proposalOutcomeAt as ISODateTime,
      amountCents: proposal.proposalAmountCents,
    }));

  const countable: CountableTouch[] = weekTouches.map((touch) => ({
    meetingKind: (touch["meeting_kind"] ?? null) as CountableTouch["meetingKind"],
    occurredAt: String(touch["occurred_at"] ?? ""),
    retracted: readTouchRecord(touch["provenance"]).retracted,
  }));

  const revenueReadable = clients.available && proposals.available && buildPhases.available;
  const firstTouchReadable = touches.available && earlier.available;

  return {
    week,
    timeZone: zone.timeZone,
    timeZoneFallback: zone.fallback,
    ...(zone.because ? { timeZoneBecause: zone.because } : {}),
    targets: targets.value ?? { ...DEFAULT_WEEKLY_TARGETS },
    revenue: revenueReadable
      ? weeklyRevenue({
          week,
          clients: (clients.value ?? []).map((client) => ({
            tier: client.tier,
            mrrCents: client.mrrCents,
          })),
          signedProposals,
          buildPhases: buildPhases.value ?? [],
        })
      : null,
    runClients: clients.available
      ? (clients.value ?? []).filter((client) => client.tier === "run").length
      : null,
    proposalsSent: proposals.available
      ? (proposals.value ?? []).filter(
          (proposal) =>
            proposal.proposalSentAt !== null &&
            proposal.proposalSentAt >= week.start &&
            proposal.proposalSentAt < week.end,
        ).length
      : null,
    discoveryCalls: touches.available ? countDiscoveryCalls(countable, { now, week }) : null,
    roadmapReviews: touches.available ? countRoadmapReviews(countable, { now, week }) : null,
    firstTouches: firstTouchReadable
      ? countFirstTouches(
          [...weekTouches, ...(earlier.value ?? [])].map(toFirstTouchCandidate),
          week,
        )
      : null,
    sources: {
      organization: asSource(organizationSource),
      clients: asSource(clients),
      proposals: asSource(proposals),
      targets: asSource(targets),
      touches: asSource(touches),
      tierChanges: asSource(buildPhases),
      firstTouches: asSource(earlier.available ? touches : earlier),
    },
  };
}

function asSource(result: Sourced<unknown>): ScoreboardSource {
  return result.available
    ? { available: true }
    : { available: false, ...(result.because ? { because: result.because } : {}) };
}

