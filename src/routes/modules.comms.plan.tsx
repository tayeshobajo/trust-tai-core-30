/**
 * The Comms plan.
 *
 * What happens next with each person — meetings that are set, promises still
 * open, replies owed, follow-ups someone dated — beside a month calendar so
 * nothing slips between labeled mail and Scout.
 *
 * Every line rests on something a person recorded. Dates are only ever set by
 * a human, here or in the relationship itself.
 */

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AppShell } from "@/components/tt/app-shell";
import { CommsTabs } from "@/components/tt/comms/comms-tabs";
import { ScoutConversationLink } from "@/components/tt/comms/scout-link";
import { PageHeader, TTButton, TTInput } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { commsService } from "@/data/supabase/comms-service";
import {
  buildPlan,
  dayKey,
  dueLabel,
  inScope,
  itemsByDay,
  monthGrid,
  PLAN_KIND_LABEL,
  PLAN_SCOPE_LABEL,
  PLAN_SCOPES,
  type PersonPlan,
  type PlanScope,
} from "@/domain/comms-plan";
import { cn } from "@/lib/utils";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Plan · Comms · Trust Tai OS";
const DESCRIPTION =
  "Each person's next steps in Comms: meetings that are set, promises still open, replies owed, and dated follow-ups on one calendar.";

export const Route = createFileRoute("/modules/comms/plan")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PlanRoute,
});

