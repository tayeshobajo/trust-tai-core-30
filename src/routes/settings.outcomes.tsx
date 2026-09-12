/**
 * Outcomes settings: commercial targets, activity volumes, Scout messaging.
 *
 * Targets are configuration; actuals are derived at read time and never
 * persisted. Everything saves through the authenticated browser client, so
 * RLS applies as the signed-in person.
 */

import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { MetaPill, SectionHeading, TTButton, TTInput, TonePill } from "@/components/tt/primitives";
import { TTSelect, Toggle } from "@/components/tt/settings/pieces";
import { useSettingsIdentity } from "@/components/tt/settings/shell";
import {
  ACTIVITY_STREAMS,
  listActivityTargets,
  saveActivityTarget,
  type ActivityCadence,
  type ActivityStream,
  type ActivityTarget,
} from "@/data/supabase/activity-targets";
import {
  readOrganizationWeeklyTargets,
  readWeeklyScoreboard,
  saveOrganizationWeeklyTargets,
} from "@/data/supabase/commercial-service";
import {
  createScoutIntroTemplate,
  deleteScoutIntroTemplate,
  listScoutIntroTemplates,
  updateScoutIntroTemplate,
  type ScoutIntroTemplate,
  type SendWindow,
} from "@/data/supabase/scout-intro-templates";
import {
  RELATIONSHIP_COLUMNS,
  toRelationship,
  type RelationshipRow,
} from "@/data/supabase/comms-schema";
import { checkVoice } from "@/data/voice-policy";
import { supabase } from "@/integrations/trust-tai/supabase";
import { dueState, type Relationship } from "@/domain/comms";
import type { WeekWindow } from "@/domain/revenue";
import type { WeeklyTargets } from "@/domain/weekly-targets";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings/outcomes")({
  component: OutcomesSettings,
});

/* ------------------------------------------------------------ shared bits */

