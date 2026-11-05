import { useState, useEffect, type FormEvent, type ReactNode } from "react";
import {
  FileText,
  Plus,
  Search,
  Trophy,
  ExternalLink,
  Clock,
  Layers,
  Radio,
  Send,
  CircleSlash,
  Filter,
  Calendar,
  ArrowLeft,
  Upload,
  Pencil,
  Link as LinkIcon,
} from "lucide-react";
import { TTButton } from "@/components/tt/primitives";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  submissionTimeLabel,
  submissionTimeFromForm,
  blankOpportunity,
  deadlineLabel,
  filterOpportunities,
  opportunityInput,
  stages,
  stageLabel,
  type Submission,
  type Opportunity,
  type OpportunityInput,
  type Snapshot,
  type Stage,
} from "@/domain/rfps";
import { hiddenPastRfpIds, safeSourceLink } from "@/domain/rfp-visibility";
import type { RfpService } from "@/data/supabase/rfps";
import "./workspace.css";
import { OpportunityIntake } from "./intake";
import { CmdAction } from "@/components/tt/cmd/action";
import { RfpStageBadge } from "./stage-badge";
const workflowGroups: Record<string, readonly Stage[]> = {
  all: stages,
  captured: ["captured"],
  needsReview: ["qualifying", "review"],
  inProgress: ["preparing", "ready"],
  submitted: ["submitted"],
  awarded: ["awarded"],
  closed: ["declined", "closed"],
  decisions: ["awarded", "declined", "closed"],
};
const detailTabs = ["overview", "eligibility", "requirements", "submissions", "notes", "proposal"];
export const emptySnapshot: Snapshot = {
  opportunities: [],
  versions: [],
  submissions: [],
  approvals: [],
  checks: [],
};
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="rfp-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function SubmissionTimeFields({ amendment = false }: { amendment?: boolean }) {
  const [precision, setPrecision] = useState(amendment ? "unchanged" : "unknown");
  return (
    <>
      <Field label="Submission time precision">
        <select
          name="time_precision"
          value={precision}
          onChange={(e) => setPrecision(e.target.value)}
        >
          {amendment && <option value="unchanged">Leave timing unchanged</option>}
          <option value="unknown">Unknown</option>
          <option value="date">Date only</option>
          <option value="minute">Known to the minute</option>
          <option value="second">Known to the second</option>
        </select>
      </Field>
      {precision === "date" && (
        <Field label="Submission date (as recorded in the evidence)">
          <input name="submission_date" required type="date" />
        </Field>
      )}
      {["minute", "second"].includes(precision) && (
        <Field label="Submitted at (your browser timezone)">
          <input
            key={precision}
            name="time"
            required
            type="datetime-local"
            step={precision === "minute" ? 60 : 1}
          />
        </Field>
      )}
      <p className="rfp-muted">
        Choose only the precision the evidence supports. Minute-level times do not establish
        seconds. Date-only evidence has no implied time or timezone.
      </p>
    </>
  );
}
function OpportunityForm({
  initial,
  onSave,
  busy,
}: {
  initial: OpportunityInput;
  onSave: (v: OpportunityInput) => void;
  busy: boolean;
}) {
  const [v, set] = useState(initial),
    [error, setError] = useState("");
  const text = (key: keyof OpportunityInput, label: string, type = "text") => (
    <Field label={label}>
      <input type={type} value={v[key]} onChange={(e) => set({ ...v, [key]: e.target.value })} />
    </Field>
  );
  const area = (key: keyof OpportunityInput, label: string) => (
    <Field label={label}>
      <textarea value={v[key]} onChange={(e) => set({ ...v, [key]: e.target.value })} />
    </Field>
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    const result = opportunityInput.safeParse(v);
    if (!result.success) {
      setError(result.error.issues.map((x) => `${x.path.join(" ")}: ${x.message}`).join(" "));
      return;
    }
    setError("");
    onSave(result.data);
  }
  return (
    <form onSubmit={submit} className="rfp-form">
      <div className="rfp-fields">
        {text("title", "Opportunity title *")}
        <Field label="Type">
          <select
            value={v.kind}
            onChange={(e) => set({ ...v, kind: e.target.value as "rfp" | "grant" })}
          >
            <option value="rfp">RFP</option>
            <option value="grant">Grant</option>
          </select>
        </Field>
        {text(
          "source_name",
          v.kind === "grant"
            ? "Funder / administrator (if known)"
            : "Issuing organization (if known)",
        )}
        {text("source_url", "Source URL (optional for a document)", "url")}
        {text("cycle", "Application cycle / solicitation ID (if known)")}
        {text("applicant", "Applicant legal entity")}
        <Field label="Eligibility">
          <select
            value={v.eligibility}
            onChange={(e) =>
              set({ ...v, eligibility: e.target.value as OpportunityInput["eligibility"] })
            }
          >
            {["unknown", "reviewing", "eligible", "ineligible"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        {text("owner_label", "Responsible owner (name)")}
        {text("deadline_date", "Deadline date (leave blank if unknown)", "date")}
        {text("deadline_time", "Deadline time (leave blank if unknown)", "time")}
        {text("deadline_timezone", "Deadline timezone (IANA)")}
        {text("next_action", "Next action")}
      </div>
      {area("eligibility_notes", "Eligibility review and supporting facts")}
      {area(
        "requirements",
        v.kind === "grant"
          ? "Grant restrictions, required documents and selection criteria"
          : "Scope, evaluation criteria and response requirements",
      )}
      {area("source_evidence", "Source evidence / relevant excerpt *")}
      <p className="rfp-muted">
        Capture what the source says. Missing deadlines and eligibility remain unknown. Saving a
        source does not verify its availability.
      </p>
      {error && <p role="alert">{error}</p>}
      <TTButton type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save opportunity"}
      </TTButton>
    </form>
  );
}
export function RfpWorkspace({
  data = emptySnapshot,
  loading = false,
  error = "",
  canWork = false,
  service,
  refresh,
}: {
  data?: Snapshot | undefined;
  loading?: boolean;
  error?: string | undefined;
  canWork?: boolean;
  service: RfpService;
  refresh: () => Promise<unknown>;
}) {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [kind, setKind] = useState("all"),
    [selected, setSelected] = useState<string | null>(null),
    [tab, setTab] = useState("overview");
  const [modal, setModal] = useState<
      "create" | "edit" | "upload" | "submission" | "check" | "document" | "amend" | null
    >(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [actionError, setActionError] = useState("");
  const [amending, setAmending] = useState<Submission | null>(null);
  const [group, setGroup] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState("deadline");
  const [mobileDetail, setMobileDetail] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [includePast, setIncludePast] = useState(false);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 60000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);
  const hiddenPast = hiddenPastRfpIds(data.opportunities, data.submissions, now);
  const visible = includePast
    ? data.opportunities
    : data.opportunities.filter((o) => !hiddenPast.has(o.id));
  const scoped = filterOpportunities(visible, query, "all", kind);
  const countGroup = (key: string) =>
    scoped.filter((o) => workflowGroups[key]?.includes(o.stage)).length;
  const rows = filterOpportunities(scoped, "", filter, "all")
    .filter((o) => workflowGroups[group]?.includes(o.stage))
    .sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : (a.deadline_date || "9999").localeCompare(b.deadline_date || "9999"),
    );
  const chooseGroup = (key: string) => {
    setGroup(key);
    setFilter("all");
    setMobileDetail(false);
  };
  const current = rows.find((o) => o.id === selected) ?? rows[0];
  const sourceLink = safeSourceLink(current?.source_url ?? "");
  const versions = data.versions.filter((v) => v.opportunity_id === current?.id);
  const submissions = data.submissions.filter((v) => v.opportunity_id === current?.id);
  const documents = (data.documents ?? []).filter((v) => v.opportunity_id === current?.id);
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setActionError("");
    try {
      await action();
      setModal(null);
      setMessage(success);
      try {
        await refresh();
      } catch {
        setActionError(
          "The change completed, but the latest records could not be loaded. Refresh before making another change.",
        );
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "The change could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }
  function open(value: typeof modal) {
    setActionError("");
    setModal(value);
  }
  const available = canWork && !loading && !error && !busy && !offline;
  return (
    <div className={`rfp-workspace ${mobileDetail ? "rfp-show-detail" : ""}`}>
      {offline && (
        <p role="status" className="rfp-notice">
          You are offline. Showing the last loaded records; reconnect before saving or uploading.
        </p>
      )}
      <header className="rfp-header">
        <div>
          <p className="rfp-eyebrow">RFPS</p>
          <h1>RFPs &amp; Grants</h1>
          <p>Track sourced opportunities, proposals, and decisions.</p>
        </div>
      </header>
      <div className="rfp-stats" aria-label="Opportunity totals for current search and type">
        {[
          ["captured", "New opportunities", FileText],
          ["needsReview", "Needs review", Clock],
          ["inProgress", "In progress", Layers],
          ["submitted", "Submitted", Send],
          ["awarded", "Awarded", Trophy],
          ["closed", "Closed", CircleSlash],
        ].map(([key, label, Icon]) => {
          const Glyph = Icon as typeof FileText;
          return (
            <button
              key={String(key)}
              className={`rfp-metric tone-${key} ${group === key ? "active" : ""}`}
              onClick={() => chooseGroup(String(key))}
              aria-pressed={group === key}
            >
              <span className="rfp-metric-icon">
                <Glyph size={22} />
              </span>
              <span>
                {String(label)}
                <strong>{loading || error ? "—" : countGroup(String(key))}</strong>
              </span>
            </button>
          );
        })}
      </div>
      <div className="rfp-workflow-bar">
        <nav className="rfp-workflow-tabs" aria-label="Opportunity workflow filters">
          {[
            ["needsReview", "Needs review"],
            ["inProgress", "In progress"],
            ["submitted", "Submitted"],
            ["decisions", "Decisions"],
            ["all", "All"],
          ].map(([key, label]) => (
            <button key={key} aria-pressed={group === key} onClick={() => chooseGroup(key!)}>
              {label} <span>{loading || error ? "…" : countGroup(key!)}</span>
            </button>
          ))}
        </nav>
        <TTButton disabled={!available} onClick={() => open("create")}>
          <Plus size={16} /> Add opportunity
        </TTButton>
      </div>
      <section className="rfp-discovery" aria-label="Discovery status">
        <Radio size={20} />
        <div>
          <strong>Daily discovery · not connected</strong>
          <p>
            Current searches run separately and do not feed this workspace. Coverage and last
            automated check are unknown.
          </p>
          {data.checks[0] && (
            <p>
              Last manual review: {new Date(data.checks[0].checked_at).toLocaleString()} ·{" "}
              {data.checks[0].source_count} sources checked · {data.checks[0].failed_count} failed.{" "}
              {data.checks[0].note}
            </p>
          )}
        </div>
        <TTButton variant="quiet" disabled={!available} onClick={() => open("check")}>
          Log daily review
        </TTButton>
      </section>
      {message && (
        <p role="status" className="rfp-notice">
          {message}
        </p>
      )}
      {actionError && !modal && (
        <p role="alert" className="rfp-notice">
          {actionError}
        </p>
      )}
      {loading ? (
        <div className="rfp-empty" role="status">
          Loading your authorized opportunities…
        </div>
      ) : error ? (
        <div className="rfp-empty" role="alert">
          <h2>Opportunities are unavailable</h2>
          <p>{error}</p>
          <TTButton
            onClick={() =>
              void refresh().catch(() =>
                setActionError(
                  "Records still could not be loaded. Check your connection or workspace setup.",
                ),
              )
            }
          >
            Try again
          </TTButton>
        </div>
      ) : (
        <div className="rfp-columns">
          <section className="rfp-panel rfp-list" aria-label="Opportunity list">
            <div className="rfp-toolbar">
              <Field label="Search opportunities">
                <span className="rfp-search">
                  <Search size={16} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search opportunities…"
                  />
                </span>
              </Field>
              <button
                className="rfp-filter-button"
                aria-expanded={showFilters}
                aria-controls="rfp-filters"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter size={16} /> Filter
              </button>
            </div>
            <div className="rfp-expiry-note">
              <p>
                {includePast
                  ? "Including past RFPs for reference."
                  : `${hiddenPast.size} past RFP${hiddenPast.size === 1 ? "" : "s"} with no recorded submission hidden.`}{" "}
                Submitted RFPs and uncertain deadlines remain visible. Records are not deleted.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={includePast}
                  onChange={(e) => setIncludePast(e.target.checked)}
                />{" "}
                Include past RFPs with no recorded submission
              </label>
            </div>
            <div className="rfp-filter-fields" id="rfp-filters" hidden={!showFilters}>
              <Field label="Stage">
                <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="all">All stages</option>
                  {stages.map((s) => (
                    <option value={s} key={s}>
                      {stageLabel[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Opportunity type">
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="all">RFPs & Grants</option>
                  <option value="rfp">RFPs</option>
                  <option value="grant">Grants</option>
                </select>
              </Field>
            </div>

            <div className="rfp-list-heading">
              <strong>
                {rows.length} {rows.length === 1 ? "opportunity" : "opportunities"}
              </strong>
              <label className="rfp-sort">
                Sort:{" "}
                <select
                  aria-label="Sort opportunities"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="deadline">Deadline earliest</option>
                  <option value="title">Title A–Z</option>
                </select>
              </label>
            </div>
            {rows.length ? (
              rows.map((o) => (
                <button
                  key={o.id}
                  className={`rfp-row ${current?.id === o.id ? "selected" : ""}`}
                  aria-pressed={current?.id === o.id}
                  onClick={() => {
                    setSelected(o.id);
                    setMobileDetail(true);
                    setTab("overview");
                  }}
                >
                  <span className={`rfp-type-icon kind-${o.kind}`}>
                    {o.kind === "grant" ? <Trophy size={19} /> : <FileText size={19} />}
                  </span>
                  <span className="rfp-row-body">
                    <strong>{o.title}</strong>
                    <span>{o.source_name || "Issuer unknown"}</span>
                  </span>
                  <span className="rfp-row-meta">
                    <span className="rfp-pill">{o.kind === "grant" ? "Grant" : "RFP"}</span>
                    <small>{o.deadline_date || "Date unknown"}</small>
                    <RfpStageBadge stage={o.stage} />
                  </span>
                </button>
              ))
            ) : (
              <div className="rfp-empty">
                <FileText size={32} />
                <h2>
                  {data.opportunities.length
                    ? "No matching opportunities"
                    : "Your next opportunity starts here"}
                </h2>
                <p>
                  {data.opportunities.length
                    ? "Try another stage or clear the search."
                    : "Capture an official source, qualify the fit, and keep every proposal version together."}
                </p>
                {data.opportunities.length ? (
                  <TTButton
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                      setKind("all");
                      setGroup("all");
                    }}
                  >
                    Clear filters
                  </TTButton>
                ) : (
                  <TTButton disabled={!available} onClick={() => open("create")}>
                    Add your first opportunity
                  </TTButton>
                )}
              </div>
            )}
          </section>
          {current ? (
            <>
              <section className="rfp-panel rfp-detail">
                <button className="rfp-back" onClick={() => setMobileDetail(false)}>
                  <ArrowLeft size={16} /> Back to opportunities
                </button>
                <div className="rfp-detail-head">
                  <p className="rfp-eyebrow">
                    {current.kind === "grant" ? "GRANT OPPORTUNITY" : "REQUEST FOR PROPOSALS"}
                  </p>
                  <h2>{current.title}</h2>
                  {sourceLink ? (
                    <a
                      className="rfp-source-top"
                      href={sourceLink}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink size={16} aria-hidden="true" /> Open{" "}
                      {current.kind === "grant" ? "grant" : "RFP"} source <span>(new tab)</span>
                    </a>
                  ) : (
                    <p className="rfp-muted">
                      No source URL recorded. Check Notes for source documents.
                    </p>
                  )}
                  <p>
                    {current.source_name} · {current.cycle}
                  </p>
                  <div className="rfp-tags">
                    <span className={`rfp-pill kind-${current.kind}`}>
                      {current.kind === "grant" ? <Trophy size={14} /> : <FileText size={14} />}{" "}
                      {current.kind === "grant" ? "Grant" : "RFP"}
                    </span>
                    <span className="rfp-pill">
                      <Calendar size={14} />
                      {deadlineLabel(current)}
                    </span>
                    <span className="rfp-pill">Eligibility: {current.eligibility}</span>
                  </div>
                </div>
                <div className="rfp-tabs" role="tablist" aria-label="Opportunity details">
                  {detailTabs.map((t) => (
                    <button
                      role="tab"
                      aria-selected={tab === t}
                      tabIndex={tab === t ? 0 : -1}
                      onKeyDown={(e) => {
                        const tabs = detailTabs;
                        if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
                        e.preventDefault();
                        const next =
                          e.key === "Home"
                            ? tabs[0]
                            : e.key === "End"
                              ? tabs[tabs.length - 1]
                              : tabs[
                                  (tabs.indexOf(t) +
                                    (e.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                                    tabs.length
                                ];
                        if (next === undefined) return;
                        setTab(next);
                        document.getElementById(`tab-${next}`)?.focus();
                      }}
                      aria-controls={`rfp-${t}`}
                      id={`tab-${t}`}
                      key={t}
                      onClick={() => setTab(t)}
                    >
                      {t === "proposal"
                        ? `Proposal (${versions.length + documents.length})`
                        : t === "submissions"
                          ? `Activity (${submissions.length})`
                          : t === "eligibility"
                            ? "Eligibility"
                            : t === "requirements"
                              ? "Required docs"
                              : t === "notes"
                                ? "Notes"
                                : "Overview"}
                    </button>
                  ))}
                </div>
                <div
                  role="tabpanel"
                  id={`rfp-${tab}`}
                  aria-labelledby={`tab-${tab}`}
                  className="rfp-detail-content"
                >
                  {tab === "overview" ? (
                    <>
                      <div className="rfp-facts">
                        <div>
                          <ExternalLink size={18} />
                          <span>Source</span>
                          <strong>{current.source_name}</strong>
                        </div>
                        <div>
                          <Calendar size={18} />
                          <span>Deadline</span>
                          <strong>{deadlineLabel(current)}</strong>
                        </div>
                        <div>
                          <FileText size={18} />
                          <span>Applicant</span>
                          <strong>{current.applicant || "Not recorded"}</strong>
                        </div>
                      </div>
                      <div className="rfp-summary-grid">
                        <section className="rfp-summary-card">
                          <h3>Key details</h3>
                          <p className="rfp-pre">
                            {current.requirements || "Requirements have not been recorded."}
                          </p>
                        </section>
                        <section className="rfp-summary-card">
                          <h3>Next step</h3>
                          <RfpStageBadge stage={current.stage} />
                          <p>{current.next_action || "Decide the next step."}</p>
                          <CmdAction variant="primary" fullWidth onClick={() => setTab("proposal")}>
                            <Layers aria-hidden="true" size={16} /> View proposal
                          </CmdAction>
                        </section>
                      </div>
                      <section className="rfp-summary-card rfp-glance">
                        <h3>At a glance</h3>
                        <dl>
                          <div>
                            <dt>Eligibility</dt>
                            <dd>{current.eligibility}</dd>
                          </div>
                          <div>
                            <dt>Owner</dt>
                            <dd>{current.owner_label || "Unassigned"}</dd>
                          </div>
                          <div>
                            <dt>Source availability</dt>
                            <dd>{current.source_state}</dd>
                          </div>
                        </dl>
                      </section>
                    </>
                  ) : tab === "eligibility" ? (
                    <>
                      <h3>Applicant &amp; eligibility</h3>
                      <p>{current.applicant || "Applicant legal entity not recorded."}</p>
                      <span className="rfp-pill">{current.eligibility}</span>
                      <p className="rfp-pre">
                        {current.eligibility_notes || "Eligibility has not been reviewed."}
                      </p>
                    </>
                  ) : tab === "requirements" ? (
                    <>
                      <h3>
                        {current.kind === "grant"
                          ? "Grant requirements"
                          : "RFP response requirements"}
                      </h3>
                      <p className="rfp-pre">
                        {current.requirements || "Requirements have not been recorded."}
                      </p>
                      <p className="rfp-muted">
                        These are recorded requirements, not a verified completion checklist.
                      </p>
                      <TTButton variant="quiet" onClick={() => setTab("proposal")}>
                        View drafts and working documents
                      </TTButton>
                    </>
                  ) : tab === "notes" ? (
                    <>
                      <h3>Source evidence &amp; notes</h3>
                      <p className="rfp-pre">{current.source_evidence}</p>
                      {current.source_url && (
                        <a href={current.source_url} target="_blank" rel="noreferrer">
                          Open source <ExternalLink size={14} />
                        </a>
                      )}
                      <h3>Original source documents</h3>
                      {(data.sourceFiles ?? [])
                        .filter((f) => f.opportunity_id === current.id)
                        .map((f) => (
                          <div key={f.id}>
                            <TTButton
                              variant="quiet"
                              onClick={() =>
                                void service.download(f).catch((e) => setActionError(e.message))
                              }
                            >
                              {f.file_name}
                            </TTButton>
                            <p className="rfp-muted">
                              Private source document · not a proposal draft
                            </p>
                          </div>
                        ))}
                      {!(data.sourceFiles ?? []).some((f) => f.opportunity_id === current.id) && (
                        <p>No original source file is preserved in CMD.</p>
                      )}
                      <p className="rfp-muted">
                        Availability: {current.source_state}.{" "}
                        {current.source_checked_at
                          ? `Checked ${new Date(current.source_checked_at).toLocaleString()}`
                          : "No source availability check recorded."}
                      </p>
                    </>
                  ) : tab === "proposal" ? (
                    <>
                      <div className="rfp-section-title">
                        <h3>Drafts and working documents</h3>
                        <CmdAction disabled={!available} onClick={() => open("document")}>
                          Link Google Doc
                        </CmdAction>
                        <CmdAction
                          variant="primary"
                          disabled={!available}
                          onClick={() => open("upload")}
                        >
                          Upload version
                        </CmdAction>
                      </div>
                      <p className="rfp-muted">
                        Private files. New uploads preserve previous versions. Download to view PDF,
                        DOCX or TXT; no public file links.
                      </p>
                      <p className="rfp-muted">
                        Google Doc links open the live document using existing Drive permissions.
                        Linking does not upload, copy, grant access, or preserve a snapshot. Export
                        and upload a PDF to preserve the version you submitted.
                      </p>
                      {documents.map((d) => (
                        <article className="rfp-version" key={d.id}>
                          <strong>{d.title}</strong>
                          <p>Google Doc · mutable working document</p>
                          <p>{d.note}</p>
                          <a href={d.url} target="_blank" rel="noreferrer">
                            Open Google Doc <ExternalLink size={14} />
                          </a>
                        </article>
                      ))}
                      {!versions.length && !documents.length && (
                        <p>No draft yet. Upload the first version when you are ready.</p>
                      )}
                      {versions.map((v, index) => (
                        <article className="rfp-version" key={v.id}>
                          <strong>{v.file_name}</strong>
                          <p>
                            {index === 0 ? "Latest · " : ""}
                            {data.approvals.some((a) => a.draft_id === v.id) ? "Approved · " : ""}
                            {submissions.some((s) => s.draft_id === v.id)
                              ? "Recorded as submitted · "
                              : ""}
                            {new Date(v.created_at).toLocaleString()}
                          </p>
                          <p>{v.note}</p>
                          <div className="rfp-actions">
                            <TTButton
                              variant="quiet"
                              disabled={busy}
                              onClick={() =>
                                void run(() => service.download(v), "Draft downloaded for viewing.")
                              }
                            >
                              View / download
                            </TTButton>
                            {!data.approvals.some((a) => a.draft_id === v.id) && (
                              <TTButton
                                variant="quiet"
                                disabled={!available}
                                onClick={() =>
                                  void run(
                                    () => service.approve(current, v),
                                    "Draft approval recorded.",
                                  )
                                }
                              >
                                Approve version
                              </TTButton>
                            )}
                          </div>
                        </article>
                      ))}
                    </>
                  ) : (
                    <>
                      <h3>Recorded submissions</h3>
                      <p className="rfp-muted">
                        These are team records of external actions, not delivery or acceptance
                        confirmations from CMD.
                      </p>
                      {!submissions.length && (
                        <p>No submission recorded. Nothing has been sent from this workspace.</p>
                      )}
                      {submissions.map((s) => (
                        <article className="rfp-version" key={s.id}>
                          <strong>
                            {submissionTimeLabel(s)} · {s.channel}
                          </strong>
                          <p>{s.reference || "Reference not recorded"}</p>
                          <p>
                            {s.draft_id
                              ? versions.find((v) => v.id === s.draft_id)?.file_name ||
                                "Linked draft"
                              : "Historical submission · draft unavailable"}
                          </p>
                          <p>Original submission record · preserved</p>
                          {(() => {
                            const timing = (data.amendments ?? []).find(
                              (a) => a.submission_id === s.id && a.time_precision != null,
                            );
                            return timing ? (
                              <p>Latest timing correction: {submissionTimeLabel(timing)}</p>
                            ) : null;
                          })()}
                          {(data.amendments ?? [])
                            .filter((a) => a.submission_id === s.id)
                            .map((a, i) => (
                              <div className="rfp-version" key={a.id}>
                                <strong>
                                  {i === 0
                                    ? "Latest evidence amendment"
                                    : "Earlier evidence amendment"}
                                </strong>
                                <p>
                                  {new Date(a.created_at).toLocaleString()} · {a.reason}
                                </p>
                                {a.time_precision != null && (
                                  <p>Timing correction: {submissionTimeLabel(a)}</p>
                                )}
                                <p>
                                  Submitted file:{" "}
                                  {versions.find((v) => v.id === a.draft_id)?.file_name ||
                                    "Not preserved / unavailable"}
                                </p>
                                <p>
                                  Submitted version (team-reported):{" "}
                                  {a.submitted_version || "Unknown"}
                                </p>
                                <p>Receipt / reference: {a.reference || "Pending"}</p>
                                {a.document_id && (
                                  <p>
                                    Related Google Doc (mutable, not a snapshot):{" "}
                                    {documents.find((d) => d.id === a.document_id)?.title ||
                                      "Unavailable"}
                                  </p>
                                )}
                                {a.evidence_url && (
                                  <a href={a.evidence_url} target="_blank" rel="noreferrer">
                                    Open receipt evidence
                                  </a>
                                )}
                              </div>
                            ))}
                          <TTButton
                            disabled={!available}
                            variant="quiet"
                            onClick={() => {
                              setAmending(s);
                              open("amend");
                            }}
                          >
                            Add / correct evidence
                          </TTButton>
                          {s.evidence_url ? (
                            <a href={s.evidence_url} rel="noreferrer" target="_blank">
                              View recorded evidence <ExternalLink size={14} />
                            </a>
                          ) : (
                            <span className="rfp-pill">Evidence pending</span>
                          )}
                        </article>
                      ))}
                    </>
                  )}
                </div>
              </section>
              <aside className="rfp-panel rfp-sidebar">
                <h3 className="rfp-sr-only">Opportunity actions</h3>
                <Field label="Workflow stage">
                  <select
                    disabled={!available}
                    value={current.stage}
                    onChange={(e) =>
                      void run(
                        () => service.update(current, current, e.target.value as Stage),
                        "Workflow stage saved.",
                      )
                    }
                  >
                    {stages.map((s) => (
                      <option
                        key={s}
                        value={s}
                        disabled={
                          (["submitted", "awarded", "declined"].includes(s) &&
                            !submissions.length) ||
                          (s === "ready" &&
                            (!current.applicant ||
                              current.eligibility !== "eligible" ||
                              !versions.some((v) =>
                                data.approvals.some((a) => a.draft_id === v.id),
                              )))
                        }
                      >
                        {stageLabel[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                <dl>
                  <dt>Owner</dt>
                  <dd>{current.owner_label || "Unassigned"}</dd>
                  <dt>Deadline</dt>
                  <dd>{deadlineLabel(current)}</dd>
                  <dt>Eligibility</dt>
                  <dd>{current.eligibility}</dd>
                  <dt>Source</dt>
                  <dd>
                    {current.source_url ? (
                      <a href={current.source_url} target="_blank" rel="noreferrer">
                        {current.source_name || "Open source"}
                        <ExternalLink size={14} />
                      </a>
                    ) : (
                      <span>Source document · see Notes</span>
                    )}
                  </dd>
                </dl>
                <section className="rfp-submission-summary">
                  <h3>
                    <FileText size={16} /> Submission
                  </h3>
                  <p>
                    {submissions.length
                      ? `${submissions.length} external submission record${submissions.length === 1 ? "" : "s"}`
                      : "No submission recorded in CMD."}
                  </p>
                  <p>
                    {versions.length
                      ? `${versions.length} private file version(s)`
                      : "No preserved draft file."}
                  </p>
                  <CmdAction variant="tertiary" fullWidth onClick={() => setTab("submissions")}>
                    View recorded evidence
                  </CmdAction>
                </section>
                <h3>Quick actions</h3>
                <CmdAction fullWidth disabled={!available} onClick={() => open("edit")}>
                  <Pencil aria-hidden="true" size={16} /> Edit opportunity
                </CmdAction>
                <p>
                  {versions.length
                    ? `${versions.length} saved draft version${versions.length === 1 ? "" : "s"}`
                    : "No draft uploaded yet."}
                </p>
                <CmdAction fullWidth disabled={!available} onClick={() => open("document")}>
                  <LinkIcon aria-hidden="true" size={16} /> Link Google Doc
                </CmdAction>
                <CmdAction
                  variant="primary"
                  fullWidth
                  disabled={!available}
                  onClick={() => open("upload")}
                >
                  <Upload aria-hidden="true" size={16} /> Upload draft
                </CmdAction>
                <CmdAction
                  variant="tertiary"
                  fullWidth
                  disabled={!available}
                  onClick={() => open("submission")}
                >
                  <Send aria-hidden="true" size={16} /> Record external submission
                </CmdAction>
                <p className="rfp-muted">
                  Record a submission only after it happened. This does not send an application.
                </p>
                {!canWork && (
                  <p>Read-only access. Ask your workspace administrator for editing access.</p>
                )}
              </aside>
            </>
          ) : (
            <section className="rfp-panel rfp-empty rfp-empty-detail">
              <Layers size={36} />
              <h2>One place for the whole proposal</h2>
              <p>
                Source evidence, eligibility, owners, drafts and decisions stay attached to the
                opportunity.
              </p>
              <p className="rfp-muted">Only records you are authorized to see appear here.</p>
            </section>
          )}
        </div>
      )}
      <Dialog
        open={modal !== null}
        onOpenChange={(value) => {
          if (!busy && !value) setModal(null);
        }}
      >
        <DialogContent className="rfp-dialog">
          <DialogHeader>
            <DialogTitle>
              {modal === "document"
                ? "Link a Google Doc"
                : modal === "amend"
                  ? "Amend submission evidence"
                  : modal === "create"
                    ? "Capture an opportunity"
                    : modal === "edit"
                      ? "Edit opportunity"
                      : modal === "upload"
                        ? "Upload a new draft version"
                        : modal === "submission"
                          ? "Record an external submission"
                          : "Log a manual discovery review"}
            </DialogTitle>
            <DialogDescription>
              {modal === "submission"
                ? "Confirm an action already taken outside CMD. Recording it does not send or confirm delivery."
                : modal === "upload"
                  ? "This creates a private, immutable version. Existing drafts are preserved."
                  : "Keep the source, responsibility and next action clear."}
            </DialogDescription>
          </DialogHeader>
          {modal === "create" && (
            <OpportunityIntake
              onBusy={setBusy}
              service={service}
              opportunities={data.opportunities}
              onExisting={(id) => {
                setSelected(id);
                setGroup("all");
                setQuery("");
                setFilter("all");
                setKind("all");
                setModal(null);
                setMobileDetail(true);
              }}
              onComplete={async (id, message) => {
                setSelected(id);
                setGroup("all");
                setQuery("");
                setFilter("all");
                setKind("all");
                setModal(null);
                setMessage(message);
                try {
                  await refresh();
                } catch {
                  setActionError(
                    "Saved, but refresh failed. Refresh before making another change.",
                  );
                }
              }}
            />
          )}
          {modal === "edit" && (
            <OpportunityForm
              key={modal + current?.id}
              initial={modal === "edit" && current ? current : blankOpportunity}
              busy={busy}
              onSave={(v) =>
                void run(
                  () =>
                    modal === "edit" && current
                      ? service.update(current, v, current.stage)
                      : service.create(v),
                  "Opportunity saved. Choose the next action.",
                )
              }
            />
          )}
          {modal === "document" && current && (
            <form
              className="rfp-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(
                  () => service.linkDocument(current, Object.fromEntries(f)),
                  "Google Doc reference saved. Drive permissions are unchanged.",
                );
              }}
            >
              <p>
                This saves a reference to a live, editable document. Existing Google Drive
                permissions still apply. CMD does not read or copy its contents.
              </p>
              <Field label="Document title">
                <input name="title" required maxLength={240} />
              </Field>
              <Field label="Google Doc URL">
                <input
                  name="url"
                  type="url"
                  required
                  placeholder="https://docs.google.com/document/d/…/edit"
                />
              </Field>
              <Field label="Document notes">
                <textarea name="note" maxLength={2000} />
              </Field>
              <TTButton type="submit" disabled={busy}>
                Save Google Doc reference
              </TTButton>
            </form>
          )}
          {modal === "amend" &&
            current &&
            amending &&
            (() => {
              const latest = (data.amendments ?? []).find((a) => a.submission_id === amending.id);
              return (
                <form
                  className="rfp-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(
                      () =>
                        service.amendEvidence(current, amending.id, {
                          ...Object.fromEntries(f),
                          ...submissionTimeFromForm(f),
                          draft_id: f.get("draft_id") || null,
                          document_id: f.get("document_id") || null,
                        }),
                      "Evidence amendment saved. Earlier records are preserved.",
                    );
                  }}
                >
                  <p>
                    Record the file or version actually submitted and its receipt. Missing evidence
                    can stay unknown. Every amendment preserves earlier records; a Google Doc alone
                    is not an immutable submitted version.
                  </p>
                  <SubmissionTimeFields amendment />
                  <Field label="Actual submitted file (preserved upload)">
                    <select
                      name="draft_id"
                      defaultValue={latest?.draft_id ?? amending.draft_id ?? ""}
                    >
                      <option value="">Unknown / not preserved</option>
                      {versions.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.file_name} · {v.created_at}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Related Google Doc (mutable reference)">
                    <select name="document_id" defaultValue={latest?.document_id ?? ""}>
                      <option value="">None / unknown</option>
                      {documents.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Submitted version description / named revision (team-reported)">
                    <textarea
                      name="submitted_version"
                      maxLength={2000}
                      defaultValue={latest?.submitted_version ?? ""}
                    />
                  </Field>
                  <Field label="Receipt / reference">
                    <input
                      name="reference"
                      maxLength={2000}
                      defaultValue={latest?.reference ?? amending.reference}
                    />
                  </Field>
                  <Field label="Receipt evidence URL">
                    <input
                      type="url"
                      name="evidence_url"
                      defaultValue={latest?.evidence_url ?? amending.evidence_url}
                    />
                  </Field>
                  <Field label="Reason for amendment">
                    <textarea required name="reason" maxLength={2000} />
                  </Field>
                  <TTButton type="submit" disabled={busy}>
                    Append evidence amendment
                  </TTButton>
                </form>
              );
            })()}
          {modal === "upload" && current && (
            <form
              className="rfp-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const file = f.get("file") as File;
                void run(
                  () => service.upload(current, file, String(f.get("note"))),
                  "New draft version saved.",
                );
              }}
            >
              <Field label="Draft file · PDF, DOCX or TXT · up to 20 MB">
                <input required name="file" type="file" accept=".pdf,.docx,.txt" />
              </Field>
              <Field label="Version notes">
                <textarea name="note" maxLength={2000} />
              </Field>
              <TTButton disabled={busy} type="submit">
                {busy ? "Uploading…" : "Save private version"}
              </TTButton>
            </form>
          )}
          {modal === "submission" && current && (
            <form
              className="rfp-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  await service.recordSubmission(current, {
                    ...submissionTimeFromForm(f),
                    channel: f.get("channel"),
                    reference: f.get("reference"),
                    evidence_url: f.get("evidence"),
                    draft_id: f.get("draft") || null,
                  });
                }, "External submission recorded. Review its evidence, then update the workflow stage.");
              }}
            >
              <SubmissionTimeFields />
              <Field label="Submission channel / recipient">
                <input name="channel" required maxLength={240} />
              </Field>
              <Field label="Receipt or reference">
                <input name="reference" maxLength={2000} />
              </Field>
              <Field label="Evidence URL (optional; otherwise evidence pending)">
                <input name="evidence" type="url" />
              </Field>
              <p>
                Choose the actual submitted file below. For a Google Doc submission, save this
                record, then use Add / correct evidence to identify the related document and
                submitted revision. Missing files and receipts remain explicitly unknown.
              </p>
              <Field label="Submitted draft">
                <select name="draft">
                  <option value="">Historical / draft unavailable</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.file_name} · {new Date(v.created_at).toLocaleString()}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="rfp-checkbox">
                <input required type="checkbox" /> I confirm this submission already happened
                outside CMD.
              </label>
              <TTButton disabled={busy} type="submit">
                Record submission
              </TTButton>
            </form>
          )}
          {modal === "check" && (
            <form
              className="rfp-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(
                  () =>
                    service.check(
                      String(f.get("note")),
                      Number(f.get("count")),
                      Number(f.get("failed")),
                    ),
                  "Manual discovery review recorded. Automation remains unconnected.",
                );
              }}
            >
              <Field label="Sources reviewed, URLs, findings and failures">
                <textarea required name="note" />
              </Field>
              <Field label="Number of sources checked">
                <input type="number" min="1" required name="count" />
              </Field>
              <Field label="Failed sources">
                <input type="number" min="0" required name="failed" defaultValue="0" />
              </Field>
              <TTButton disabled={busy} type="submit">
                Save review
              </TTButton>
            </form>
          )}
          {actionError && (
            <p role="alert" className="rfp-notice">
              {actionError}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
