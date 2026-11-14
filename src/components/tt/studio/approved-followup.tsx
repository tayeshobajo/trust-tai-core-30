import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { studioAttemptAction, studioCurrentAttemptRead } from "@/data/studio-attempt.functions";
import { attemptViewSchema, type AttemptView } from "@/domain/studio-attempt-wire";
import { STUDIO_APPROVED_FOLLOWUP as approved } from "@/domain/studio-approved-followup";
export function ApprovedFollowup({ organizationId }: { organizationId: string }) {
  const send = useServerFn(studioAttemptAction);
  const readCurrent = useServerFn(studioCurrentAttemptRead);
  const [view, setView] = useState<AttemptView>();
  const [busy, setBusy] = useState(false),
    [started, setStarted] = useState(false);
  const [message, setMessage] = useState("");
  const [launchDeadline, setLaunchDeadline] = useState<number>();
  const [eligibilityExpired, setEligibilityExpired] = useState(false);
  const inFlight = useRef(false),
    startAttempted = useRef(false);

  useEffect(() => {
    if (launchDeadline === undefined) return;
    let timer: ReturnType<typeof setTimeout>;
    const expire = () => {
      const remaining = launchDeadline - performance.now();
      if (remaining <= 0) {
        setLaunchDeadline(undefined);
        setEligibilityExpired(true);
      } else timer = setTimeout(expire, Math.ceil(remaining));
    };
    // Hidden/suspended pages must obtain a new server observation before launching.
    const hide = () => {
      if (document.visibilityState !== "visible") setLaunchDeadline(undefined);
    };
    expire();
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [launchDeadline]);

  if (organizationId !== approved.organizationId) return null;
  const canStart =
    !busy &&
    !started &&
    launchDeadline !== undefined &&
    performance.now() < launchDeadline &&
    view?.launchEligibility?.eligible === true &&
    view.status === "approved" &&
    view.callbackStatus === "approved";
  async function act(operation: "read" | "start") {
    if (inFlight.current) return;
    // Recheck elapsed time in the click handler; background timer delivery can be delayed.
    if (
      operation === "start" &&
      (!canStart ||
        startAttempted.current ||
        launchDeadline === undefined ||
        performance.now() >= launchDeadline)
    ) {
      if (launchDeadline !== undefined && performance.now() >= launchDeadline) {
        setLaunchDeadline(undefined);
        setEligibilityExpired(true);
      }
      return;
    }
    inFlight.current = true;
    const startAttemptId = operation === "start" ? view?.attemptId : undefined;
    setBusy(true);
    setLaunchDeadline(undefined);
    setEligibilityExpired(false);
    if (operation === "start") {
      startAttempted.current = true;
      setStarted(true);
    }
    const requestStarted = performance.now();
    try {
      const reply =
        operation === "read"
          ? await readCurrent({
              data: { organizationId: approved.organizationId, requestId: approved.requestId },
            })
          : await send({
              data: {
                version: 2,
                operation: "start",
                organizationId: approved.organizationId,
                requestId: approved.requestId,
                attemptId: startAttemptId!,
              },
            });
      if (reply.status !== "ok") {
        if (operation === "read") setView(undefined);
        setMessage(
          `Status is unconfirmed (${reply.diagnostic}). Check this attempt’s status; do not start another attempt.`,
        );
        return;
      }
      const next = attemptViewSchema.parse(reply.view);
      if (
        next.requestId !== approved.requestId ||
        (operation === "start" && next.attemptId !== startAttemptId)
      )
        throw Error();
      const receivedAt = performance.now();
      // Subtract the entire round trip conservatively. Browser wall-clock changes never extend this TTL.
      const remaining =
        (next.launchEligibility?.ttlMs ?? 0) - Math.max(0, receivedAt - requestStarted);
      if (
        operation === "read" &&
        next.launchEligibility?.eligible &&
        next.status === "approved" &&
        next.callbackStatus === "approved" &&
        !startAttempted.current
      ) {
        if (remaining > 0 && document.visibilityState === "visible")
          setLaunchDeadline(receivedAt + remaining);
        else if (remaining <= 0) setEligibilityExpired(true);
      }
      setView(next);
      setMessage(
        next.brief
          ? "Research result received in Studio. Review the brief below."
          : `Attempt status: ${next.status}. Studio receipt: ${next.callbackStatus ?? "pending"}.`,
      );
    } catch {
      if (operation === "read") setView(undefined);
      setMessage(
        "Status is unconfirmed. Check this attempt’s status; do not start another attempt.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const eligibilityMessage =
    eligibilityExpired || view?.launchEligibility?.reason === "expired"
      ? "Approval has expired. This attempt cannot be started."
      : view?.launchEligibility?.reason === "not_yet_valid"
        ? "Approval is not active yet. Check status before starting."
        : view?.launchEligibility?.reason === "access_denied"
          ? "Your current access does not allow starting this attempt."
          : view?.launchEligibility?.reason === "attempt_not_untouched" || started
            ? "This attempt cannot be started again."
            : canStart
              ? "Approval is current. Launch remains subject to a fresh server check."
              : "Launch eligibility is unconfirmed. Check follow-up status before starting.";
  return (
    <section className="sr-note" aria-label="Approved follow-up research test">
      <h3>Approved follow-up research test</h3>
      <p>
        One separately tracked attempt for TRUA-103. The earlier uncertain attempt remains in
        history. Provider cost from that attempt is unknown.
      </p>
      <button className="sv-button" disabled={busy} onClick={() => void act("read")}>
        Check follow-up status
      </button>{" "}
      <button className="sv-button" disabled={!canStart} onClick={() => void act("start")}>
        Run approved follow-up once
      </button>
      <p role="status">
        {message} {eligibilityMessage}
      </p>
      {view && (
        <p>
          Receipts: {view.receiptCount}. Child stop evidence: {view.stopEvidence}. Provider request
          count: unmetered.
        </p>
      )}
      {view?.brief && (
        <div>
          {view.brief.research.topics.map((topic, index) => (
            <article key={index}>
              <h4>{topic.title}</h4>
              <p>{topic.summary}</p>
              <p>{topic.relevance}</p>
              {topic.sources.map((source) => (
                <p key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.title}
                  </a>
                </p>
              ))}
            </article>
          ))}
          <h4>Limitations</h4>
          <ul>
            {view.brief.research.limitations.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
