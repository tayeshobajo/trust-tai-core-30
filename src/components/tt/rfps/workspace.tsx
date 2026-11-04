import { useState, useEffect, type FormEvent, type ReactNode } from "react";
import { FileText, Plus, Search, Trophy, ExternalLink, Clock, Layers, Radio } from "lucide-react";
import { TTButton } from "@/components/tt/primitives";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  blankOpportunity,
  deadlineLabel,
  filterOpportunities,
  opportunityInput,
  stages,
  stageLabel,
  type Opportunity,
  type OpportunityInput,
  type Snapshot,
  type Stage,
} from "@/domain/rfps";
import type { RfpService } from "@/data/supabase/rfps";
import "./workspace.css";
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
          v.kind === "grant" ? "Funder / administrator *" : "Issuing organization *",
        )}
        {text("source_url", "Official source URL *", "url")}
        {text("cycle", "Application cycle / solicitation ID *")}
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
  const [modal, setModal] = useState<"create" | "edit" | "upload" | "submission" | "check" | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [actionError, setActionError] = useState("");
  const rows = filterOpportunities(data.opportunities, query, filter, kind);
  const current = rows.find((o) => o.id === selected) ?? rows[0];
  const versions = data.versions.filter((v) => v.opportunity_id === current?.id);
  const submissions = data.submissions.filter((v) => v.opportunity_id === current?.id);
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
    <div className="rfp-workspace">
      {offline && (
        <p role="status" className="rfp-notice">
          You are offline. Showing the last loaded records; reconnect before saving or uploading.
        </p>
      )}
      <header className="rfp-header">
        <div>
          <p className="rfp-eyebrow">OPPORTUNITIES / PROPOSALS</p>
          <h1>RFPs &amp; Grants</h1>
          <p>Find the right fit. Prepare a stronger proposal. Keep the evidence.</p>
        </div>
        <TTButton disabled={!available} onClick={() => open("create")}>
          <Plus size={16} /> Add opportunity
        </TTButton>
      </header>
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
      <div className="rfp-stats">
        {[
          ["captured", "Incoming", FileText],
          ["review", "In review", Clock],
          ["preparing", "Preparing", Layers],
          ["submitted", "Submitted", FileText],
          ["awarded", "Awarded", Trophy],
        ].map(([stage, label, Icon]) => {
          const Glyph = Icon as typeof FileText;
          return (
            <button
              key={String(stage)}
              className={filter === stage ? "active" : ""}
              onClick={() => setFilter(String(stage))}
              aria-pressed={filter === stage}
            >
              <Glyph size={21} />
              <span>
                {String(label)}
                <strong>
                  {loading || error
                    ? "—"
                    : data.opportunities.filter((o) => o.stage === stage).length}
                </strong>
              </span>
            </button>
          );
        })}
      </div>
      <div className="rfp-toolbar">
        <Field label="Search opportunities">
          <span className="rfp-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Title, issuer, applicant, owner…"
            />
          </span>
        </Field>
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
            <div className="rfp-list-heading">
              <strong>
                {rows.length} {rows.length === 1 ? "opportunity" : "opportunities"}
              </strong>
              <span>Deadline date</span>
            </div>
            {rows.length ? (
              rows.map((o) => (
                <button
                  key={o.id}
                  className={`rfp-row ${current?.id === o.id ? "selected" : ""}`}
                  aria-pressed={current?.id === o.id}
                  onClick={() => {
                    setSelected(o.id);
                    setTab("overview");
                  }}
                >
                  <span className="rfp-type-icon">
                    {o.kind === "grant" ? <Trophy size={19} /> : <FileText size={19} />}
                  </span>
                  <span className="rfp-row-body">
                    <strong>{o.title}</strong>
                    <span>{o.source_name}</span>
                    <small>
                      {o.kind === "grant" ? "Grant" : "RFP"} ·{" "}
                      {o.deadline_date || "Deadline unknown"}
                    </small>
                    <span className="rfp-pill">{stageLabel[o.stage]}</span>
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
                <div className="rfp-detail-head">
                  <p className="rfp-eyebrow">
                    {current.kind === "grant" ? "GRANT OPPORTUNITY" : "REQUEST FOR PROPOSALS"}
                  </p>
                  <h2>{current.title}</h2>
                  <p>
                    {current.source_name} · {current.cycle}
                  </p>
                  <div className="rfp-tags">
                    <span className="rfp-pill">{deadlineLabel(current)}</span>
                    <span className="rfp-pill">Eligibility: {current.eligibility}</span>
                  </div>
                </div>
                <div className="rfp-tabs" role="tablist" aria-label="Opportunity details">
                  {["overview", "proposal", "submissions"].map((t) => (
                    <button
                      role="tab"
                      aria-selected={tab === t}
                      aria-controls={`rfp-${t}`}
                      id={`tab-${t}`}
                      key={t}
                      onClick={() => setTab(t)}
                    >
                      {t === "proposal"
                        ? `Drafts (${versions.length})`
                        : t === "submissions"
                          ? `Submissions (${submissions.length})`
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
                      <h3>Applicant &amp; eligibility</h3>
                      <p>{current.applicant || "Applicant legal entity not recorded."}</p>
                      <p className="rfp-pre">
                        {current.eligibility_notes || "Eligibility has not been reviewed."}
                      </p>
                      <h3>
                        {current.kind === "grant"
                          ? "Grant requirements"
                          : "RFP response requirements"}
                      </h3>
                      <p className="rfp-pre">
                        {current.requirements || "Requirements have not been recorded."}
                      </p>
                      <h3>Source evidence</h3>
                      <p className="rfp-pre">{current.source_evidence}</p>
                      <a href={current.source_url} target="_blank" rel="noreferrer">
                        Open official source <ExternalLink size={14} />
                      </a>
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
                        <h3>Draft version history</h3>
                        <TTButton disabled={!available} onClick={() => open("upload")}>
                          Upload version
                        </TTButton>
                      </div>
                      <p className="rfp-muted">
                        Private files. New uploads preserve previous versions. Download to view PDF,
                        DOCX or TXT; no public file links.
                      </p>
                      {!versions.length && (
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
                            {new Date(s.submitted_at).toLocaleString()} · {s.channel}
                          </strong>
                          <p>{s.reference || "Reference not recorded"}</p>
                          <p>
                            {s.draft_id
                              ? versions.find((v) => v.id === s.draft_id)?.file_name ||
                                "Linked draft"
                              : "Historical submission · draft unavailable"}
                          </p>
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
                <h3>Move this opportunity forward</h3>
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
                  <dt>Next action</dt>
                  <dd>{current.next_action || "Decide the next step."}</dd>
                </dl>
                <TTButton variant="quiet" disabled={!available} onClick={() => open("edit")}>
                  Edit opportunity
                </TTButton>
                <hr />
                <h3>Proposal</h3>
                <p>
                  {versions.length
                    ? `${versions.length} saved draft version${versions.length === 1 ? "" : "s"}`
                    : "No draft uploaded yet."}
                </p>
                <TTButton disabled={!available} onClick={() => open("upload")}>
                  Upload draft
                </TTButton>
                <TTButton variant="quiet" disabled={!available} onClick={() => open("submission")}>
                  Record external submission
                </TTButton>
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
              {modal === "create"
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
          {(modal === "create" || modal === "edit") && (
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
                    submitted_at: new Date(String(f.get("time"))).toISOString(),
                    channel: f.get("channel"),
                    reference: f.get("reference"),
                    evidence_url: f.get("evidence"),
                    draft_id: f.get("draft") || null,
                  });
                }, "External submission recorded. Review its evidence, then update the workflow stage.");
              }}
            >
              <Field label="Submitted at (your browser timezone)">
                <input name="time" required type="datetime-local" />
              </Field>
              <Field label="Submission channel / recipient">
                <input name="channel" required maxLength={240} />
              </Field>
              <Field label="Receipt or reference">
                <input name="reference" maxLength={2000} />
              </Field>
              <Field label="Evidence URL (optional; otherwise evidence pending)">
                <input name="evidence" type="url" />
              </Field>
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
