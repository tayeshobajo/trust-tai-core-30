import { useState } from "react";
import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  Search,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  HIRING_PEOPLE,
  needsAttention,
  stageLabel,
  STAGES,
  type Event,
  type Snapshot,
} from "@/domain/hiring";
import {
  appliedDate,
  applicationsByRole,
  candidateRows,
  hiringMetrics,
  initials,
  ownerName,
  type CandidateFilters,
} from "./presentation";

export function Metric({
  label,
  value,
  icon: Icon = Users,
}: {
  label: string;
  value: number;
  icon?: typeof Users;
}) {
  return (
    <article className="h-card h-metric">
      <span className="h-icon">
        <Icon size={20} aria-hidden="true" />
      </span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </article>
  );
}
export function EventFeed({
  events,
  describe,
}: {
  events: Event[];
  describe: (event: Event) => string;
}) {
  return (
    <div className="h-timeline">
      {events.map((e) => (
        <article className="h-event" key={e.id}>
          <span className="h-icon">
            <Activity size={16} aria-hidden="true" />
          </span>
          <div>
            <strong>{describe(e)}</strong>
            <small>
              {e.actor
                ? ownerName(e.actor, HIRING_PEOPLE)
                : e.detail["source"] === "provider-worker"
                  ? "Delivery service"
                  : "Applicant"}{" "}
              · {new Date(e.created_at).toLocaleString()}
            </small>
          </div>
        </article>
      ))}
    </div>
  );
}
export function HiringOverview({
  data,
  roles,
  candidates,
  choose,
  describe,
}: {
  data: Snapshot;
  roles: () => void;
  candidates: () => void;
  choose: (id: string) => void;
  describe: (e: Event) => string;
}) {
  const m = hiringMetrics(data);
  const groups = applicationsByRole(data);
  const recent = [...data.events]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
    .slice(0, 5);
  let offset = 0;
  return (
    <>
      <div className="h-metrics">
        <Metric label="Total applications" value={m.total} />
        <Metric label="Open roles" value={m.open} icon={BriefcaseBusiness} />
        <Metric label="Active applications" value={m.active} icon={Activity} />
        <Metric label="Hired applications" value={m.hired} icon={CheckCircle2} />
      </div>
      <div className="h-overview-grid">
        <article className="h-card">
          <div className="h-card-heading">
            <div>
              <h2>Open roles</h2>
              <p>Current openings and applications.</p>
            </div>
            <Button variant="ghost" onClick={roles}>
              View all roles <ArrowRight />
            </Button>
          </div>
          {data.jobs
            .filter((j) => j.status === "open")
            .map((j) => {
              const count = data.applications.filter((a) => a.job_id === j.id).length;
              return (
                <div className="h-role-summary" key={j.id}>
                  <span className="h-icon">
                    <BriefcaseBusiness size={20} />
                  </span>
                  <div>
                    <strong>{j.title}</strong>
                    <small>Open · {ownerName(j.owner_id, HIRING_PEOPLE)}</small>
                  </div>
                  <div>
                    <span>{count} applications</span>
                    <progress
                      value={count}
                      max={Math.max(m.total, 1)}
                      aria-label={`${j.title} applications`}
                    />
                  </div>
                  <Button variant="outline" onClick={roles} aria-label={`View role ${j.title}`}>
                    <ArrowRight />
                  </Button>
                </div>
              );
            })}
          {!m.open && <p className="h-empty">No open roles. Existing drafts remain in Roles.</p>}
        </article>
        <article className="h-card">
          <div className="h-card-heading">
            <h2>Pipeline overview</h2>
            <span className="h-muted">All applications</span>
          </div>
          <div className="h-pipeline">
            {m.pipeline.map((p) => (
              <div key={p.stage}>
                <span>{stageLabel(p.stage)}</span>
                <strong>{p.count}</strong>
                <progress
                  value={p.count}
                  max={Math.max(m.total, 1)}
                  aria-label={`${stageLabel(p.stage)} applications`}
                />
              </div>
            ))}
          </div>
        </article>
        <article className="h-card">
          <div className="h-card-heading">
            <div>
              <h2>Recent activity</h2>
              <p>Recorded updates across applications.</p>
            </div>
            <Button variant="ghost" onClick={candidates}>
              Candidates <ArrowRight />
            </Button>
          </div>
          {recent.map((e) => (
            <div className="h-overview-event" key={e.id}>
              <EventFeed events={[e]} describe={describe} />
              {e.application_id && data.applications.some((a) => a.id === e.application_id) && (
                <Button
                  variant="ghost"
                  onClick={() => choose(e.application_id ?? "")}
                  aria-label="Open application"
                >
                  <ArrowRight />
                </Button>
              )}
            </div>
          ))}
          {!recent.length && <p className="h-empty">No activity recorded yet.</p>}
        </article>
        <article className="h-card">
          <div className="h-card-heading">
            <h2>Applications by role</h2>
          </div>
          <div className="h-distribution">
            <div className="h-donut">
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle
                  className="h-donut-track"
                  cx="60"
                  cy="60"
                  r="46"
                  fill="none"
                  strokeWidth="15"
                />
                {groups.map((g, i) => {
                  const share = (g.count / Math.max(m.total, 1)) * 100;
                  const start = offset;
                  offset += share;
                  return (
                    <circle
                      key={g.id}
                      className={`h-chart-${i % 7}`}
                      cx="60"
                      cy="60"
                      r="46"
                      pathLength="100"
                      fill="none"
                      strokeWidth="15"
                      strokeDasharray={`${share} ${100 - share}`}
                      strokeDashoffset={-start}
                      transform="rotate(-90 60 60)"
                    />
                  );
                })}
              </svg>
              <div>
                <strong>{m.total}</strong>
                <small>Applications</small>
              </div>
            </div>
            <ul className="h-legend">
              {groups.map((g, i) => (
                <li key={g.id}>
                  <span className={`h-dot h-chart-${i % 7}`} />
                  <span>{g.title}</span>
                  <strong>{g.count}</strong>
                  <small>{Math.round((g.count / Math.max(m.total, 1)) * 100)}%</small>
                </li>
              ))}
              {!groups.length && <li>No applications yet.</li>}
            </ul>
          </div>
        </article>
      </div>
    </>
  );
}
export function CandidateList({
  data,
  choose,
  initialRole = "",
}: {
  data: Snapshot;
  choose: (id: string) => void;
  initialRole?: string;
}) {
  const [filters, setFilters] = useState<CandidateFilters>({
    search: "",
    role: initialRole,
    stage: "",
    attention: false,
    days: "",
    sort: "date",
    direction: "desc",
  });
  const [page, setPage] = useState(1);
  const today = new Date().toISOString().slice(0, 10);
  const rows = candidateRows(data.applications, filters, today);
  const count = hiringMetrics(data);
  const pageSize = 10,
    pages = Math.max(1, Math.ceil(rows.length / pageSize)),
    activePage = Math.min(page, pages);
  const change = (patch: Partial<CandidateFilters>) => {
    setFilters({ ...filters, ...patch });
    setPage(1);
  };
  const sort = (key: CandidateFilters["sort"]) =>
    change({
      sort: key,
      direction: filters.sort === key && filters.direction === "asc" ? "desc" : "asc",
    });
  return (
    <>
      <div className="h-filters h-card">
        <label className="h-search">
          Search candidates
          <span>
            <Search size={18} aria-hidden="true" />
            <input
              value={filters.search}
              onChange={(e) => change({ search: e.target.value })}
              placeholder="Name or email"
            />
          </span>
        </label>
        <label>
          Role
          <select value={filters.role} onChange={(e) => change({ role: e.target.value })}>
            <option value="">All roles</option>
            {data.jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Stage
          <select
            aria-label="Stage"
            value={filters.stage}
            onChange={(e) => change({ stage: e.target.value })}
          >
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {stageLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Applied
          <select value={filters.days} onChange={(e) => change({ days: e.target.value })}>
            <option value="">All dates</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </label>
        <label className="h-check">
          <input
            type="checkbox"
            checked={filters.attention}
            onChange={(e) => change({ attention: e.target.checked })}
          />
          Needs attention
        </label>
      </div>
      <div className="h-metrics h-metrics-five">
        <Metric label="Total applications" value={count.total} />
        <Metric label="Active in pipeline" value={count.active} icon={Activity} />
        <Metric label="Interview" value={count.interview} icon={Users} />
        <Metric label="Offer" value={count.offer} icon={CheckCircle2} />
        <Metric label="Not in progress" value={count.inactive} icon={CirclePause} />
      </div>
      <div className="h-card h-table-card">
        <div className="h-table-scroll" tabIndex={0} aria-label="Candidate table">
          <table>
            <caption className="sr-only">Hiring applications</caption>
            <thead>
              <tr>
                <th
                  aria-sort={
                    filters.sort === "name"
                      ? filters.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <Button variant="ghost" onClick={() => sort("name")}>
                    Candidate <ArrowDownUp />
                  </Button>
                </th>
                <th>Applied role</th>
                <th>Stage</th>
                <th
                  aria-sort={
                    filters.sort === "date"
                      ? filters.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <Button variant="ghost" onClick={() => sort("date")}>
                    Applied <ArrowDownUp />
                  </Button>
                </th>
                <th>Next action / review</th>
                <th>Owner / attention</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice((activePage - 1) * pageSize, activePage * pageSize).map((a) => (
                <tr key={a.id}>
                  <td>
                    <Button
                      className="h-candidate-name"
                      variant="ghost"
                      onClick={() => choose(a.id)}
                    >
                      <span className="h-avatar">{initials(a.full_name)}</span>
                      <span>
                        <strong>{a.full_name}</strong>
                        <small>{a.email}</small>
                      </span>
                    </Button>
                  </td>
                  <td>{a.job_title}</td>
                  <td>
                    <span className={`h-stage h-stage-${a.stage}`}>{stageLabel(a.stage)}</span>
                  </td>
                  <td>{appliedDate(a.created_at)}</td>
                  <td>
                    {a.next_action || "Set a next action"}
                    <small>{a.review_date ? `Review ${a.review_date}` : "No review date"}</small>
                  </td>
                  <td>
                    {ownerName(a.owner_id, HIRING_PEOPLE)}
                    <small>
                      {needsAttention(a, today) ? "Needs attention" : "No attention flag"}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <div className="h-empty">
            <h2>
              {data.applications.length ? "No matching applications" : "Room for the right people."}
            </h2>
            <p>
              {data.applications.length
                ? "Choose all roles and stages or clear the search."
                : "Applications will arrive here for personal review."}
            </p>
          </div>
        )}
        <div className="h-pagination">
          <span>
            {rows.length
              ? `Showing ${(activePage - 1) * pageSize + 1}–${Math.min(activePage * pageSize, rows.length)} of ${rows.length} applications`
              : "0 applications"}
          </span>
          <div>
            <Button
              variant="outline"
              disabled={activePage === 1}
              onClick={() => setPage(activePage - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft />
            </Button>
            <span>
              Page {activePage} of {pages}
            </span>
            <Button
              variant="outline"
              disabled={activePage === pages}
              onClick={() => setPage(activePage + 1)}
              aria-label="Next page"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
