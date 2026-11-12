import { useEffect, useRef, useState, type ReactNode, type ChangeEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BriefcaseBusiness,
  Check,
  CircleHelp,
  Eye,
  FileText,
  Lightbulb,
  List,
  Plus,
  Radio,
  Save,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  blankJob,
  HIRING_PEOPLE,
  jobSchema,
  stageLabel,
  type Job,
  type Snapshot,
} from "@/domain/hiring";
import logo from "@/assets/brand/trust-tai-logo.png";
import "./role-editor.css";

type Values = ReturnType<typeof blankJob>;
type Errors = Record<string, string>;
const serialize = (v: Values) => JSON.stringify(jobSchema.parse(v));
const ownerName = (id: string | null) =>
  HIRING_PEOPLE.find((p) => p.id === id)?.name ?? "Unassigned";

function RoleSection({
  title,
  hint,
  icon,
  children,
}: {
  title: string;
  hint: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="h-card hr-section">
      <header>
        <span className="h-icon">{icon}</span>
        <div>
          <h2>{title}</h2>
          <p>{hint}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function BulletEditor({
  title,
  values,
  change,
  errors,
  field,
}: {
  title: string;
  values: string[];
  change: (v: string[]) => void;
  errors: Errors;
  field: string;
}) {
  return (
    <div className="hr-list">
      {values.map((value, i) => (
        <div className="hr-bullet" key={i}>
          <span aria-hidden="true">•</span>
          <label>
            <span className="sr-only">
              {title} {i + 1}
            </span>
            <textarea
              rows={1}
              maxLength={1000}
              value={value}
              aria-invalid={Boolean(errors[`${field}.${i}`])}
              onChange={(e) => change(values.map((x, n) => (n === i ? e.target.value : x)))}
            />
            {errors[`${field}.${i}`] && (
              <small className="hr-error">{errors[`${field}.${i}`]}</small>
            )}
          </label>
          <Button
            type="button"
            variant="ghost"
            title={`Remove ${title.toLowerCase()} ${i + 1}`}
            aria-label={`Remove ${title.toLowerCase()} ${i + 1}`}
            onClick={() => change(values.filter((_, n) => n !== i))}
          >
            <Trash2 size={16} />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={values.length >= 20}
        onClick={() => change([...values, ""])}
      >
        <Plus size={16} />
        Add {title.toLowerCase()}
      </Button>
      {errors[field] && <p className="hr-error">{errors[field]}</p>}
    </div>
  );
}

export function RoleEditor({
  existing,
  currentRevision,
  duplicate,
  save,
  read,
  close,
  saved,
}: {
  existing?: Job | undefined;
  duplicate: Job | null;
  save: (v: Values, expected?: Job) => Promise<void>;
  currentRevision?: number | undefined;
  read: () => Promise<Snapshot>;
  close: () => void;
  saved: () => void;
}) {
  const [base, setBase] = useState(existing);
  const [values, setValues] = useState<Values>(() =>
    existing
      ? jobSchema.parse(existing)
      : duplicate
        ? {
            ...jobSchema.parse(duplicate),
            title: duplicate.title + " (copy)",
            slug: duplicate.slug + "-copy",
            status: "draft",
          }
        : blankJob(),
  );
  const initial = useRef(JSON.stringify(values));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [replace, setReplace] = useState(false);
  const [latest, setLatest] = useState<Job | null>(null);
  const [checked, setChecked] = useState("");
  const lock = useRef(false);
  const attempted = useRef<Values | null>(null);
  const dirty = JSON.stringify(values) !== initial.current;
  useEffect(() => {
    if (!dirty && !uncertain) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    const guardNavigation = (e: MouseEvent) => {
      const target = e.target;
      const link = target instanceof Element ? target.closest("a[href]") : null;
      if (!link || link.getAttribute("href")?.startsWith("#")) return;
      if (
        !window.confirm(
          "Leave this role editor? Unsaved inputs will be lost. An unconfirmed save may already have persisted.",
        )
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", guardNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guardNavigation, true);
    };
  }, [dirty, uncertain]);
  function change<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }
  function cancel() {
    setReplace(false);
    if (dirty || uncertain) setDiscard(true);
    else close();
  }
  async function submit(status: Values["status"]) {
    if (lock.current || uncertain) return;
    const next = { ...values, status };
    const result = jobSchema.safeParse(next);
    if (!result.success) {
      const fields: Errors = {};
      for (const issue of result.error.issues) fields[issue.path.join(".")] = issue.message;
      setErrors(fields);
      setFailure("Check the highlighted fields before saving.");
      return;
    }
    if (base && currentRevision !== undefined && currentRevision > base.revision) {
      setFailure(
        "This role changed while you were editing. Your inputs are retained. Check saved role before continuing.",
      );
      setUncertain(true);
      return;
    }
    lock.current = true;
    setBusy(true);
    setErrors({});
    setFailure("");
    setChecked("");
    attempted.current = result.data;
    try {
      await save(result.data, base);
      saved();
    } catch {
      setFailure(
        "Save could not be confirmed. Your inputs are retained. Check saved role before retrying; an interrupted save may already have persisted.",
      );
      setUncertain(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function reconcile() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setChecked("");
    try {
      const snapshot = await read();
      const row = base
        ? snapshot.jobs.find((j) => j.id === base.id)
        : snapshot.jobs.find((j) => j.slug === attempted.current?.slug);
      if (
        row &&
        attempted.current &&
        serialize(row) === serialize(attempted.current) &&
        (!base || row.revision > base.revision)
      ) {
        saved();
        return;
      }
      if (
        (base && row && row.revision === base.revision && serialize(row) === serialize(base)) ||
        (!base && !row)
      ) {
        setUncertain(false);
        setFailure("");
        setChecked("No saved change found. Your inputs are retained; you can retry the save.");
      } else {
        setLatest(row ?? null);
        setChecked(
          row
            ? "A different saved version exists. Retry is blocked. You can review the saved version below, then explicitly replace your unsaved inputs."
            : "The original role is unavailable. Your inputs are retained; saving remains blocked.",
        );
      }
    } catch {
      setChecked(
        "Saved role could not be checked. Your inputs are retained. Retry the check when the connection is available.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function field(
    key: "title" | "slug" | "team" | "location" | "arrangement" | "summary" | "about",
    label: string,
    max: number,
    area = false,
  ) {
    const props = {
      id: `hr-${key}`,
      "aria-label": label,
      value: values[key],
      maxLength: max,
      "aria-invalid": Boolean(errors[key]),
      "aria-describedby": errors[key] ? `hr-error-${key}` : undefined,
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        change(key, e.target.value),
    };
    return (
      <label htmlFor={`hr-${key}`}>
        {label}
        {area ? (
          <textarea {...props} rows={key === "about" ? 5 : 2} />
        ) : (
          <input {...props} readOnly={key === "slug" && Boolean(base)} />
        )}
        {errors[key] && (
          <small id={`hr-error-${key}`} className="hr-error">
            {errors[key]}
          </small>
        )}
        {key === "slug" && base && (
          <small>URL stays fixed after creation · revision {base.revision}</small>
        )}
      </label>
    );
  }
  return (
    <div className="hr-editor">
      <nav className="hr-breadcrumb" aria-label="Role breadcrumb">
        <Button type="button" variant="ghost" onClick={cancel} disabled={busy}>
          <ArrowLeft size={16} />
          Hiring / Roles
        </Button>
        <span aria-hidden="true">/</span>
        <span>{base ? "Edit role" : "Create role"}</span>
      </nav>
      <header className="hr-heading">
        <h1>{base ? "Edit job / role" : "Create a job / role"}</h1>
        <p>
          {base
            ? "Refine the role and choose whether to accept applications."
            : "Add a new role, define the details and choose when to accept applications."}
        </p>
      </header>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit(values.status);
        }}
      >
        <div className="hr-layout">
          <div className="hr-main">
            <fieldset disabled={busy} className="hr-fields">
              <RoleSection
                title="Role details"
                hint="The essentials for this role."
                icon={<BriefcaseBusiness size={18} />}
              >
                <div className="hr-field-grid">
                  {field("title", "Role title *", 160)}
                  {field("slug", "Slug *", 120)}
                  {field("team", "Team", 120)}
                  {field("location", "Location", 120)}
                  {field("arrangement", "Arrangement", 120)}
                  <label htmlFor="hr-owner">
                    Owner
                    <select
                      id="hr-owner"
                      aria-label="Owner"
                      value={values.owner_id ?? ""}
                      onChange={(e) => change("owner_id", e.target.value || null)}
                    >
                      <option value="">Unassigned</option>
                      {HIRING_PEOPLE.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    {errors["owner_id"] && <small className="hr-error">{errors["owner_id"]}</small>}
                  </label>
                </div>
              </RoleSection>
              <RoleSection
                title="Role overview"
                hint="Tell candidates what the role is about and why it matters."
                icon={<FileText size={18} />}
              >
                {field("summary", "Summary", 1000, true)}
                {field("about", "About the role", 10000, true)}
                <p className="hr-help">
                  Saved as plain text. Use the bullet lists below for responsibilities and
                  requirements.
                </p>
              </RoleSection>
              <RoleSection
                title="Responsibilities"
                hint="What they’ll be doing day to day."
                icon={<List size={18} />}
              >
                <BulletEditor
                  title="Responsibility"
                  values={values.responsibilities}
                  change={(v) => change("responsibilities", v)}
                  errors={errors}
                  field="responsibilities"
                />
              </RoleSection>
              <RoleSection
                title="Requirements"
                hint="The skills, experience or background we’re looking for."
                icon={<Check size={18} />}
              >
                <BulletEditor
                  title="Requirement"
                  values={values.requirements}
                  change={(v) => change("requirements", v)}
                  errors={errors}
                  field="requirements"
                />
              </RoleSection>
              <RoleSection
                title="Nice to have"
                hint="Optional strengths, not barriers to applying."
                icon={<Plus size={18} />}
              >
                <BulletEditor
                  title="Nice to have"
                  values={values.nice_to_have}
                  change={(v) => change("nice_to_have", v)}
                  errors={errors}
                  field="nice_to_have"
                />
              </RoleSection>
              <RoleSection
                title="Screening questions"
                hint="Two or three focused questions to get to know candidates."
                icon={<CircleHelp size={18} />}
              >
                <div className="hr-questions">
                  {values.questions.map((q, i) => (
                    <div className="hr-question" key={q.id}>
                      <label htmlFor={`hr-question-${q.id}`}>
                        Question {i + 1}
                        <input
                          id={`hr-question-${q.id}`}
                          aria-label={`Question ${i + 1}`}
                          maxLength={300}
                          value={q.label}
                          aria-invalid={Boolean(errors[`questions.${i}.label`])}
                          onChange={(e) =>
                            change(
                              "questions",
                              values.questions.map((x, n) =>
                                n === i ? { ...x, label: e.target.value } : x,
                              ),
                            )
                          }
                        />
                        {errors[`questions.${i}.label`] && (
                          <small className="hr-error">{errors[`questions.${i}.label`]}</small>
                        )}
                      </label>
                      <div className="hr-question-controls">
                        <label className="h-check">
                          <input
                            type="checkbox"
                            checked={q.required}
                            onChange={(e) =>
                              change(
                                "questions",
                                values.questions.map((x, n) =>
                                  n === i ? { ...x, required: e.target.checked } : x,
                                ),
                              )
                            }
                          />
                          Required question {i + 1}
                        </label>
                        <div>
                          {([-1, 1] as const).map((direction) => (
                            <Button
                              key={direction}
                              type="button"
                              variant="ghost"
                              title={`Move question ${i + 1} ${direction < 0 ? "up" : "down"}`}
                              aria-label={`Move question ${i + 1} ${direction < 0 ? "up" : "down"}`}
                              disabled={
                                i + direction < 0 || i + direction >= values.questions.length
                              }
                              onClick={() => {
                                const rows = [...values.questions];
                                const neighbor = rows[i + direction];
                                if (!neighbor) return;
                                rows[i] = neighbor;
                                rows[i + direction] = q;
                                change("questions", rows);
                              }}
                            >
                              {direction < 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                            </Button>
                          ))}
                          <Button
                            type="button"
                            variant="ghost"
                            title={`Remove question ${i + 1}`}
                            aria-label={`Remove question ${i + 1}`}
                            disabled={values.questions.length <= 2}
                            onClick={() =>
                              change(
                                "questions",
                                values.questions.filter((_, n) => n !== i),
                              )
                            }
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  type="button"
                  disabled={values.questions.length >= 3}
                  onClick={() =>
                    change("questions", [
                      ...values.questions,
                      {
                        id: `question_${crypto.randomUUID().replaceAll("-", "")}`,
                        label: "",
                        required: false,
                      },
                    ])
                  }
                >
                  <Plus size={16} />
                  Add question
                </Button>
                {errors["questions"] && <p className="hr-error">{errors["questions"]}</p>}
              </RoleSection>
              <RoleSection
                title="Publishing"
                hint="Control this role’s visibility and application flow."
                icon={<Radio size={18} />}
              >
                <div className="hr-field-grid">
                  <label htmlFor="hr-status">
                    Status
                    <select
                      id="hr-status"
                      aria-label="Status"
                      value={values.status}
                      onChange={(e) => change("status", e.target.value as Values["status"])}
                    >
                      <option value="draft">Draft</option>
                      <option value="open">Open</option>
                      <option value="closed">Closed</option>
                    </select>
                  </label>
                  <label className="h-check">
                    <input
                      type="checkbox"
                      checked={values.status === "open"}
                      onChange={(e) => change("status", e.target.checked ? "open" : "draft")}
                    />
                    Allow applications
                  </label>
                </div>
                <p className="hr-help">
                  Save draft persists Draft with intake off. Saving Open starts intake. Closed stops
                  new applications and keeps all records. Changes take effect only after saving.
                </p>
              </RoleSection>
            </fieldset>
            {failure && <p role="alert">{failure}</p>}
            {checked && <p role="status">{checked}</p>}
            {uncertain && (
              <div className="hr-recovery">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void reconcile()}
                >
                  Check saved role
                </Button>
                {latest && (
                  <>
                    <details>
                      <summary>Review saved version · revision {latest.revision}</summary>
                      <RolePreview values={jobSchema.parse(latest)} unsaved={false} />
                    </details>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        if (!base) {
                          setLatest(null);
                          setUncertain(false);
                          setFailure("");
                          setChecked(
                            "This stays a new draft. Choose a different slug before saving; the existing role will not be overwritten.",
                          );
                          return;
                        }
                        setReplace(true);
                        setDiscard(true);
                      }}
                    >
                      {base ? "Replace inputs with saved version" : "Keep as new draft"}
                    </Button>
                  </>
                )}
              </div>
            )}
            {discard && (
              <section
                className="h-card hr-confirm"
                role="alertdialog"
                aria-label="Discard unsaved role changes"
              >
                <h2>{replace ? "Replace unsaved inputs?" : "Discard unsaved changes?"}</h2>
                <p>
                  {replace
                    ? "This replaces your current inputs with the saved version shown above."
                    : "Your unsaved inputs will be lost. No role will be saved by leaving."}
                </p>
                <Button type="button" variant="outline" onClick={() => setDiscard(false)}>
                  Keep editing
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (replace && latest) {
                      const next = jobSchema.parse(latest);
                      setBase(latest);
                      setValues(next);
                      initial.current = JSON.stringify(next);
                      setLatest(null);
                      setUncertain(false);
                      setFailure("");
                      setChecked("");
                      setDiscard(false);
                    } else close();
                  }}
                >
                  {replace ? "Replace unsaved inputs" : "Discard changes"}
                </Button>
              </section>
            )}
            <footer className="hr-actions">
              <Button
                type="button"
                variant="outline"
                disabled={busy || uncertain}
                onClick={() => void submit("draft")}
              >
                <Save size={16} />
                Save draft
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={cancel}>
                Cancel
              </Button>
              <Button type="submit" className="h-primary" disabled={busy || uncertain}>
                {busy ? "Saving…" : base ? "Save changes" : "Create role"}
                <ArrowRight size={16} />
              </Button>
            </footer>
          </div>
          <aside className="hr-aside">
            <section className="h-card hr-preview">
              <header>
                <span className="h-icon">
                  <Eye size={18} />
                </span>
                <div>
                  <h2>Job preview</h2>
                  <p>Unsaved preview · not a published role</p>
                </div>
              </header>
              <RolePreview values={values} unsaved />
            </section>
            <section className="h-card hr-tips">
              <h2>
                <Lightbulb size={18} />
                Tips for a great role
              </h2>
              <ul>
                {[
                  "Be clear and specific about the work.",
                  "Focus on the impact, not just tasks.",
                  "Keep requirements realistic and inclusive.",
                  "Ask two or three thoughtful questions.",
                ].map((tip) => (
                  <li key={tip}>
                    <Check size={14} />
                    {tip}
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </form>
    </div>
  );
}

function RolePreview({ values: v, unsaved }: { values: Values; unsaved: boolean }) {
  return (
    <div
      className="hr-preview-content"
      aria-label={unsaved ? "Unsaved role preview" : "Saved role preview"}
    >
      <div className="hr-banner">
        <img src={logo} alt="Trust Tai" />
      </div>
      <h3>{v.title || "Role title"}</h3>
      <div className="hr-meta">
        {[v.team, v.location].filter(Boolean).map((x, i) => (
          <span key={i}>{x}</span>
        ))}
      </div>
      {v.summary && <p className="h-pre">{v.summary}</p>}
      <section className="hr-key-details">
        <h4>Key details</h4>
        <ul>
          {[v.arrangement, v.location, v.team].filter(Boolean).map((x, i) => (
            <li key={i}>
              <Check size={14} />
              {x}
            </li>
          ))}
          <li>Owner: {ownerName(v.owner_id)}</li>
          <li>
            {stageLabel(v.status)} ·{" "}
            {v.status === "open" ? "Applications allowed after save" : "Intake off"}
          </li>
        </ul>
      </section>
      {v.about && (
        <section>
          <h4>About the role</h4>
          <p className="h-pre">{v.about}</p>
        </section>
      )}
      {(
        [
          ["Responsibilities", v.responsibilities],
          ["Requirements", v.requirements],
          ["Nice to have", v.nice_to_have],
        ] as const
      ).map(
        ([label, rows]) =>
          rows.some((r) => r.trim()) && (
            <section key={label}>
              <h4>{label}</h4>
              <ul>
                {rows
                  .filter((r) => r.trim())
                  .map((r, i) => (
                    <li key={i} className="h-pre">
                      {r}
                    </li>
                  ))}
              </ul>
            </section>
          ),
      )}
      <section>
        <h4>Screening questions</h4>
        <ol>
          {v.questions.map((q) => (
            <li key={q.id}>
              {q.label || "Question text"}
              <small>{q.required ? "Required" : "Optional"}</small>
            </li>
          ))}
        </ol>
      </section>
      <small>URL: /careers/{v.slug || "role-slug"}</small>
    </div>
  );
}
