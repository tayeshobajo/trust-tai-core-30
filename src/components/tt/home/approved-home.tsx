import type { ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  FileText,
  Package,
  Users,
} from "lucide-react";
import { cmdTasks } from "@/data/supabase/cmd-tasks";
import { listClientCommercialState } from "@/data/supabase/commercial-service";
import { stewardService } from "@/data/supabase/steward-service";
import { BOARD_STATUS_LABEL } from "@/domain/cmd-tasks";
import { canSeeApp } from "@/lib/workspace";
import type { DailyHome } from "./daily-home";
import "./approved-home.css";

/** Real member-visible sources only; roadmap stage totals need a verified read contract. */
export function ApprovedHome({
  identity,
  read,
  onCreate,
  onOpenBoard,
  onOpenLegacy,
  onConfirmGoal,
  confirmingGoal,
}: ComponentProps<typeof DailyHome>) {
  const can = (app: string) => canSeeApp(identity, app);
  const business = useQuery({
    queryKey: ["cmd-tasks", identity.organizationId, identity.userId, "business"],
    queryFn: () => cmdTasks.list(identity.organizationId, "business"),
  });
  const personal = useQuery({
    queryKey: ["cmd-tasks", identity.organizationId, identity.userId, "personal"],
    queryFn: () => cmdTasks.list(identity.organizationId, "personal"),
  });
  const revenue = useQuery({
    enabled: can("clients"),
    queryKey: ["home-commercial", identity.organizationId, identity.userId],
    queryFn: () => listClientCommercialState(identity.organizationId),
  });
  const meetings = useQuery({
    enabled: can("steward"),
    queryKey: ["home-meetings", identity.organizationId, identity.userId],
    queryFn: () => stewardService.conversations(identity.organizationId, 3),
  });
  const now = new Date(read.now);
  const validDate = Number.isFinite(now.getTime());
  const greeting = !validDate
    ? "Hello"
    : now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 18
        ? "Good afternoon"
        : "Good evening";
  const name = identity.name.trim().split(/\s+/)[0];
  const goal = read.weeklyGoal?.ownerUserId === identity.userId ? read.weeklyGoal : null;
  const priorities = [...(business.data?.tasks ?? [])]
    .filter((t) => !t.archived_at && t.status !== "complete" && !t.parent_task_id)
    .sort((a, b) => {
      const rank = (status: string) =>
        status === "needs_approval" ? 0 : status === "blocked" ? 1 : 2;
      return (
        rank(a.status) - rank(b.status) || (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999")
      );
    })
    .slice(0, 3);
  const mine = [
    ...(personal.data?.tasks ?? []),
    ...(business.data?.tasks ?? []).filter((t) => t.owner_user_id === identity.userId),
  ].filter((t) => !t.archived_at);
  const run = (revenue.data ?? []).filter((c) => c.tier === "run");
  const amounts = run.filter((c) => c.mrrCents !== null && Number.isFinite(c.mrrCents));
  const revenueState = !can("clients")
    ? "Clients access required"
    : revenue.isPending
      ? "Reading Clients…"
      : revenue.isError
        ? "Revenue source unavailable"
        : !amounts.length
          ? "No recurring amounts recorded"
          : "Coverage unverified";
  return (
    <div className="cmd-home">
      <header className="cmd-home-header">
        <div>
          <p className="cmd-eyebrow">Home</p>
          <h1>
            {greeting}
            {name ? `, ${name}` : ""}
          </h1>
          <p className="cmd-subtitle">Move the right work forward.</p>
        </div>
        <div className="cmd-header-actions">
          <p className="cmd-date">
            <CalendarDays aria-hidden="true" />
            {validDate
              ? now.toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })
              : "Date unavailable"}
          </p>
          {can("roadmap") && (
            <Link className="cmd-primary" to="/modules/roadmap">
              Open roadmaps <ArrowRight aria-hidden="true" />
            </Link>
          )}
        </div>
      </header>
      <section className="cmd-focus" aria-labelledby="cmd-focus-title">
        <div>
          <p className="cmd-eyebrow">Your focus</p>
          <h2 id="cmd-focus-title">
            {goal?.title || "Turn approved roadmaps into live client systems."}
          </h2>
        </div>
        <span className="cmd-pill">{goal ? goal.status : "Suggested direction"}</span>
        <details>
          <summary>Review goal</summary>
          <div className="cmd-goal-detail">
            {goal ? (
              <>
                <p>{goal.notes || "No additional goal notes recorded."}</p>
                {goal.status === "proposed" && (
                  <button onClick={onConfirmGoal} disabled={confirmingGoal}>
                    {confirmingGoal ? "Confirming…" : "Confirm my goal"}
                  </button>
                )}
              </>
            ) : (
              <p>
                No saved personal goal available.{" "}
                {can("steward") && <Link to="/modules/steward">Review in Steward →</Link>}
              </p>
            )}
          </div>
        </details>
      </section>
      <div className="cmd-home-grid">
        <div className="cmd-main-column">
          <section className="cmd-card cmd-priorities" aria-labelledby="cmd-priorities-title">
            <div className="cmd-section-heading">
              <div>
                <h2 id="cmd-priorities-title">Today’s priorities</h2>
                <p>Decisions and open business work that need attention.</p>
              </div>
              {can("steward") && (
                <Link to="/modules/steward/board" aria-label="View business work">
                  View all <ArrowRight aria-hidden="true" />
                </Link>
              )}
            </div>
            {business.isPending ? (
              <p role="status" className="cmd-empty">
                Loading business work…
              </p>
            ) : business.isError ? (
              <p role="alert" className="cmd-empty">
                Business work could not be read.{" "}
                <button onClick={() => void business.refetch()}>Retry</button>
              </p>
            ) : priorities.length ? (
              <ol className="cmd-priority-list">
                {priorities.map((task, i) => (
                  <li key={task.id}>
                    <span className="cmd-number">{String(i + 1).padStart(2, "0")}</span>
                    <span
                      className={`cmd-dot ${task.status === "blocked" || task.status === "needs_approval" ? "cmd-dot-attention" : ""}`}
                      aria-hidden="true"
                    />
                    <div className="cmd-priority-copy">
                      <span className="cmd-status">{BOARD_STATUS_LABEL[task.status]}</span>
                      <h3>{task.title}</h3>
                    </div>
                    <p className="cmd-next-action">
                      {task.blocked_because || task.next_action || "Next action not recorded"}
                    </p>
                    <button
                      className="cmd-outline"
                      onClick={() => onOpenBoard(task)}
                      aria-label={`Review ${task.title}`}
                    >
                      <span>Review</span>
                      <ChevronRight aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="cmd-empty">
                <FileText aria-hidden="true" />
                <h3>No open business tasks recorded.</h3>
                <p>Saved work will appear here. Roadmap examples are not live tasks.</p>
              </div>
            )}
            {business.data?.truncated && (
              <p className="cmd-source-note">Read limit reached; priorities are a partial view.</p>
            )}
          </section>
          <section className="cmd-card cmd-roadmap" aria-labelledby="cmd-roadmap-title">
            <div className="cmd-section-heading">
              <h2 id="cmd-roadmap-title">Roadmap workspace</h2>
              {can("roadmap") && (
                <Link to="/modules/roadmap">
                  View all <ArrowRight aria-hidden="true" />
                </Link>
              )}
            </div>
            <ol className="cmd-stages" aria-label="Roadmap workflow, not current progress">
              {["Prepare", "Sent", "Follow up", "Approved", "Build"].map((stage, i) => (
                <li key={stage}>
                  <span>{i + 1}</span>
                  <p>{stage}</p>
                  {i < 4 && <ArrowRight aria-hidden="true" />}
                </li>
              ))}
            </ol>
            <p className="cmd-source-note">
              Sent = verified delivery. Approval is recorded separately.
            </p>
            <dl className="cmd-stage-totals">
              {["Sent today", "Follow-ups due", "Approved builds"].map((label) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd aria-label="Unavailable">—</dd>
                </div>
              ))}
            </dl>
            <p className="cmd-source-note">Verified activity totals are not connected to Home.</p>
            <div className="cmd-workflow-links">
              {can("roadmap") ? (
                <Link to="/modules/roadmap">
                  <FileText aria-hidden="true" />
                  <strong>Roadmap follow-through</strong>
                  <span>Last sent → next contact</span>
                  <ChevronRight aria-hidden="true" />
                </Link>
              ) : (
                <p>Roadmaps access required.</p>
              )}
              {can("roadmap") && (
                <Link to="/modules/roadmap">
                  <Package aria-hidden="true" />
                  <strong>Approved roadmap builds</strong>
                  <span>Approval → milestone → blocker</span>
                  <ChevronRight aria-hidden="true" />
                </Link>
              )}
            </div>
            <p className="cmd-source-note cmd-desktop-note">
              Review the roadmap’s recorded state before taking action.
            </p>
          </section>
        </div>
        <aside className="cmd-support-column" aria-label="Business context">
          <section className="cmd-card cmd-revenue" aria-labelledby="cmd-revenue-title">
            <h2 id="cmd-revenue-title">
              <ChartNoAxesCombined aria-hidden="true" />
              Recurring revenue
            </h2>
            <div className="cmd-revenue-value">
              <strong>
                {can("clients") && !revenue.isPending && !revenue.isError && amounts.length
                  ? new Intl.NumberFormat(undefined, {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 0,
                    }).format(amounts.reduce((sum, c) => sum + (c.mrrCents ?? 0), 0) / 100)
                  : "—"}
              </strong>
              <span className="cmd-pill">{revenueState}</span>
            </div>
            <p className="cmd-revenue-label">Recorded Run MRR</p>
            <p>
              Monthly recurring contracts only.
              <br />
              One-off roadmap and build fees excluded.
            </p>
            {amounts.length > 0 && !revenue.isError && (
              <p className="cmd-source-note">
                {amounts.length} of {run.length} visible Run client amounts recorded. Not collected
                revenue.
              </p>
            )}
            {can("clients") && (
              <Link className="cmd-text-link" to="/modules/clients">
                Review revenue source <ArrowRight aria-hidden="true" />
              </Link>
            )}
          </section>
          <section className="cmd-card" aria-labelledby="cmd-meetings-title">
            <h2 id="cmd-meetings-title">
              <Users aria-hidden="true" />
              Recent meetings
            </h2>
            {!can("steward") ? (
              <p className="cmd-empty-small">Steward access required.</p>
            ) : meetings.isPending ? (
              <p role="status" className="cmd-empty-small">
                Reading saved meetings…
              </p>
            ) : meetings.isError ? (
              <p role="alert" className="cmd-empty-small">
                Meetings could not be read.{" "}
                <button onClick={() => void meetings.refetch()}>Retry</button>
              </p>
            ) : meetings.data?.length ? (
              <ul className="cmd-meeting-list">
                {meetings.data.map((meeting) => (
                  <li key={meeting.id}>
                    <Link
                      to="/modules/steward/meetings/$conversationId"
                      params={{ conversationId: meeting.id }}
                    >
                      {meeting.title || "Untitled meeting"}
                      <ChevronRight aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="cmd-empty-small">
                <strong>No saved meetings found.</strong>
                <p>Review notes for decisions and next actions.</p>
              </div>
            )}
            {can("steward") && (
              <Link className="cmd-text-link" to="/modules/steward/meetings">
                Review meetings <ArrowRight aria-hidden="true" />
              </Link>
            )}
          </section>
          <section className="cmd-card" aria-labelledby="cmd-studio-title">
            <h2 id="cmd-studio-title">
              <CalendarDays aria-hidden="true" />
              Upcoming in Studio
            </h2>
            <div className="cmd-empty-small">
              <strong>—</strong>
              <p>
                {can("studio")
                  ? "Publishing schedule not connected to Home."
                  : "Studio access required."}
              </p>
            </div>
            {can("studio") && (
              <Link className="cmd-text-link" to="/modules/studio">
                Open Studio <ArrowRight aria-hidden="true" />
              </Link>
            )}
          </section>
        </aside>
      </div>
      <details className="cmd-personal">
        <summary>My tasks and progress</summary>
        <div className="cmd-card">
          <div className="cmd-section-heading">
            <h2>My tasks</h2>
            <button className="cmd-primary" onClick={onCreate}>
              + New task
            </button>
          </div>
          {personal.isError || business.isError ? (
            <p role="alert">Some tasks could not be read.</p>
          ) : personal.isPending || business.isPending ? (
            <p role="status">Loading your tasks…</p>
          ) : (
            <>
              <p>
                {personal.data?.truncated || business.data?.truncated
                  ? "Partial view; totals are not complete."
                  : "Your recorded personal and assigned business tasks."}
              </p>
              <ul className="cmd-meeting-list">
                {mine.map((task) => (
                  <li key={task.id}>
                    <button onClick={() => onOpenBoard(task)}>
                      {task.title} · {BOARD_STATUS_LABEL[task.status]}
                    </button>
                  </li>
                ))}
              </ul>
              {!mine.length && <p>No tasks in this view.</p>}
            </>
          )}
          <ul className="cmd-meeting-list">
            {read.tasks
              .filter((task) => task.owner.userId === identity.userId)
              .map((task) => (
                <li key={task.key}>
                  <button onClick={() => onOpenLegacy(task)}>
                    {task.title} · {task.state}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      </details>
      <footer className="cmd-source-note">
        Unknown stays unknown. Review each source before taking action.
      </footer>
    </div>
  );
}