function ProgressBar({ value, max }: { value: number; max: number }) {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={cn("h-full rounded-full transition-all", ratio >= 1 ? "bg-success" : "bg-royal")}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

function OutcomesSettings() {
  return (
    <div className="space-y-6">
      <section className="tt-surface p-6">
        <SectionHeading
          eyebrow="Weekly"
          title="Commercial targets"
          description="What a good week looks like for the business."
        />
        <CommercialTargetsSection />
      </section>

      <section className="tt-surface p-6">
        <SectionHeading
          eyebrow="Ceilings"
          title="Activity volumes"
          description="Daily and weekly output limits for outbound and published work."
        />
        <ActivityVolumesSection />
      </section>

      <section className="tt-surface p-6">
        <SectionHeading
          eyebrow="Debt"
          title="Response debt"
          description="Replies owed and follow-ups planned, read live from the relationship book."
        />
        <ResponseDebtSection />
      </section>

      <section className="tt-surface p-6">
        <SectionHeading
          eyebrow="Trailing four weeks"
          title="Funnel"
          description="Stage counts and conversion between adjacent stages, derived at read time."
        />
        <FunnelSection />
      </section>

      <section className="tt-surface p-6">
        <SectionHeading
          eyebrow="Scout"
          title="Scout messaging"
          description="Intro email templates, send windows, and weekly caps."
        />
        <ScoutMessagingSection />
      </section>
    </div>
  );
}

/* ---------------------------------------------------- commercial targets */

interface CommercialRowSpec {
  id: string;
  label: string;
  lowKey: keyof WeeklyTargets;
  highKey: keyof WeeklyTargets | null;
}

const COMMERCIAL_ROWS: CommercialRowSpec[] = [
  { id: "first-touches", label: "First touches", lowKey: "firstTouchTargetLow", highKey: "firstTouchTargetHigh" },
  { id: "discovery-calls", label: "Discovery calls", lowKey: "discoveryTargetLow", highKey: "discoveryTargetHigh" },
  { id: "proposals", label: "Proposals", lowKey: "diagnoseProposalsTargetLow", highKey: "diagnoseProposalsTargetHigh" },
  { id: "run-clients", label: "Run clients", lowKey: "runClientsTarget", highKey: null },
];

function CommercialTargetsSection() {
  const identity = useSettingsIdentity();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<WeeklyTargets | null>(null);

  const targets = useQuery({
    queryKey: ["outcomes", "weekly-targets", identity.organizationId],
    queryFn: () => readOrganizationWeeklyTargets(identity.organizationId),
  });

  const scoreboard = useQuery({
    queryKey: ["outcomes", "weekly-scoreboard", identity.organizationId],
    queryFn: () => readWeeklyScoreboard(identity.organizationId),
  });

  useEffect(() => {
    if (targets.data && !draft) setDraft({ ...targets.data });
  }, [targets.data, draft]);

  const save = useMutation({
    mutationFn: (next: WeeklyTargets) =>
      saveOrganizationWeeklyTargets(next, {
        organizationId: identity.organizationId,
        userId: identity.userId,
      }),
    onSuccess: (saved) => {
      setDraft({ ...saved });
      queryClient.setQueryData(["outcomes", "weekly-targets", identity.organizationId], saved);
      toast.success("Commercial targets saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (targets.error) {
    return (
      <p role="alert" className="mt-4 text-sm text-destructive">
        {(targets.error as Error).message}
      </p>
    );
  }
  if (!draft) {
    return <p className="mt-4 text-sm text-muted-foreground">Loading targets…</p>;
  }

  const actuals: Record<string, number | null> = {
    "first-touches": scoreboard.data?.firstTouches ?? null,
    "discovery-calls": scoreboard.data?.discoveryCalls ?? null,
    proposals: scoreboard.data?.proposalsSent ?? null,
    "run-clients": scoreboard.data?.runClients ?? null,
  };

  const update = (key: keyof WeeklyTargets, value: number) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  const dirty =
    targets.data !== undefined && JSON.stringify(draft) !== JSON.stringify(targets.data);

  return (
    <div className="mt-5 space-y-5">
      {COMMERCIAL_ROWS.map((row) => {
        const low = draft[row.lowKey] as number;
        const high = row.highKey ? (draft[row.highKey] as number) : null;
        const actual = actuals[row.id] ?? null;
        const max = high ?? low ?? 1;
        return (
          <div key={row.id} className="grid gap-4 sm:grid-cols-[1fr_auto_180px] sm:items-center">
            <div>
              <p className="text-sm font-medium text-foreground">{row.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {actual === null ? "Not readable this week" : `${actual} this week`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <TTInput
                type="number"
                value={low}
                disabled={!identity.canManage}
                onChange={(event) => update(row.lowKey, Number(event.target.value))}
                className="h-9 w-20 px-3 text-center"
              />
              {row.highKey !== null && high !== null ? (
                <>
                  <span className="text-sm text-muted-foreground">–</span>
                  <TTInput
                    type="number"
                    value={high}
                    disabled={!identity.canManage}
                    onChange={(event) => update(row.highKey!, Number(event.target.value))}
                    className="h-9 w-20 px-3 text-center"
                  />
                </>
              ) : null}
            </div>

            <div className="w-full sm:w-44">
              <ProgressBar value={actual ?? 0} max={max} />
            </div>
          </div>
        );
      })}

      <div className="grid gap-4 sm:grid-cols-[1fr_auto_180px] sm:items-center">
        <div>
          <p className="text-sm font-medium text-foreground">Monthly revenue target</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Not tracked</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">$</span>
          <TTInput
            type="number"
            value={draft.revenueTargetCents === null ? "" : Math.round(draft.revenueTargetCents / 100)}
            disabled={!identity.canManage}
            onChange={(event) =>
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      revenueTargetCents:
                        event.target.value === "" ? null : Math.round(Number(event.target.value) * 100),
                    }
                  : current,
              )
            }
            className="h-9 w-28 px-3 text-center"
          />
        </div>
        <div />
      </div>

      {identity.canManage ? (
        <div className="flex justify-end">
          <TTButton size="sm" onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending}>
            {save.isPending ? "Saving…" : "Save commercial targets"}
          </TTButton>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------ activity volumes */

const STREAM_LABEL: Record<ActivityStream, string> = {
  linkedin_connections: "LinkedIn connection invitations",
  blog_posts: "Blog posts published",
  scout_intros: "Scout intro emails",
};

const STREAM_DEFAULTS: Record<ActivityStream, { targetCount: number; cadence: ActivityCadence }> = {
  linkedin_connections: { targetCount: 10, cadence: "day" },
  blog_posts: { targetCount: 2, cadence: "day" },
  scout_intros: { targetCount: 15, cadence: "week" },
};

function startOfLocalDayISO(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

function startOfLocalWeekISO(): string {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // Monday = 0
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - day).toISOString();
}

/** Blog posts published since local midnight. A missing table reads as null, never zero. */
async function countBlogPostsToday(organizationId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from("content_items")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("published_at", startOfLocalDayISO());
  if (error) return null;
  return count ?? 0;
}

/**
 * LinkedIn invitations sent today, mirrored from ZenMode into `activities` as
 * `zenmode.connection_sent` rows (scripts/tt-confirm-route.py --sync-activities,
 * run by the daily loop). The event day lives in payload->>sent_at so a
 * backfilled row counts on the day the send happened, not the day the sync ran.
 */
async function countLinkedInSendsToday(organizationId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("event_type", "zenmode.connection_sent")
    .gte("payload->>sent_at", startOfLocalDayISO());
  if (error) return null;
  return count ?? 0;
}

/** Scout intro drafts a human approved and sent this week. */
export async function countScoutIntrosSentThisWeek(organizationId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from("comms_drafts")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("register", "scout_intro")
    .eq("review_state", "sent")
    .gte("updated_at", startOfLocalWeekISO());
  if (error) return null;
  return count ?? 0;
}

export const ACTIVITY_TARGETS_QUERY_KEY = (organizationId: string) =>
  ["outcomes", "activity-targets", organizationId] as const;

function useActivityTargets(organizationId: string) {
  return useQuery({
    queryKey: ACTIVITY_TARGETS_QUERY_KEY(organizationId),
    queryFn: () => listActivityTargets(organizationId),
  });
}

function ActivityVolumesSection() {
  const identity = useSettingsIdentity();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<ActivityStream, ActivityTarget> | null>(null);

  const stored = useActivityTargets(identity.organizationId);

  const actuals = useQuery({
    queryKey: ["outcomes", "activity-actuals", identity.organizationId],
    queryFn: async () => ({
      blogPostsToday: await countBlogPostsToday(identity.organizationId),
      scoutIntrosThisWeek: await countScoutIntrosSentThisWeek(identity.organizationId),
      linkedInSendsToday: await countLinkedInSendsToday(identity.organizationId),
    }),
  });

  useEffect(() => {
    if (stored.data && !draft) {
      const byStream = new Map(stored.data.map((record) => [record.stream, record]));
      setDraft(
        Object.fromEntries(
          ACTIVITY_STREAMS.map((stream) => {
            const record = byStream.get(stream);
            return [
              stream,
              record
                ? { stream, targetCount: record.targetCount, cadence: record.cadence }
                : { stream, ...STREAM_DEFAULTS[stream] },
            ];
          }),
        ) as Record<ActivityStream, ActivityTarget>,
      );
    }
  }, [stored.data, draft]);

  const save = useMutation({
    mutationFn: async (targets: ActivityTarget[]) => {
      for (const target of targets) {
        await saveActivityTarget(target, {
          organizationId: identity.organizationId,
          userId: identity.userId,
        });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ACTIVITY_TARGETS_QUERY_KEY(identity.organizationId),
      });
      toast.success("Activity volumes saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (stored.error) {
    return (
      <p role="alert" className="mt-4 text-sm text-destructive">
        {(stored.error as Error).message}
      </p>
    );
  }
  if (!draft) return <p className="mt-4 text-sm text-muted-foreground">Loading volumes…</p>;

  const actualFor = (stream: ActivityStream): { value: number | null; label: string } => {
    if (stream === "linkedin_connections") {
      const value = actuals.data?.linkedInSendsToday ?? null;
      return {
        value,
        label: value === null ? "Not readable" : `${value} today · reported by ZenMode`,
      };
    }
    if (stream === "blog_posts") {
      const value = actuals.data?.blogPostsToday ?? null;
      return { value, label: value === null ? "Not readable" : `${value} today` };
    }
    const value = actuals.data?.scoutIntrosThisWeek ?? null;
    return { value, label: value === null ? "Not readable" : `${value} sent this week` };
  };

  const storedByStream = new Map((stored.data ?? []).map((record) => [record.stream, record]));
  const dirty = ACTIVITY_STREAMS.some((stream) => {
    const record = storedByStream.get(stream);
    const current = draft[stream];
    if (!record) return true;
    return record.targetCount !== current.targetCount || record.cadence !== current.cadence;
  });

  return (
    <div className="mt-5 space-y-5">
      {ACTIVITY_STREAMS.map((stream) => {
        const target = draft[stream];
        const actual = actualFor(stream);
        return (
          <div key={stream} className="grid gap-4 sm:grid-cols-[1fr_auto_auto_180px] sm:items-center">
            <div>
              <p className="text-sm font-medium text-foreground">{STREAM_LABEL[stream]}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{actual.label}</p>
            </div>

            <TTInput
              type="number"
              value={target.targetCount}
              disabled={!identity.canManage}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? { ...current, [stream]: { ...target, targetCount: Number(event.target.value) } }
                    : current,
                )
              }
              className="h-9 w-20 px-3 text-center"
            />

            <TTSelect
              value={target.cadence}
              disabled={!identity.canManage}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        [stream]: { ...target, cadence: event.target.value as ActivityCadence },
                      }
                    : current,
                )
              }
              className="h-9 w-36"
            >
              <option value="day">per day</option>
              <option value="week">per week</option>
              <option value="month">per month</option>
            </TTSelect>

            <div className="w-full sm:w-44">
              <ProgressBar value={actual.value ?? 0} max={target.targetCount} />
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Caps are ceilings. Quality gates decide what actually goes out.
        </p>
        {identity.canManage ? (
          <TTButton
            size="sm"
            onClick={() => save.mutate(Object.values(draft))}
            disabled={!dirty || save.isPending}
          >
            {save.isPending ? "Saving…" : "Save activity volumes"}
          </TTButton>
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- response debt */

interface ResponseDebt {
  overdueReplies: number;
  dueTodayReplies: number;
  followUpsDue: number;
}

/**
 * Replies owed and follow-ups planned, counted from `comms_relationships`
 * timing fields through the shared `dueState` read. A reply owed outranks a
 * follow-up planned, so a relationship with `response_due_at` set counts only
 * in the reply buckets, whatever its follow-up says. A failed read is null,
 * never a quiet zero.
 */
async function readResponseDebt(organizationId: string): Promise<ResponseDebt | null> {
  const { data, error } = await supabase
    .from("comms_relationships")
    .select(RELATIONSHIP_COLUMNS)
    .eq("organization_id", organizationId)
    .or("response_due_at.not.is.null,follow_up_due_at.not.is.null");
  if (error) return null;

  const now = new Date();
  const debt: ResponseDebt = { overdueReplies: 0, dueTodayReplies: 0, followUpsDue: 0 };

  for (const row of (data ?? []) as unknown as RelationshipRow[]) {
    const relationship = toRelationship(row);
    if (relationship.responseDueAt) {
      // The reply deadline alone decides the bucket: dueState reads the
      // earliest of both dates, and here the follow-up must not soften or
      // sharpen a reply that is owed.
      const { followUpDueAt: _followUp, ...replyOnly } = relationship;
      const state = dueState(replyOnly as Relationship, now);
      if (state === "overdue") debt.overdueReplies += 1;
      else if (state === "today") debt.dueTodayReplies += 1;
    } else if (relationship.followUpDueAt) {
      const state = dueState(relationship, now);
      if (state === "overdue" || state === "today") debt.followUpsDue += 1;
    }
  }

  return debt;
}

function ResponseDebtSection() {
  const identity = useSettingsIdentity();

  const debt = useQuery({
    queryKey: ["outcomes", "response-debt", identity.organizationId],
    queryFn: () => readResponseDebt(identity.organizationId),
  });

  const cells: { id: string; label: string; value: number | null; destructive: boolean }[] = [
    {
      id: "overdue",
      label: "Overdue replies",
      value: debt.data?.overdueReplies ?? null,
      destructive: true,
    },
    {
      id: "due-today",
      label: "Due today",
      value: debt.data?.dueTodayReplies ?? null,
      destructive: false,
    },
    {
      id: "follow-ups",
      label: "Follow-ups due",
      value: debt.data?.followUpsDue ?? null,
      destructive: false,
    },
  ];

  return (
    <div className="mt-5 space-y-3">
      <div className="grid gap-4 sm:grid-cols-3">
        {cells.map((cell) => (
          <Link
            key={cell.id}
            to="/modules/comms/queue"
            className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-royal/25"
          >
            <p className="text-xs text-muted-foreground">{cell.label}</p>
            {cell.value === null ? (
              <p className="mt-1 text-sm text-muted-foreground">Not readable</p>
            ) : (
              <p
                className={cn(
                  "mt-1 text-2xl font-semibold",
                  cell.destructive && cell.value > 0 ? "text-destructive" : "text-foreground",
                )}
              >
                {cell.value}
              </p>
            )}
          </Link>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        A reply owed outranks everything. Target is zero at end of day.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- funnel */

const WEEK_MS = 7 * 86_400_000;

interface FunnelWeek {
  label: string;
  current: boolean;
  firstTouches: number | null;
  discoveryCalls: number | null;
  proposalsSent: number | null;
  runClients: number | null;
}

function funnelWeekLabel(week: WeekWindow): string {
  const start = new Date(week.start);
  const lastDay = new Date(new Date(week.end).getTime() - 1);
  const short = (date: Date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${short(start)} – ${short(lastDay)}`;
}

/**
 * The trailing four business weeks, each read through the same
 * `readWeeklyScoreboard` derivation the commercial targets use, anchored a
 * week apart. Run clients is current tier state, not a dated event, so only
 * the current week can honestly claim it; past weeks show nothing.
 */
async function readFunnelWeeks(organizationId: string): Promise<FunnelWeek[]> {
  const anchors = [3, 2, 1, 0].map((weeksBack) => new Date(Date.now() - weeksBack * WEEK_MS));
  const boards = await Promise.all(
    anchors.map((anchor) => readWeeklyScoreboard(organizationId, anchor)),
  );
  return boards.map((board, index) => {
    const current = index === boards.length - 1;
    return {
      label: funnelWeekLabel(board.week),
      current,
      firstTouches: board.firstTouches,
      discoveryCalls: board.discoveryCalls,
      proposalsSent: board.proposalsSent,
      runClients: current ? board.runClients : null,
    };
  });
}

interface ProposalTurnaround {
  /** Null when no sent proposal in the window has a discovery call to pair with. */
  medianDays: number | null;
  sample: number;
}

/**
 * Days from discovery call to proposal sent, per deal: for each roadmap with a
 * real `proposal_sent_at` and a linked relationship, the most recent
 * human-labelled discovery touch (`comms_touches.meeting_kind = 'discovery'`)
 * on that relationship before the send. Both timestamps are recorded facts;
 * a proposal with no discovery call on its relationship is left out, never
 * approximated. A failed read is null, never a quiet zero.
 */
async function readProposalTurnaround(
  organizationId: string,
  sinceISO: string,
): Promise<ProposalTurnaround | null> {
  const proposals = await supabase
    .from("roadmaps")
    .select("relationship_id, proposal_sent_at")
    .eq("organization_id", organizationId)
    .not("relationship_id", "is", null)
    .gte("proposal_sent_at", sinceISO);
  if (proposals.error) return null;

  const sent = ((proposals.data ?? []) as Record<string, unknown>[]).filter(
    (row) => typeof row["proposal_sent_at"] === "string" && row["relationship_id"],
  );
  if (sent.length === 0) return { medianDays: null, sample: 0 };

  const relationshipIds = [...new Set(sent.map((row) => String(row["relationship_id"])))];
  const touches = await supabase
    .from("comms_touches")
    .select("relationship_id, occurred_at")
    .eq("organization_id", organizationId)
    .eq("meeting_kind", "discovery")
    .in("relationship_id", relationshipIds);
  if (touches.error) return null;

  const callsByRelationship = new Map<string, number[]>();
  for (const touch of (touches.data ?? []) as Record<string, unknown>[]) {
    const at = new Date(String(touch["occurred_at"] ?? "")).getTime();
    if (Number.isNaN(at)) continue;
    const key = String(touch["relationship_id"]);
    callsByRelationship.set(key, [...(callsByRelationship.get(key) ?? []), at]);
  }

  const days: number[] = [];
  for (const row of sent) {
    const sentAt = new Date(String(row["proposal_sent_at"])).getTime();
    if (Number.isNaN(sentAt)) continue;
    const before = (callsByRelationship.get(String(row["relationship_id"])) ?? []).filter(
      (at) => at <= sentAt,
    );
    if (before.length === 0) continue;
    days.push((sentAt - Math.max(...before)) / 86_400_000);
  }
  if (days.length === 0) return { medianDays: null, sample: 0 };

  days.sort((a, b) => a - b);
  const mid = Math.floor(days.length / 2);
  const median = days.length % 2 === 1 ? days[mid]! : (days[mid - 1]! + days[mid]!) / 2;
  return { medianDays: Math.round(median * 10) / 10, sample: days.length };
}

/** "—" whenever either side is unknown or the denominator is zero. */
function conversionRatio(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null || denominator === 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

/** A total is only a total when every week answered. */
function funnelTotal(values: (number | null)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

function FunnelSection() {
  const identity = useSettingsIdentity();

  const funnel = useQuery({
    queryKey: ["outcomes", "funnel", identity.organizationId],
    queryFn: async () => {
      const weeks = await readFunnelWeeks(identity.organizationId);
      const since = new Date(Date.now() - 4 * WEEK_MS).toISOString();
      const turnaround = await readProposalTurnaround(identity.organizationId, since);
      return { weeks, turnaround };
    },
  });

  if (funnel.error) {
    return (
      <p role="alert" className="mt-4 text-sm text-destructive">
        {(funnel.error as Error).message}
      </p>
    );
  }
  if (funnel.isPending) {
    return <p className="mt-4 text-sm text-muted-foreground">Loading funnel…</p>;
  }

  const weeks = funnel.data.weeks;
  const turnaround = funnel.data.turnaround;
  const totals = {
    firstTouches: funnelTotal(weeks.map((week) => week.firstTouches)),
    discoveryCalls: funnelTotal(weeks.map((week) => week.discoveryCalls)),
    proposalsSent: funnelTotal(weeks.map((week) => week.proposalsSent)),
  };
  const cell = (value: number | null) => (value === null ? "—" : value);

  return (
    <div className="mt-5 space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Week</th>
              <th className="py-2 pr-4 font-medium">First touches</th>
              <th className="py-2 pr-4 font-medium">Discovery calls</th>
              <th className="py-2 pr-4 font-medium">Proposals</th>
              <th className="py-2 font-medium">Run clients</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week.label} className="border-t border-border">
                <td className="py-2 pr-4 text-foreground">
                  {week.label}
                  {week.current ? (
                    <span className="ml-2 text-xs text-muted-foreground">this week</span>
                  ) : null}
                </td>
                <td className="py-2 pr-4 text-foreground">{cell(week.firstTouches)}</td>
                <td className="py-2 pr-4 text-foreground">{cell(week.discoveryCalls)}</td>
                <td className="py-2 pr-4 text-foreground">{cell(week.proposalsSent)}</td>
                <td className="py-2 text-foreground">{cell(week.runClients)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <MetaPill>
          First touch → discovery {conversionRatio(totals.discoveryCalls, totals.firstTouches)}
        </MetaPill>
        <MetaPill>
          Discovery → proposal {conversionRatio(totals.proposalsSent, totals.discoveryCalls)}
        </MetaPill>
        <MetaPill>Proposal → run —</MetaPill>
      </div>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          — means that source could not be read for that week. Run clients is current tier state,
          not a dated event, so it shows for this week only and proposal → run has no honest
          per-week conversion yet.
        </p>
        {turnaround === null ? (
          <p className="text-xs text-muted-foreground">Proposal turnaround: not readable.</p>
        ) : turnaround.medianDays === null ? (
          <p className="text-xs text-muted-foreground">
            Turnaround not measurable yet — no proposal in this window has a paired discovery
            call.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Proposal turnaround: median {turnaround.medianDays}{" "}
            {turnaround.medianDays === 1 ? "day" : "days"} from discovery call to proposal sent,
            across {turnaround.sample} {turnaround.sample === 1 ? "proposal" : "proposals"}.
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- scout messaging */

interface WindowDraft {
  days: "weekdays" | "all";
  startHour: number;
  endHour: number;
}

function toWindowDraft(window: SendWindow): WindowDraft {
  const days = window.days && window.days.length > 0 ? window.days : [1, 2, 3, 4, 5];
  return {
    days: days.length >= 7 ? "all" : "weekdays",
    startHour: window.start_hour ?? 8,
    endHour: window.end_hour ?? 18,
  };
}

function toSendWindow(draft: WindowDraft): SendWindow {
  return {
    days: draft.days === "all" ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5],
    start_hour: draft.startHour,
    end_hour: draft.endHour,
    tz: "America/Chicago",
  };
}

function formatEdited(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 ? "am" : "pm"}`;
}

function ScoutMessagingSection() {
  const identity = useSettingsIdentity();
  const queryClient = useQueryClient();
  const context = { organizationId: identity.organizationId, userId: identity.userId };

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [windowDraft, setWindowDraft] = useState<WindowDraft>({
    days: "weekdays",
    startHour: 8,
    endHour: 18,
  });
  const [weeklyCap, setWeeklyCap] = useState<number>(STREAM_DEFAULTS.scout_intros.targetCount);

  const templates = useQuery({
    queryKey: ["outcomes", "scout-templates", identity.organizationId],
    queryFn: () => listScoutIntroTemplates(identity.organizationId),
  });

  const activityTargets = useActivityTargets(identity.organizationId);

  const selected = useMemo(() => {
    const list = templates.data ?? [];
    return list.find((template) => template.id === selectedId) ?? list[0] ?? null;
  }, [templates.data, selectedId]);

  // Load the editor whenever the selection lands on a different template.
  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setName(selected.name);
    setSubject(selected.subject ?? "");
    setBody(selected.body);
    setWindowDraft(toWindowDraft(selected.sendWindow));
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cap = (activityTargets.data ?? []).find((record) => record.stream === "scout_intros");
    if (cap) setWeeklyCap(cap.targetCount);
  }, [activityTargets.data]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["outcomes", "scout-templates", identity.organizationId] });

  const saveTemplate = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No template selected.");
      await updateScoutIntroTemplate(
        selected.id,
        { name, subject, body, sendWindow: toSendWindow(windowDraft) },
        context,
      );
      const capRecord = (activityTargets.data ?? []).find(
        (record) => record.stream === "scout_intros",
      );
      if (!capRecord || capRecord.targetCount !== weeklyCap) {
        await saveActivityTarget(
          { stream: "scout_intros", targetCount: weeklyCap, cadence: capRecord?.cadence ?? "week" },
          context,
        );
        await queryClient.invalidateQueries({
          queryKey: ACTIVITY_TARGETS_QUERY_KEY(identity.organizationId),
        });
      }
    },
    onSuccess: async () => {
      await invalidate();
      toast.success("Template saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleActive = useMutation({
    mutationFn: ({ template, active }: { template: ScoutIntroTemplate; active: boolean }) =>
      updateScoutIntroTemplate(template.id, { active }, context),
    onSuccess: () => void invalidate(),
    onError: (error: Error) => toast.error(error.message),
  });

  const createTemplate = useMutation({
    mutationFn: () =>
      createScoutIntroTemplate(
        {
          name: "New template",
          subject: "",
          body: "Hi {{name}},\n\nTrust,\nTai",
          active: false,
          sendWindow: toSendWindow({ days: "weekdays", startHour: 8, endHour: 18 }),
        },
        context,
      ),
    onSuccess: async (created) => {
      await invalidate();
      setSelectedId(created.id);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeTemplate = useMutation({
    mutationFn: (templateId: string) => deleteScoutIntroTemplate(templateId, context),
    onSuccess: async () => {
      setSelectedId(null);
      await invalidate();
      toast.success("Template deleted");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (templates.error) {
    return (
      <p role="alert" className="mt-4 text-sm text-destructive">
        {(templates.error as Error).message}
      </p>
    );
  }
  if (templates.isPending) {
    return <p className="mt-4 text-sm text-muted-foreground">Loading templates…</p>;
  }

  const list = templates.data ?? [];
  const verdict = body.trim() ? checkVoice(body, { register: "warm_intro" }) : null;

  return (
    <div className="mt-5 grid gap-6 lg:grid-cols-[280px_1fr]">
      <div className="space-y-2">
        {list.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => setSelectedId(template.id)}
            className={cn(
              "w-full rounded-xl border p-4 text-left transition-colors",
              selected?.id === template.id
                ? "border-royal/35 bg-royal-wash"
                : "border-border bg-card hover:border-royal/25",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{template.name}</p>
              <Toggle
                label={`Toggle ${template.name}`}
                checked={template.active}
                disabled={!identity.canManage}
                onChange={(next) => toggleActive.mutate({ template, active: next })}
              />
            </div>
            {template.subject ? (
              <p className="mt-1 text-xs text-muted-foreground">{template.subject}</p>
            ) : null}
            <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
              Last edited {formatEdited(template.updatedAt ?? template.createdAt)}
            </p>
          </button>
        ))}

        {identity.canManage ? (
          <TTButton
            size="sm"
            variant="secondary"
            className="w-full"
            onClick={() => createTemplate.mutate()}
            disabled={createTemplate.isPending}
          >
            {createTemplate.isPending ? "Creating…" : "New template"}
          </TTButton>
        ) : null}
      </div>

      {selected ? (
        <div className="space-y-5">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-foreground">Template name</span>
            <TTInput
              value={name}
              disabled={!identity.canManage}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-foreground">Subject line</span>
            <TTInput
              value={subject}
              disabled={!identity.canManage}
              onChange={(event) => setSubject(event.target.value)}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-foreground">Body</span>
            <textarea
              value={body}
              disabled={!identity.canManage}
              onChange={(event) => setBody(event.target.value)}
              rows={10}
              className="w-full rounded-lg border border-input bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </label>

          <div>
            <p className="text-xs font-medium text-muted-foreground">Voice check</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {verdict === null ? (
                <MetaPill>Empty body</MetaPill>
              ) : verdict.violations.length === 0 ? (
                <TonePill tone="good" dot>
                  Voice check passed
                </TonePill>
              ) : (
                verdict.violations.map((violation, index) => (
                  <TonePill key={`${violation.ruleId}-${index}`} tone={verdict.passes ? "caution" : "risk"} dot>
                    {violation.because}
                  </TonePill>
                ))
              )}
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <span className="text-sm font-medium text-foreground">Send window</span>
              <div className="flex flex-wrap items-center gap-2">
                <TTSelect
                  value={windowDraft.days}
                  disabled={!identity.canManage}
                  onChange={(event) =>
                    setWindowDraft((current) => ({
                      ...current,
                      days: event.target.value as WindowDraft["days"],
                    }))
                  }
                  className="h-9 w-32"
                  aria-label="Send window days"
                >
                  <option value="weekdays">Weekdays</option>
                  <option value="all">Every day</option>
                </TTSelect>
                <TTSelect
                  value={windowDraft.startHour}
                  disabled={!identity.canManage}
                  onChange={(event) =>
                    setWindowDraft((current) => ({ ...current, startHour: Number(event.target.value) }))
                  }
                  className="h-9 w-24"
                  aria-label="Send window start hour"
                >
                  {HOURS.map((hour) => (
                    <option key={hour} value={hour}>
                      {hourLabel(hour)}
                    </option>
                  ))}
                </TTSelect>
                <span className="text-sm text-muted-foreground">–</span>
                <TTSelect
                  value={windowDraft.endHour}
                  disabled={!identity.canManage}
                  onChange={(event) =>
                    setWindowDraft((current) => ({ ...current, endHour: Number(event.target.value) }))
                  }
                  className="h-9 w-24"
                  aria-label="Send window end hour"
                >
                  {HOURS.map((hour) => (
                    <option key={hour} value={hour}>
                      {hourLabel(hour)}
                    </option>
                  ))}
                </TTSelect>
                <span className="text-xs text-muted-foreground">CT</span>
              </div>
            </div>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">Weekly cap</span>
              <TTInput
                type="number"
                value={weeklyCap}
                disabled={!identity.canManage}
                onChange={(event) => setWeeklyCap(Number(event.target.value))}
                className="text-left"
              />
              <span className="block text-xs text-muted-foreground">
                Shared with the Scout intro ceiling in Activity volumes.
              </span>
            </label>
          </div>

          {identity.canManage ? (
            <div className="flex flex-wrap gap-3">
              <TTButton size="sm" onClick={() => saveTemplate.mutate()} disabled={saveTemplate.isPending}>
                {saveTemplate.isPending ? "Saving…" : "Save template"}
              </TTButton>
              <TTButton
                size="sm"
                variant="quiet"
                onClick={() => removeTemplate.mutate(selected.id)}
                disabled={removeTemplate.isPending}
              >
                Delete template
              </TTButton>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No templates yet. Create one to give Scout something a person wrote.
        </p>
      )}
    </div>
  );
}
