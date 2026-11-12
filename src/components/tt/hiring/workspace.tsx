import { useRef, useState } from "react";
import {
  blankJob,
  HIRING_PEOPLE,
  needsAttention,
  stageLabel,
  STAGES,
  type Application,
  type Event,
  type Job,
  type Message,
  type Snapshot,
} from "@/domain/hiring";
import type { HiringService } from "@/data/supabase/hiring";
import "./workspace.css";
const name = (id: string | null) => HIRING_PEOPLE.find((p) => p.id === id)?.name ?? "Unassigned";
const activityLabels: Record<string, string> = {
  "application.received": "Application received",
  "application.updated": "Next step updated",
  "note.added": "Private note",
  "message.drafted": "Email draft saved",
  "message.queued": "QA email approved",
  "message.receipt": "Delivery receipt",
  "message.tested": "Test receipt saved",
};
function activityText(event: Event) {
  const d = event.detail;
  if (typeof d["text"] === "string") return d["text"];
  if (event.kind === "application.updated")
    return `${stageLabel(String(d["from"]))} → ${stageLabel(String(d["to"]))}. Owner: ${name(typeof d["owner_id"] === "string" ? d["owner_id"] : null)}. Next: ${d["next_action"] || "Not set"}. Review: ${d["review_date"] || "Not set"}.`;
  if (event.kind === "application.received")
    return "Application and résumé saved for private review. No email sent.";
  if (event.kind === "message.receipt")
    return `Provider state: ${d["state"] || "unknown"}.${d["provider_event"] ? ` Observed event: ${d["provider_event"]}.` : ""}`;
  if (event.kind === "message.drafted")
    return `${d["subject"] || "Email"} · version ${d["revision"]}. Nothing sent.`;
  if (event.kind === "message.queued")
    return `Version ${d["revision"]} approved for the provider-owned QA inbox.`;
  if (event.kind === "message.tested") return "Test receipt recorded. No email sent.";
  return "Activity recorded.";
}
export function HiringWorkspace({
  data,
  service,
  refresh,
  loading,
  error,
  initialId,
}: {
  data?: Snapshot | undefined;
  service: HiringService;
  refresh: () => Promise<unknown>;
  loading: boolean;
  error?: string | undefined;
  initialId?: string | undefined;
}) {
  const [tab, setTab] = useState("queue"),
    [selected, setSelected] = useState(initialId ?? ""),
    [filter, setFilter] = useState(""),
    [role, setRole] = useState(""),
    [stage, setStage] = useState(""),
    [attention, setAttention] = useState(false);
  const [edit, setEdit] = useState<Job | "new" | null>(null),
    [duplicate, setDuplicate] = useState<Job | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [failure, setFailure] = useState("");
  const lock = useRef(false);
  async function run(fn: () => Promise<unknown>, success: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailure("");
    setNotice("");
    try {
      await fn();
      setNotice(success);
      await refresh();
    } catch (e) {
      setFailure(
        (e as Error).message +
          " Your changes may have saved if the connection was interrupted. Reload to check before repeating.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const current = data?.applications.find((a) => a.id === selected);
  const today = new Date().toISOString().slice(0, 10);
  const filtered = (data?.applications ?? []).filter(
    (a) =>
      (!role || a.job_id === role) &&
      (!stage || a.stage === stage) &&
      (!attention || needsAttention(a, today)) &&
      `${a.full_name} ${a.email}`.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <section className="hiring">
      <header>
        <p className="h-eyebrow">PEOPLE / PRIVATE WORKSPACE</p>
        <h1>Hiring</h1>
        <p>Thoughtful decisions. Clear next steps. A person behind every application.</p>
        <p className="h-notice">
          Live applicant emails await separate approval. Provider QA uses test inboxes only. Cleanup
          review: Ayobami.
        </p>
      </header>
      <nav aria-label="Hiring views">
        <button
          aria-pressed={tab === "queue"}
          onClick={() => {
            setTab("queue");
            setSelected("");
          }}
        >
          Applications {data ? `(${data.applications.length})` : ""}
        </button>
        <button aria-pressed={tab === "jobs"} onClick={() => setTab("jobs")}>
          Jobs
        </button>
        <button disabled={busy} onClick={() => run(refresh, "Queue refreshed.")}>
          Reload
        </button>
      </nav>
      {loading && <p role="status">Opening your private hiring queue…</p>}
      {error && <p role="alert">{error}</p>}
      {failure && <p role="alert">{failure}</p>}
      {notice && <p role="status">{notice}</p>}
      {data && tab === "queue" && !current && (
        <>
          <div className="h-filters">
            <label>
              Search
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Name or email"
              />
            </label>
            <label>
              Role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
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
              <select aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)}>
                <option value="">All stages</option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {stageLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="h-check">
              <input
                type="checkbox"
                checked={attention}
                onChange={(e) => setAttention(e.target.checked)}
              />
              Overdue or unassigned
            </label>
          </div>
          <div className="h-queue">
            {filtered.map((a) => (
              <button className="h-row" key={a.id} onClick={() => setSelected(a.id)}>
                <span>
                  <strong>{a.full_name}</strong>
                  <small>{a.job_title}</small>
                </span>
                <span>
                  {stageLabel(a.stage)}
                  <small>{name(a.owner_id)}</small>
                </span>
                <span>
                  {a.next_action || "Set a next action"}
                  <small>
                    {a.review_date ? `Review ${a.review_date}` : "No review date"}
                    {needsAttention(a, today) ? " · Needs attention" : ""}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {data.applications.length > 0 && filtered.length === 0 && (
            <p role="status">
              No applications match these filters. Clear the search or choose all roles and stages.
            </p>
          )}
          {data.applications.length === 0 && (
            <div className="h-empty">
              <h2>Room for the right people.</h2>
              <p>Open a role in Jobs. Applications will arrive here for personal review.</p>
              <button onClick={() => setTab("jobs")}>Manage jobs</button>
            </div>
          )}
        </>
      )}
      {data && current && tab === "queue" && (
        <>
          <button onClick={() => setSelected("")}>← All applications</button>
          <Candidate
            key={current.id + ":" + current.revision}
            app={current}
            data={data}
            busy={busy}
            run={run}
            service={service}
          />
        </>
      )}
      {data && tab === "jobs" && (
        <>
          <div className="h-heading">
            <h2>Roles worth doing</h2>
            <button
              onClick={() => {
                setDuplicate(null);
                setEdit("new");
              }}
            >
              Create job
            </button>
          </div>
          {data.jobs.map((j) => (
            <article className="h-row" key={j.id}>
              <span>
                <strong>{j.title}</strong>
                <small>
                  {j.status} · {name(j.owner_id)}
                </small>
                <a href={`https://trusttai.com/careers/${j.slug}`} target="_blank" rel="noreferrer">
                  /careers/{j.slug}
                </a>
              </span>
              <div>
                <button
                  onClick={() => {
                    setDuplicate(null);
                    setEdit(j);
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() => {
                    setDuplicate(j);
                    setEdit("new");
                  }}
                >
                  Duplicate as draft
                </button>
              </div>
            </article>
          ))}
          {!data.jobs.length && (
            <p>No roles yet. Create a draft and choose two or three focused questions.</p>
          )}
        </>
      )}
      {edit && (
        <JobEditor
          key={typeof edit === "string" ? (duplicate?.id ?? "new") : edit.id}
          existing={edit === "new" ? undefined : edit}
          duplicate={duplicate}
          busy={busy}
          close={() => setEdit(null)}
          save={async (values) => {
            await service.saveJob(values, edit === "new" ? undefined : edit);
            setEdit(null);
          }}
          run={run}
        />
      )}
    </section>
  );
}
type Run = (fn: () => Promise<unknown>, success: string) => Promise<void>;
function Candidate({
  app: a,
  data,
  busy,
  run,
  service,
}: {
  app: Application;
  data: Snapshot;
  busy: boolean;
  run: Run;
  service: HiringService;
}) {
  const [stage, setStage] = useState(a.stage),
    [owner, setOwner] = useState(a.owner_id ?? ""),
    [next, setNext] = useState(a.next_action),
    [date, setDate] = useState(a.review_date ?? ""),
    [note, setNote] = useState("");
  const noteId = useRef(crypto.randomUUID());
  const [message, setMessage] = useState<Message | null>(null),
    [subject, setSubject] = useState(`Your application for ${a.job_title}`),
    [body, setBody] = useState(
      `Hello ${a.full_name},\n\nThank you for your interest in ${a.job_title}.\n\n`,
    ),
    [preview, setPreview] = useState<Message | null>(null);
  const draftId = useRef(crypto.randomUUID());
  const [resumeLink, setResumeLink] = useState<string | null>(null);
  const currentPreview = preview && (data.messages.find((m) => m.id === preview.id) ?? preview);
  return (
    <div className="h-detail">
      <main>
        <h2>{a.full_name}</h2>
        <p>
          {a.job_title} · {a.location} · {a.timezone}
        </p>
        <p>{a.email}</p>
        <p>
          Received {new Date(a.created_at).toLocaleString()} · Future roles:{" "}
          {a.talent_pool_consent ? "Opted in" : "Not opted in"}
        </p>
        <div className="h-actions">
          {[a.linkedin_url, a.portfolio_url]
            .filter((u) => /^https:\/\//.test(u))
            .map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer">
                {u}
              </a>
            ))}
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                setResumeLink(await service.resume(a.resume_path));
              }, "Private download is ready. Open the link below within 60 seconds.")
            }
          >
            Download résumé
          </button>
          {resumeLink && (
            <a href={resumeLink} target="_blank" rel="noreferrer">
              Open private résumé (60 seconds)
            </a>
          )}
        </div>
        <h3>In their words</h3>
        {Object.entries(a.answers).map(([id, q]) => (
          <section key={id}>
            <h4>{q.label}</h4>
            <p className="h-pre">{q.answer || "No answer"}</p>
          </section>
        ))}
        <h3>Private notes & contact history</h3>
        <label>
          Add a note
          <textarea value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button
          disabled={busy || !note.trim()}
          onClick={() =>
            run(async () => {
              await service.note(a.id, note, noteId.current);
              noteId.current = crypto.randomUUID();
              setNote("");
            }, "Private note saved.")
          }
        >
          Save note
        </button>
        {data.events
          .filter((e) => e.application_id === a.id)
          .map((e) => (
            <article className="h-event" key={e.id}>
              <strong>{activityLabels[e.kind] || "Activity"}</strong>
              <small>
                {e.actor
                  ? name(e.actor)
                  : e.detail["source"] === "provider-worker"
                    ? "Delivery service"
                    : "Applicant"}{" "}
                · {new Date(e.created_at).toLocaleString()}
              </small>
              <p className="h-pre">{activityText(e)}</p>
            </article>
          ))}
      </main>
      <aside>
        <h3>Next step</h3>
        <label>
          Stage
          <select
            aria-label="Stage"
            value={stage}
            onChange={(e) => setStage(e.target.value as Application["stage"])}
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {stageLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <Owner value={owner} change={setOwner} />
        <label>
          Next action
          <textarea value={next} maxLength={2000} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label>
          Review date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button
          disabled={busy}
          onClick={() =>
            run(
              () =>
                service.update({
                  target: a.id,
                  expected: a.revision,
                  stage,
                  owner_id: owner || null,
                  next_action: next,
                  review_date: date || null,
                }),
              "Application updated. No email was sent.",
            )
          }
        >
          Save next step
        </button>
        <p className="h-muted">Changing a stage never sends a message.</p>
        <h3>Write to the candidate</h3>
        <label>
          Subject
          <input
            aria-label="Subject"
            value={subject}
            maxLength={200}
            onChange={(e) => {
              setSubject(e.target.value);
              setPreview(null);
            }}
          />
        </label>
        <label>
          Message
          <textarea
            aria-label="Message"
            rows={8}
            value={body}
            maxLength={10000}
            onChange={(e) => {
              setBody(e.target.value);
              setPreview(null);
            }}
          />
        </label>
        <button
          disabled={busy || !subject.trim() || !body.trim()}
          onClick={() =>
            run(async () => {
              const id = message?.id ?? draftId.current;
              await service.draft({
                target: a.id,
                message_id: id,
                expected: message?.revision ?? 0,
                subject,
                body,
              });
              setMessage({
                ...message,
                id,
                application_id: a.id,
                subject,
                body,
                revision: (message?.revision ?? 0) + 1,
                status: "draft",
                receipt: null,
              });
            }, "Draft saved. Choose it below to preview the exact saved version.")
          }
        >
          Save draft
        </button>
        {data.messages
          .filter((m) => m.application_id === a.id)
          .map((m) => (
            <article className="h-event" key={m.id}>
              <strong>{m.subject}</strong>
              <small>
                {m.status === "disabled" ? "Delivery disabled" : m.status} · v{m.revision}
              </small>
              <button
                onClick={() => {
                  setMessage(m);
                  setSubject(m.subject);
                  setBody(m.body);
                  setPreview(m);
                }}
              >
                Preview / edit
              </button>
            </article>
          ))}
        {currentPreview && (
          <section className="h-preview" aria-label="Email preview">
            <h4>{currentPreview.subject}</h4>
            <p>To: {a.email}</p>
            <p className="h-pre">{currentPreview.body}</p>
            <p>Version {currentPreview.revision}. Live applicant delivery is not enabled.</p>
            {["delivered@resend.dev", "bounced@resend.dev"].includes(a.email) && (
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const result = await service.providerQA(
                      currentPreview.id,
                      currentPreview.revision,
                      ["sending", "sent", "delivered", "unknown", "failed"].includes(
                        currentPreview.status,
                      )
                        ? currentPreview.receipt
                        : undefined,
                    );
                    if (result.state === "unknown")
                      throw new Error("Provider outcome uncertain. Reconcile before retrying");
                  }, "Provider receipt refreshed. Check the saved delivery state below.")
                }
              >
                {["draft", "disabled"].includes(currentPreview.status)
                  ? "Approve QA send"
                  : currentPreview.status === "queued"
                    ? "Resume QA dispatch"
                    : "Reconcile provider receipt"}
              </button>
            )}
            <button
              disabled={busy || currentPreview.status !== "draft"}
              onClick={() =>
                run(async () => {
                  await service.testSend(currentPreview.id, currentPreview.revision);
                  setPreview({ ...currentPreview, status: "disabled" });
                }, "Test receipt saved. No email was sent.")
              }
            >
              Approve & test send
            </button>
          </section>
        )}
      </aside>
    </div>
  );
}
function Owner({ value, change }: { value: string; change: (s: string) => void }) {
  return (
    <label>
      Owner
      <select aria-label="Owner" value={value} onChange={(e) => change(e.target.value)}>
        <option value="">Unassigned</option>
        {HIRING_PEOPLE.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
function JobEditor({
  existing,
  duplicate,
  busy,
  close,
  save,
  run,
}: {
  existing?: Job | undefined;
  duplicate: Job | null;
  busy: boolean;
  close: () => void;
  save: (v: unknown) => Promise<void>;
  run: Run;
}) {
  const [v, setV] = useState(
    () =>
      existing ??
      (duplicate
        ? {
            ...duplicate,
            title: duplicate.title + " (copy)",
            slug: duplicate.slug + "-copy",
            status: "draft" as const,
          }
        : blankJob()),
  );
  return (
    <section className="h-editor" aria-label="Job editor">
      <h2>{existing ? "Edit role" : "Draft a role"}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => save(v), "Job saved.");
        }}
      >
        <div className="h-form-grid">
          {(["title", "slug", "team", "location", "arrangement"] as const).map((k) => (
            <label key={k}>
              {k}
              <input
                required={k === "title" || k === "slug"}
                value={v[k]}
                disabled={k === "slug" && !!existing}
                onChange={(e) => setV({ ...v, [k]: e.target.value })}
              />
            </label>
          ))}
          <Owner
            value={v.owner_id ?? ""}
            change={(owner_id) => setV({ ...v, owner_id: owner_id || null })}
          />
        </div>
        <p>Job URLs stay fixed after creation. Duplicate creates a new draft.</p>
        {(["summary", "about"] as const).map((k) => (
          <label key={k}>
            {k}
            <textarea value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          </label>
        ))}
        {(["responsibilities", "requirements", "nice_to_have"] as const).map((k) => (
          <label key={k}>
            {k.replaceAll("_", " ")} (one per line)
            <textarea
              value={v[k].join("\n")}
              onChange={(e) => setV({ ...v, [k]: e.target.value.split("\n") })}
            />
          </label>
        ))}
        <h3>Screening questions</h3>
        {v.questions.map((q, i) => (
          <label key={q.id}>
            Question {i + 1}
            <input
              required
              value={q.label}
              maxLength={300}
              onChange={(e) =>
                setV({
                  ...v,
                  questions: v.questions.map((x, n) =>
                    n === i ? { ...x, label: e.target.value } : x,
                  ),
                })
              }
            />
            <span className="h-check">
              <input
                type="checkbox"
                checked={q.required}
                onChange={(e) =>
                  setV({
                    ...v,
                    questions: v.questions.map((x, n) =>
                      n === i ? { ...x, required: e.target.checked } : x,
                    ),
                  })
                }
              />
              Required
            </span>
          </label>
        ))}
        {v.questions.length === 2 ? (
          <button
            type="button"
            onClick={() =>
              setV({
                ...v,
                questions: [...v.questions, { id: "additional", label: "", required: false }],
              })
            }
          >
            Add third question
          </button>
        ) : (
          <button type="button" onClick={() => setV({ ...v, questions: v.questions.slice(0, 2) })}>
            Remove third question
          </button>
        )}
        <label>
          Status
          <select
            aria-label="Status"
            value={v.status}
            onChange={(e) => setV({ ...v, status: e.target.value as Job["status"] })}
          >
            <option value="draft">Draft</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <p>
          Opening allows applications. Closing stops new applications and keeps all
          records.
        </p>
        <div className="h-actions">
          <button disabled={busy} type="submit">
            Save job
          </button>
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
