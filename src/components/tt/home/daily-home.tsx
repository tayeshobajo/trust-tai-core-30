import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { cmdTasks } from "@/data/supabase/cmd-tasks";
import { listClientCommercialState } from "@/data/supabase/commercial-service";
import type { StewardDashboardRead } from "@/data/steward/dashboard-read";
import { canSeeApp, type WorkspaceIdentity } from "@/lib/workspace";
import type { StewardTask } from "@/domain/steward-accountability";
import { BOARD_STATUS_LABEL, type BoardTask } from "@/domain/cmd-tasks";
import { StatRow } from "@/components/tt/steward/dashboard/stat-row";
import {
  computeMinutesSaved,
  computeStreakDays,
  computeTasksCompleted,
  computeXp,
  levelForXp,
} from "@/domain/steward-dashboard-stats";
import { taskContextHref } from "@/components/tt/steward/task-context";

const card = "min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6";
const action = "inline-flex min-h-11 items-center text-sm font-semibold text-royal hover:underline";
export function DailyHome({
  identity,
  read,
  onCreate,
  onOpenLegacy,
  onOpenBoard,
  onConfirmGoal,
  confirmingGoal,
}: {
  identity: WorkspaceIdentity;
  read: StewardDashboardRead;
  onCreate: () => void;
  onOpenLegacy: (task: StewardTask) => void;
  onOpenBoard: (task: BoardTask) => void;
  onConfirmGoal: () => void;
  confirmingGoal: boolean;
}) {
  const business = useQuery({
    queryKey: ["cmd-tasks", identity.organizationId, identity.userId, "business"],
    queryFn: () => cmdTasks.list(identity.organizationId, "business"),
  });
  const personal = useQuery({
    queryKey: ["cmd-tasks", identity.organizationId, identity.userId, "personal"],
    queryFn: () => cmdTasks.list(identity.organizationId, "personal"),
  });
  const canReadRevenue = canSeeApp(identity, "clients");
  const revenue = useQuery({
    enabled: canReadRevenue,
    queryKey: ["home-commercial", identity.organizationId, identity.userId],
    queryFn: () => listClientCommercialState(identity.organizationId),
  });
  const now = new Date(read.now);
  const greeting = Number.isNaN(now.getTime())
    ? "Hello"
    : now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 18
        ? "Good afternoon"
        : "Good evening";
  const name = identity.name.trim().split(/\s+/)[0];
  const date = Number.isNaN(now.getTime())
    ? "Date unavailable"
    : now.toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
  const run = (revenue.data ?? []).filter((c) => c.tier === "run");
  const amounts = run.filter((c) => c.mrrCents !== null);
  const total = amounts.reduce((n, c) => n + (c.mrrCents ?? 0), 0);
  const priorities = (business.data?.tasks ?? [])
    .filter((t) => !t.archived_at && t.status !== "complete" && !t.parent_task_id)
    .sort((a, b) => {
      const rank = (t: BoardTask) =>
        t.status === "needs_approval" ? 0 : t.status === "blocked" ? 1 : 2;
      return rank(a) - rank(b) || (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999");
    })
    .slice(0, 3);
  const mine = [
    ...(personal.data?.tasks ?? []),
    ...(business.data?.tasks ?? []).filter((t) => t.owner_user_id === identity.userId),
  ].filter((t) => !t.archived_at);
  const open = mine.filter((t) => t.status !== "complete");
  const done = mine.filter((t) => t.status === "complete");
  const legacy = read.tasks.filter((t) => t.owner.userId === identity.userId);
  const ownGoal = read.weeklyGoal?.ownerUserId === identity.userId ? read.weeklyGoal : null;
  const taskReadFailed = personal.isError || business.isError;
  return (
    <div className="space-y-5 pb-8 sm:space-y-6">
      <header className="flex flex-col gap-3 py-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-royal">Home</p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {greeting}
            {name ? `, ${name}` : ""}
          </h1>
          <p className="mt-3 text-muted-foreground">A clear place to start your day.</p>
        </div>
        <p className="flex items-center gap-3 text-sm text-muted-foreground">
          <CalendarDays className="size-5 text-royal" aria-hidden />
          {date}
        </p>
      </header>
      <section
        className={`${card} grid grid-cols-2 gap-5 lg:grid-cols-[1fr_1.3fr_1fr]`}
        aria-label="Revenue snapshot"
      >
        <div>
          <p className="text-xs font-bold uppercase text-muted-foreground">Monthly direction</p>
          <p className="mt-3 font-display text-3xl font-semibold">Not verified</p>
          <p className="mt-2 text-xs text-muted-foreground">Review the saved target in Outcomes.</p>
        </div>
        <div className="border-l border-border pl-5">
          <p className="text-xs font-bold uppercase text-muted-foreground">Recorded Run MRR</p>
          <p className="mt-3 break-words font-display text-3xl font-semibold">
            {!canReadRevenue
              ? "Unavailable"
              : revenue.isPending
                ? "Loading…"
                : revenue.isError || !amounts.length
                  ? "Unknown"
                  : new Intl.NumberFormat(undefined, {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 0,
                    }).format(total / 100)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {!canReadRevenue
              ? "Clients access required"
              : revenue.isError
                ? "Revenue source unavailable"
                : revenue.isPending
                  ? "Reading Clients"
                  : `${amounts.length} of ${run.length} visible Run client amounts recorded`}
          </p>
          <p className="mt-1 text-xs font-semibold text-amber-700">Coverage unverified</p>
        </div>
        <div className="col-span-2 border-t border-border pt-4 lg:col-span-1 lg:border-t-0 lg:pt-0">
          <p className="font-semibold text-muted-foreground">Not comparable yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">No gap calculated.</p>
          <details className="mt-2">
            <summary className={`${action} cursor-pointer`}>Source and definitions</summary>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Current member-visible Clients records, Run tier, USD per month. Recorded values are
              not collected revenue or complete coverage. No historical mockup values are used. Read{" "}
              {revenue.dataUpdatedAt
                ? new Date(revenue.dataUpdatedAt).toLocaleString()
                : "not yet available"}
              .
            </p>
            <Link to="/settings/outcomes" className={action}>
              Review saved targets
            </Link>
          </details>
        </div>
      </section>
      <div className="grid items-start gap-5 lg:grid-cols-[1.35fr_1fr] lg:gap-6">
        <section
          className={`${card} order-2 lg:order-1 lg:row-span-2`}
          aria-labelledby="home-priorities"
        >
          <h2 id="home-priorities" className="font-display text-2xl font-semibold">
            Today’s Business Priorities
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Decisions and open work that need attention.
          </p>
          {business.isPending ? (
            <p role="status" className="py-6">
              Loading business work…
            </p>
          ) : business.isError ? (
            <p role="alert" className="py-6">
              Business work could not be read.{" "}
              <button className={action} onClick={() => void business.refetch()}>
                Retry
              </button>
            </p>
          ) : !priorities.length ? (
            <p className="py-6 text-sm text-muted-foreground">No open business tasks recorded.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {priorities.map((task) => (
                <li key={task.id} className="py-5">
                  <p className="text-xs font-bold uppercase text-royal">
                    {BOARD_STATUS_LABEL[task.status]}
                  </p>
                  <h3 className="mt-2 font-display text-lg font-semibold">{task.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {task.next_action || "Next action not recorded"}
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {task.owner_label || (task.owner_user_id ? "Assigned teammate" : "Unassigned")}
                    {task.due_at
                      ? ` · Due ${new Date(task.due_at).toLocaleDateString()}`
                      : " · No due date"}
                  </p>
                  {task.blocked_because ? (
                    <p className="mt-2 text-sm text-amber-700">Blocked: {task.blocked_because}</p>
                  ) : null}
                  <details className="mt-2">
                    <summary className={`${action} cursor-pointer`}>Source, scope and age</summary>
                    <p className="text-xs text-muted-foreground">
                      Shared business task · Updated {new Date(task.updated_at).toLocaleString()}.
                      Planned work; delivery needs a checked result.
                    </p>
                    {task.context_links.length ? (
                      task.context_links.map((link, i) => {
                        const href = taskContextHref(link.url);
                        return href ? (
                          <a
                            key={i}
                            href={href}
                            className={`${action} mr-3`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {link.label}
                          </a>
                        ) : null;
                      })
                    ) : (
                      <p className="mt-2 text-xs">No external source link recorded.</p>
                    )}
                  </details>
                  <button className={action} onClick={() => onOpenBoard(task)}>
                    Open task
                  </button>
                </li>
              ))}
            </ul>
          )}
          {business.data?.truncated ? (
            <p className="text-xs">Read limit reached; this is a partial view.</p>
          ) : null}
          <Link
            to="/modules/steward/board"
            className={`${action} mt-4 border-t border-border pt-4 w-full`}
          >
            View all business work →
          </Link>
          <Link to="/modules/pulse" className={action}>
            View business signals in Pulse
          </Link>
        </section>
        <section className={`${card} order-1 lg:order-2`} aria-labelledby="home-my-tasks">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="home-my-tasks" className="font-display text-2xl font-semibold">
              My Tasks
            </h2>
            <button
              onClick={onCreate}
              className="min-h-11 rounded-full bg-royal px-5 py-2 text-sm font-semibold text-white"
            >
              + New task
            </button>
          </div>
          <Link
            to="/modules/steward/board"
            search={{ scope: "personal" }}
            className={`${action} mt-1`}
          >
            View all
          </Link>
          {personal.isPending || business.isPending ? (
            <p role="status">Loading your task board…</p>
          ) : taskReadFailed ? (
            <p role="alert">
              Some tasks could not be read.{" "}
              <button
                className={action}
                onClick={() => {
                  void personal.refetch();
                  void business.refetch();
                }}
              >
                Retry
              </button>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {open.length} open · {done.length} delivered in your task board
            </p>
          )}
          <ul className="mt-3 divide-y divide-border">
            {open.slice(0, 4).map((task) => (
              <li key={task.id} className="py-4">
                <button
                  className="text-left font-semibold hover:text-royal"
                  onClick={() => onOpenBoard(task)}
                >
                  {task.title}
                </button>
                <p className="mt-1 text-xs text-muted-foreground">
                  {BOARD_STATUS_LABEL[task.status]} ·{" "}
                  {task.task_visibility === "personal" ? "Private" : "Assigned to me"}
                </p>
                {task.blocked_because ? (
                  <p className="mt-1 text-xs text-amber-700">{task.blocked_because}</p>
                ) : null}
                <button className={`${action} mt-1`} onClick={() => onOpenBoard(task)}>
                  Review / complete
                </button>
              </li>
            ))}
            {legacy
              .filter((t) => t.state !== "complete")
              .slice(0, 3)
              .map((task) => (
                <li key={task.key} className="py-4">
                  <button
                    className="text-left font-semibold hover:text-royal"
                    onClick={() => onOpenLegacy(task)}
                  >
                    {task.title}
                  </button>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {task.sourceLabel} · {task.state}
                  </p>
                  <button className={action} onClick={() => onOpenLegacy(task)}>
                    Review task
                  </button>
                </li>
              ))}
          </ul>
          {!taskReadFailed &&
          !personal.isPending &&
          !business.isPending &&
          !open.length &&
          !legacy.filter((t) => t.state !== "complete").length ? (
            <p className="py-4 text-sm text-muted-foreground">No open tasks assigned to you.</p>
          ) : null}
          <details className="mt-3 border-t border-border pt-3">
            <summary className={`${action} cursor-pointer`}>View completed work</summary>
            <ul>
              {done.map((t) => (
                <li key={t.id}>
                  <button className={action} onClick={() => onOpenBoard(t)}>
                    {t.title}
                  </button>
                </li>
              ))}
              {legacy
                .filter((t) => t.state === "complete")
                .map((t) => (
                  <li key={t.key}>
                    <button className={action} onClick={() => onOpenLegacy(t)}>
                      {t.title}
                    </button>
                  </li>
                ))}
            </ul>
          </details>
          <Link to="/modules/steward/tasks" className="text-xs text-muted-foreground underline">
            Existing Steward checklist
          </Link>
        </section>
        <section className={`${card} order-3`} aria-labelledby="home-meeting">
          <h2
            id="home-meeting"
            className="flex items-center gap-3 font-display text-xl font-semibold"
          >
            <CalendarDays aria-hidden className="size-5 text-royal" />
            Meeting preparation
          </h2>
          <p className="mt-4 inline-block rounded-full bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
            Source needed
          </p>
          <h3 className="mt-3 font-semibold">No confirmed meeting time</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Choose a real meeting or saved call to prepare context, questions and open promises.
          </p>
          <details className="mt-3">
            <summary className={`${action} cursor-pointer`}>Source details</summary>
            <p className="text-xs text-muted-foreground">
              Steward Meetings · calendar coverage unverified. A saved transcript does not establish
              an upcoming event.
            </p>
          </details>
          <Link to="/modules/steward/meetings" className={`${action} mt-2`}>
            Open Steward Meetings →
          </Link>
        </section>
      </div>
      <section className={card} aria-labelledby="home-week-focus">
        <p id="home-week-focus" className="text-xs font-bold uppercase text-muted-foreground">
          This week’s focus
        </p>
        <h2 className="mt-3 font-display text-xl font-semibold">
          {ownGoal?.title || "No weekly goal recorded"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {ownGoal
            ? `${ownGoal.status === "proposed" ? "Proposed · Not yet confirmed" : ownGoal.status}`
            : "Choose your outcome in Steward."}
        </p>
        <details className="mt-3">
          <summary className={`${action} cursor-pointer`}>Review goal</summary>
          {ownGoal ? (
            <>
              <p className="text-sm text-muted-foreground">
                {ownGoal.notes || "No additional goal notes recorded."}
              </p>
              {ownGoal.status === "proposed" ? (
                <button disabled={confirmingGoal} onClick={onConfirmGoal} className={action}>
                  {confirmingGoal ? "Confirming…" : "Confirm my goal"}
                </button>
              ) : null}
            </>
          ) : (
            <Link to="/modules/steward" className={action}>
              Open Steward
            </Link>
          )}
        </details>
      </section>
      <details>
        <summary className={`${action} cursor-pointer`}>My progress</summary>
        <p className="my-3 text-xs text-muted-foreground">
          Recorded Steward activity and legacy tasks. Task-board deliveries are shown in My Tasks
          above; they are not added to activity-derived XP.
        </p>
        <StatRow
          streakDays={computeStreakDays(
            read.activities.map((e) => e.occurredAt),
            read.now,
          )}
          level={levelForXp(computeXp(read.activities))}
          tasksCompleted={computeTasksCompleted(read.tasks, identity.userId)}
          minutesSaved={computeMinutesSaved(read.activities)}
        />
        <a href="/modules/activity" className={action}>
          View recorded activity
        </a>
      </details>
    </div>
  );
}
