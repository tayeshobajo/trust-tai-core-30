import { useId, useRef, useState } from "react";
import {
  createManualResearchFixture,
  manualSourceUrls,
  manualStatusLabel,
  type ManualResearchAdapter,
  type ManualView,
  type ManualCommand,
} from "@/domain/studio-manual-research";
import "./manual-research.css";
/** No adapter is passed by the live page: no request runs, fetches or subscriptions on mount. */
type ManualResearchProps = { organizationId: string; adapter?: ManualResearchAdapter };
export function ManualResearch(props: ManualResearchProps) {
  const context = useRef({ adapter: props.adapter, revision: 0 });
  if (context.current.adapter !== props.adapter)
    context.current = { adapter: props.adapter, revision: context.current.revision + 1 };
  // Remount all context-bound state. Old promises belong only to the discarded instance.
  return (
    <ManualResearchContext key={`${props.organizationId}:${context.current.revision}`} {...props} />
  );
}
function ManualResearchContext({ organizationId, adapter }: ManualResearchProps) {
  const id = useId(),
    [local, setLocal] = useState<ManualResearchAdapter | undefined>(),
    driver = adapter ?? local;
  const [topic, setTopic] = useState(""),
    [urls, setUrls] = useState(""),
    [approved, setApproved] = useState(false),
    [command, setCommand] = useState<ManualCommand | null>(null),
    [view, setView] = useState<ManualView | null>(null),
    [busy, setBusy] = useState(false),
    [starting, setStarting] = useState(false),
    [checking, setChecking] = useState(false),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [edit, setEdit] = useState("");
  const sequence = useRef(0),
    controlLock = useRef(false),
    lock = useRef(false),
    status = useRef<HTMLParagraphElement>(null);
  const preview = driver?.mode === "local-fixture";
  async function act(
    operation: () => Promise<ManualView>,
    expectedId = command?.requestId,
    control = false,
    start = false,
  ) {
    if (control ? controlLock.current : lock.current) return;
    if (control) {
      controlLock.current = true;
      setChecking(true);
    } else {
      lock.current = true;
      setBusy(true);
      setStarting(start);
    }
    const serial = ++sequence.current;
    setError("");
    try {
      const result = await operation();
      if (expectedId && result.requestId !== expectedId) throw Error("request_mismatch");
      if (serial === sequence.current) setView(result);
    } catch {
      if (serial !== sequence.current) return;
      setError(
        "The outcome could not be confirmed. Keep this request and check its status; do not start it again.",
      );
      setView((v) => ({
        requestId: v?.requestId ?? expectedId ?? "",
        status: "uncertain",
        executionStop: "unverified",
      }));
    } finally {
      if (control) {
        controlLock.current = false;
        setChecking(false);
      } else {
        lock.current = false;
        setBusy(false);
        setStarting(false);
      }
      status.current?.focus();
    }
  }
  function queue() {
    if (!driver || !approved || command || lock.current) return;
    let sources: string[];
    try {
      sources = manualSourceUrls(urls);
      if (topic.trim().length < 3) throw Error("Add a topic with at least three characters.");
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const next = {
      organizationId,
      requestId: crypto.randomUUID(),
      topic: topic.trim(),
      approvedUrls: sources,
    };
    setCommand(next);
    void act(() => driver.approve(next), next.requestId);
  }
  const requestId = command?.requestId;
  return (
    <section className="sv-card sr-manual" aria-labelledby={`${id}-heading`}>
      <header className="sw-section-heading">
        <div>
          <span className="sw-kicker">MANUAL RESEARCH</span>
          <h2 id={`${id}-heading`}>Start with a topic and trusted sources.</h2>
        </div>
        <span className="sw-status">
          {preview ? "Local example" : driver ? "Manual research" : "Live research unavailable"}
        </span>
      </header>
      <p>
        Approve up to three public URLs for one research request. One CLI job has a 60-second
        deadline and no coordinator retry. Internal provider calls and cost are unmeasured; there is
        no guaranteed dollar cap. Review the brief before choosing what to use.
      </p>
      <p className="sr-note">
        No approved voice examples are available. Voice drafts, introductions, publishing and
        automatic learning are not enabled.
      </p>
      {!driver && (
        <button
          className="sv-button"
          onClick={() => {
            setLocal(createManualResearchFixture());
            setTopic("Practical AI handoffs");
            setUrls("https://example.org/article");
          }}
        >
          Try a local example
        </button>
      )}
      {preview && (
        <p className="sr-note" role="note">
          Fictional local example · nothing is fetched, sent or saved outside this preview.
        </p>
      )}
      <div className="sr-form">
        <label htmlFor={`${id}-topic`}>What would you like to explore?</label>
        <textarea
          id={`${id}-topic`}
          value={topic}
          maxLength={1200}
          disabled={!!command || busy}
          onChange={(e) => setTopic(e.target.value)}
        />
        <label htmlFor={`${id}-urls`}>Public source URLs · one per line</label>
        <textarea
          id={`${id}-urls`}
          value={urls}
          maxLength={6000}
          disabled={!!command || busy}
          placeholder="https://example.org/article"
          aria-describedby={`${id}-source-note`}
          onChange={(e) => {
            setUrls(e.target.value);
            setApproved(false);
          }}
        />
        <small id={`${id}-source-note`}>
          Exact HTTPS pages only. Public network checks happen on the server when research is
          available.
        </small>
        <label className="sr-check">
          <input
            type="checkbox"
            checked={approved}
            disabled={!!command || busy}
            onChange={(e) => setApproved(e.target.checked)}
          />
          I approve these exact URLs for this request.
        </label>
      </div>
      <div className="sr-actions">
        <button
          className="sv-button sv-button-primary"
          disabled={!driver || busy || !approved || !!command}
          onClick={queue}
        >
          {preview ? "Queue local example" : "Approve sources and queue"}
        </button>
        {view?.status === "queued" && requestId && (
          <button
            className="sv-button"
            disabled={busy}
            onClick={() => void act(() => driver!.start(requestId), requestId, false, true)}
          >
            {preview ? "Start local example" : "Start approved request"}
          </button>
        )}
        {command && view?.status === "delivery_uncertain" && driver?.reconcile && (
          <button
            className="sv-button"
            disabled={checking}
            onClick={() =>
              void act(() => driver.reconcile!(command.requestId), command.requestId, true)
            }
          >
            Reconcile brief delivery
          </button>
        )}
        {command && (
          <button
            className="sv-button"
            disabled={(busy && !starting) || checking || !driver}
            onClick={() => void act(() => driver!.read(command.requestId), command.requestId, true)}
          >
            Check status
          </button>
        )}
        {command && ["queued", "started", "uncertain"].includes(view?.status ?? "") && (
          <button
            className="sv-button"
            disabled={(busy && !starting) || checking || !driver}
            onClick={() =>
              void act(() => driver!.cancel(command.requestId), command.requestId, true)
            }
          >
            Request stop
          </button>
        )}
      </div>
      <p ref={status} tabIndex={-1} role="status" aria-live="polite">
        {busy && !starting
          ? "Checking this request…"
          : view
            ? manualStatusLabel(view)
            : "No request has started."}
      </p>
      {command && (
        <div className="sr-approved">
          <strong>Approved request</strong>
          <p>{command.topic}</p>
          <ul>
            {command.approvedUrls.map((url) => (
              <li key={url}>{url}</li>
            ))}
          </ul>
          <small>Request {command.requestId}</small>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {view?.brief && (
        <div className="sr-brief">
          <h3>Your research brief</h3>
          {view.brief.research.topics.map((t, index) => (
            <article key={index}>
              <span className="sw-kicker">TOPIC {index + 1}</span>
              <h4>{t.title}</h4>
              <p>{t.summary}</p>
              <p>{t.relevance}</p>
              <ul>
                {t.sources.map((s, n) => (
                  <li key={n}>
                    {command?.approvedUrls.includes(s.url) ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.title}
                      </a>
                    ) : (
                      <span>{s.title} · source unavailable</span>
                    )}
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {view.brief.people.length > 0 && (
            <section aria-label="Public people mentioned">
              <h4>Public people mentioned</h4>
              {view.brief.people.map((p, i) => (
                <article key={i}>
                  <strong>{p.name}</strong>
                  <p>{p.relevance}</p>
                  <blockquote>{p.quote}</blockquote>
                  <p>{p.sourceUrl}</p>
                </article>
              ))}
              <p>Source mentions are not verified connections or introductions.</p>
            </section>
          )}
          {view.brief.research.limitations.map((s, i) => (
            <p className="sr-note" key={i}>
              {s}
            </p>
          ))}
          <p>Voice draft unavailable · approved voice examples are still needed.</p>
          {view.status === "ready" && (
            <>
              <p>
                Choose how to review this brief. These choices do not publish, contact people or
                create a post.
              </p>
              <div className="sr-actions">
                {(["use", "save", "skip"] as const).map((d) => (
                  <button
                    className="sv-button"
                    key={d}
                    disabled={busy}
                    onClick={() => void act(() => driver!.review(view.requestId, d))}
                  >
                    {d[0]!.toUpperCase() + d.slice(1)}
                  </button>
                ))}
                <button
                  className="sv-button"
                  disabled={busy}
                  aria-expanded={editing}
                  onClick={() => setEditing(!editing)}
                >
                  Edit
                </button>
              </div>
              {editing && (
                <div className="sr-form">
                  <label htmlFor={`${id}-edit`}>Your review edit · unsaved</label>
                  <textarea
                    id={`${id}-edit`}
                    maxLength={5000}
                    value={edit}
                    onChange={(e) => setEdit(e.target.value)}
                  />
                  <button
                    className="sv-button"
                    disabled={busy || !edit.trim()}
                    onClick={() =>
                      void act(() => driver!.review(view.requestId, "edit", edit.trim()))
                    }
                  >
                    Record edit
                  </button>
                </div>
              )}
            </>
          )}
          {view.status === "reviewed" && (
            <p role="note">
              {preview ? "Review choice recorded in this preview only." : "Review choice recorded."}{" "}
              Nothing was published, introduced or learned automatically.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
