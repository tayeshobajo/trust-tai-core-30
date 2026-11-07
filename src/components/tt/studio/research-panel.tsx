import { ConnectedManualResearch } from "./connected-manual-research";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  checkStudioResearch,
  listStudioResearch,
  runStudioResearch,
} from "@/data/studio-research.functions";
import type { ResearchRequest } from "@/domain/studio-research";

export function ResearchPanel({ organizationId }: { organizationId: string }) {
  const check = useServerFn(checkStudioResearch),
    list = useServerFn(listStudioResearch),
    run = useServerFn(runStudioResearch);
  const [topic, setTopic] = useState("");
  const [request, setRequest] = useState<ResearchRequest | null>(null);
  const [connection, setConnection] = useState<Awaited<ReturnType<typeof check>> | null>(null);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof list>> | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof run>> | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch {
      setError(
        "The request could not be confirmed. Your request ID is retained; check its result before starting another.",
      );
    } finally {
      setBusy(false);
    }
  }
  const ready =
    connection?.status === "verified" &&
    connection.dispatchEnabled &&
    ["active", "idle", "running"].includes(connection.agentStatus);
  async function submit(operation: "start" | "read", saved?: ResearchRequest) {
    const target = saved ??
      request ?? { organizationId, requestId: crypto.randomUUID(), topic: topic.trim() };
    setRequest(target);
    await action(async () => {
      setResult(await run({ data: { operation, request: target } }));
      setHistory(await list({ data: { organizationId } }));
    });
  }
  return (
    <>
      <ConnectedManualResearch organizationId={organizationId} />
      <section
        className="sv-card"
        aria-labelledby="studio-research-heading"
        style={{ padding: 24, marginBottom: 24 }}
      >
        <h2 id="studio-research-heading">Research a topic</h2>
        <p>
          Send only the topic you enter and a request ID to Studio Research. Results are for your
          review; nothing is published, added to Sources, or learned automatically.
        </p>
        <button
          className="sv-button"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              setConnection(await check({ data: { organizationId } }));
              setHistory(await list({ data: { organizationId } }));
            })
          }
        >
          Check research connection
        </button>
        {connection && (
          <p role="status">
            {connection.status === "verified"
              ? `Scoped connection verified. Agent: ${connection.agentStatus}. ${connection.dispatchEnabled ? "Manual dispatch enabled." : "Manual dispatch is not enabled."}`
              : `Research connection is unavailable. No task was started. Check: ${"diagnostic" in connection ? connection.diagnostic : connection.status}.`}
          </p>
        )}
        <label htmlFor="research-topic">Public research topic</label>
        <textarea
          id="research-topic"
          maxLength={1200}
          value={request?.topic ?? topic}
          disabled={busy || !!request}
          onChange={(e) => setTopic(e.target.value)}
          style={{ display: "block", width: "100%", minHeight: 100, marginBlock: 12 }}
        />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            className="sv-button sv-button-primary"
            disabled={busy || !ready || !!request || topic.trim().length < 3}
            onClick={() => void submit("start")}
          >
            Start research
          </button>
          {request && (
            <button className="sv-button" disabled={busy} onClick={() => void submit("read")}>
              Check result
            </button>
          )}
          {request && (
            <button
              className="sv-button"
              disabled={busy}
              onClick={() => {
                setRequest(null);
                setResult(null);
                setTopic("");
              }}
            >
              New topic
            </button>
          )}
        </div>
        {request && (
          <p style={{ overflowWrap: "anywhere" }}>
            Request: {request.requestId}. Rechecking never starts another task.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {result && result.status !== "review_ready" && (
          <p role="status">
            {result.status === "blocked"
              ? `Research blocked: ${result.reason.replaceAll("_", " ")}.`
              : result.status === "dispatch_uncertain"
                ? "Dispatch is uncertain. Do not repeat this topic; the saved request needs reconciliation."
                : `Research: ${result.status.replaceAll("_", " ")}.`}
          </p>
        )}
        {result?.status === "review_ready" && (
          <div>
            <h3>Research for review</h3>
            {result.result.topics.map((t, i) => (
              <article key={i}>
                <h4>{t.title}</h4>
                <p>{t.summary}</p>
                <p>{t.relevance}</p>
                <ul>
                  {t.sources.map((s, j) => (
                    <li key={j}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.title}
                      </a>{" "}
                      · Published: {s.publishedAt ?? "unknown"} · Retrieved: {s.retrievedAt}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
            {result.result.limitations.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        )}
        {history?.status === "unavailable" && (
          <p role="status">
            Saved research requests could not be read. Storage or access may not be configured.
            Check: {history.diagnostic}.
          </p>
        )}
        {history?.status === "ready" && history.runs.length > 0 && (
          <details>
            <summary>Recent research requests</summary>
            <ul>
              {history.runs.map((r) => (
                <li key={r.id}>
                  <button disabled={busy} onClick={() => void submit("read", r.request)}>
                    {r.request.topic} · {r.state.replaceAll("_", " ")}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </>
  );
}
