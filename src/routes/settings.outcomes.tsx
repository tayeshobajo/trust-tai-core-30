/**
 * Outcomes settings: commercial targets, activity volumes, Scout messaging.
 *
 * Targets are configuration; actuals are derived at read time and never
 * persisted. Everything saves through the authenticated browser client, so
 * RLS applies as the signed-in person.
 */

import { createFileRoute } from "@tanstack/react-router";
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
import { checkVoice } from "@/data/voice-policy";
import { supabase } from "@/integrations/trust-tai/supabase";
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