function PlanRoute() {
  return (
    <WorkspaceGate appId="comms">
      {(identity) => (
        <AppShell identity={identity}>
          <PlanView identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function PlanView({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<PlanScope>("all");
  const [month, setMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const relationships = useQuery({
    queryKey: ["comms", "plan", "relationships", identity.organizationId],
    queryFn: () => commsService.list(identity.organizationId),
  });

  const now = new Date();
  const plans = useMemo(
    () => buildPlan(relationships.data ?? [], now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [relationships.data],
  );

  const scoped = useMemo(
    () =>
      plans
        .map((plan) => ({
          ...plan,
          items: plan.items.filter((item) => inScope(item, scope, now)),
        }))
        .filter((plan) => plan.items.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plans, scope],
  );

  const buckets = useMemo(() => itemsByDay(plans), [plans]);
  const dayItems = selectedDay ? (buckets[selectedDay] ?? []) : [];

  const setFollowUp = useMutation({
    mutationFn: ({ plan, date }: { plan: PersonPlan; date: string }) =>
      commsService.update(
        plan.relationship.id,
        { followUpDueAt: date ? new Date(`${date}T09:00:00`).toISOString() : null },
        { organizationId: identity.organizationId, userId: identity.userId },
      ),
    onSuccess: (_data, variables) => {
      toast.success(variables.date ? "Follow-up date saved" : "Follow-up cleared", {
        description: variables.plan.relationship.fullName,
      });
      void queryClient.invalidateQueries({ queryKey: ["comms"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const loading = relationships.isLoading;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Comms"
        title="Plan"
        supporting="Each person's next steps and the dates behind them. Nothing here is invented — every line comes from something you or they recorded."
        appId="comms"
      />
      <CommsTabs active="plan" />

      {relationships.error ? (
        <p className="text-sm text-destructive">
          {relationships.error instanceof Error
            ? relationships.error.message
            : "That read failed."}
        </p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Reading your plan…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {PLAN_SCOPES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setScope(option)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[12px] transition-colors",
                    option === scope
                      ? "border-[var(--royal)] text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {PLAN_SCOPE_LABEL[option]}
                </button>
              ))}
            </div>

            {scoped.length === 0 ? (
              <p className="rounded-xl border border-border p-6 text-sm text-muted-foreground">
                Nothing is outstanding in this view. When a meeting is set, a promise is made or
                you date a follow-up, it appears here.
              </p>
            ) : (
              <ul className="space-y-3">
                {scoped.map((plan) => (
                  <li key={plan.relationship.id} className="rounded-xl border border-border p-4">
                    <header className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-[15px] text-foreground">
                          {plan.relationship.fullName}
                          {plan.relationship.companyName ? (
                            <span className="text-muted-foreground">
                              {" "}
                              · {plan.relationship.companyName}
                            </span>
                          ) : null}
                        </h2>
                        <p className="text-[12px] text-muted-foreground">
                          {plan.overdueCount > 0
                            ? `${plan.overdueCount} overdue`
                            : plan.nextAt
                              ? `Next: ${dueLabel(plan.nextAt, now)}`
                              : "No date set"}
                        </p>
                      </div>
                      <ScoutConversationLink relationship={plan.relationship} />
                    </header>

                    <ul className="mt-3 space-y-2">
                      {plan.items.map((item) => (
                        <li
                          key={item.id}
                          className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2"
                        >
                          <span className="text-[13px] text-foreground">
                            <span className="mr-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                              {PLAN_KIND_LABEL[item.kind]}
                            </span>
                            {item.title}
                            <span className="block text-[12px] text-muted-foreground">
                              {item.reason}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "text-[12px]",
                              item.overdue ? "text-destructive" : "text-muted-foreground",
                            )}
                          >
                            {dueLabel(item.dueAt, now)}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <label className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                      Follow-up date
                      <TTInput
                        type="date"
                        className="h-9 w-[170px]"
                        defaultValue={
                          plan.relationship.followUpDueAt
                            ? dayKey(plan.relationship.followUpDueAt)
                            : ""
                        }
                        onChange={(event) =>
                          setFollowUp.mutate({ plan, date: event.target.value })
                        }
                        disabled={setFollowUp.isPending}
                      />
                      {plan.relationship.followUpDueAt ? (
                        <TTButton
                          variant="ghost"
                          size="sm"
                          disabled={setFollowUp.isPending}
                          onClick={() => setFollowUp.mutate({ plan, date: "" })}
                        >
                          Clear
                        </TTButton>
                      ) : null}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <Calendar
              month={month}
              buckets={buckets}
              selectedDay={selectedDay}
              onMonth={setMonth}
              onSelect={setSelectedDay}
            />
            <div className="rounded-xl border border-border p-4">
              <h3 className="text-[13px] text-foreground">
                {selectedDay ? new Date(`${selectedDay}T12:00:00`).toDateString() : "Pick a day"}
              </h3>
              {selectedDay && dayItems.length === 0 ? (
                <p className="mt-1 text-[13px] text-muted-foreground">Nothing on this day.</p>
              ) : null}
              <ul className="mt-2 space-y-2">
                {dayItems.map((item) => (
                  <li key={item.id} className="text-[13px] text-foreground">
                    <span className="mr-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {PLAN_KIND_LABEL[item.kind]}
                    </span>
                    {item.personName}: {item.title}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function Calendar({
  month,
  buckets,
  selectedDay,
  onMonth,
  onSelect,
}: {
  month: Date;
  buckets: Record<string, ReturnType<typeof itemsByDay>[string]>;
  selectedDay: string | null;
  onMonth: (next: Date) => void;
  onSelect: (key: string) => void;
}) {
  const days = useMemo(() => monthGrid(month), [month]);
  const today = dayKey(new Date());

  return (
    <div className="rounded-xl border border-border p-4">
      <header className="flex items-center justify-between">
        <TTButton
          variant="ghost"
          size="sm"
          onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          aria-label="Previous month"
        >
          ←
        </TTButton>
        <h3 className="text-[13px] text-foreground">
          {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </h3>
        <TTButton
          variant="ghost"
          size="sm"
          onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          aria-label="Next month"
        >
          →
        </TTButton>
      </header>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {WEEKDAYS.map((label, index) => (
          <span key={`${label}-${index}`}>{label}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = dayKey(day);
          const count = buckets[key]?.length ?? 0;
          const outside = day.getMonth() !== month.getMonth();
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              className={cn(
                "flex h-11 flex-col items-center justify-center rounded-lg border text-[12px] transition-colors",
                key === selectedDay
                  ? "border-[var(--royal)] text-foreground"
                  : "border-transparent hover:bg-secondary/40",
                outside ? "text-muted-foreground/50" : "text-foreground",
                key === today && key !== selectedDay ? "bg-secondary/60" : "",
              )}
            >
              {day.getDate()}
              {count > 0 ? (
                <span
                  className="mt-0.5 h-1.5 w-1.5 rounded-full bg-[var(--royal)]"
                  aria-label={`${count} item${count === 1 ? "" : "s"}`}
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
