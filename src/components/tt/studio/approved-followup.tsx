import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { studioAttemptAction } from "@/data/studio-attempt.functions";
import { attemptViewSchema, type AttemptView } from "@/domain/studio-attempt-wire";
import { STUDIO_APPROVED_FOLLOWUP as approved } from "@/domain/studio-approved-followup";
export function ApprovedFollowup({ organizationId }: { organizationId: string }) {
  const send = useServerFn(studioAttemptAction);
  const [view, setView] = useState<AttemptView>();
  const [busy, setBusy] = useState(false), [started, setStarted] = useState(false);
  const [message, setMessage] = useState("");
  if (organizationId !== approved.organizationId) return null;
  async function act(operation: "read" | "start") {
    setBusy(true);
    if (operation === "start") setStarted(true);
    try {
      const reply = await send({ data: { version: 2, operation, ...approved } });
      if (reply.status !== "ok") throw Error();
      const next = attemptViewSchema.parse(reply.view);
      if (next.attemptId !== approved.attemptId || next.requestId !== approved.requestId) throw Error();
      setView(next); setMessage(next.brief ? "Research result received in Studio. Review the brief below." : `Attempt status: ${next.status}. Studio receipt: ${next.callbackStatus ?? "pending"}.`);
    } catch { setMessage("Status is unconfirmed. Check this attempt’s status; do not start another attempt."); }
    finally { setBusy(false); }
  }
  return <section className="sr-note" aria-label="Approved follow-up research test">
    <h3>Approved follow-up research test</h3>
    <p>One separately tracked attempt for TRUA-103. The earlier uncertain attempt remains in history. Provider cost from that attempt is unknown.</p>
    <button className="sv-button" disabled={busy} onClick={() => void act("read")}>Check follow-up status</button>{" "}
    <button className="sv-button" disabled={busy || started || !view || view.status !== "approved" || view.callbackStatus !== "approved"} onClick={() => void act("start")}>Run approved follow-up once</button>
    <p role="status">{message}</p>
    {view && <p>Receipts: {view.receiptCount}. Child stop evidence: {view.stopEvidence}. Provider request count: unmetered.</p>}
    {view?.brief && <div>
      {view.brief.research.topics.map((topic, index) => <article key={index}><h4>{topic.title}</h4><p>{topic.summary}</p><p>{topic.relevance}</p>{topic.sources.map(source => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></p>)}</article>)}
      <h4>Limitations</h4><ul>{view.brief.research.limitations.map((text,index) => <li key={index}>{text}</li>)}</ul>
    </div>}
  </section>;
}
