import { useEffect, useState } from "react";
import type {
  ReviewAction,
  ReviewReceipt,
  ReviewScope,
  CorrespondenceImportAction,
  CorrespondenceImportReceipt,
} from "@/domain/roadmap-correspondence-review";
/** Local review surface. No navigation entry until the schema and publication are approved. */
export function CorrespondenceReview({
  scope,
  action,
  importAction,
}: {
  scope: ReviewScope;
  action: ReviewAction;
  importAction?: CorrespondenceImportAction;
}) {
  const key = JSON.stringify(scope);
  const [state, setState] = useState<{
    key: string;
    receipt?: ReviewReceipt;
    error?: boolean;
    busy?: boolean;
    imported?: CorrespondenceImportReceipt;
    importUncertain?: boolean;
  }>({ key, busy: true });
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    let active = true;
    setAcknowledged(false);
    setState({ key, busy: true });
    action(JSON.parse(key) as ReviewScope).then(
      (receipt) => {
        if (active) setState({ key, receipt });
      },
      () => {
        if (active) setState({ key, error: true });
      },
    );
    return () => {
      active = false;
    };
  }, [key, action]);
  const receipt = state.key === key ? state.receipt : undefined;
  if (!receipt)
    return (
      <section aria-label="Correspondence approval">
        {state.importUncertain ? (
          <p role="alert">
            Import outcome is not confirmed. Private text cleared. Check the saved batch receipt
            before reopening this review or retrying.
          </p>
        ) : state.error ? (
          <p role="alert">
            Review unavailable. Private text cleared. Reopen the review before confirming.
          </p>
        ) : (
          <p role="status">Loading the exact approval scope…</p>
        )}
      </section>
    );
  const confirm = async () => {
    setState({ key, receipt, busy: true });
    try {
      const approved = await action(scope, true);
      setAcknowledged(false);
      setState({ key, receipt: approved });
    } catch {
      setAcknowledged(false);
      setState({ key, error: true });
    }
  };
  const importApproved = async () => {
    if (!importAction || !receipt.approvedAt || !acknowledged || state.busy) return;
    setState({ key, receipt, busy: true });
    try {
      const imported = await importAction(scope);
      if (imported.inserted + imported.duplicates !== receipt.envelope.selections.length)
        throw new Error("Import count needs verification");
      setState({ key, receipt, imported });
    } catch {
      setAcknowledged(false);
      setState({ key, importUncertain: true });
    }
  };
  return (
    <section aria-label="Correspondence approval">
      <h2>Review roadmap correspondence</h2>
      <p>
        {receipt.envelope.selections.length} messages · authorized Roadmaps team, including future
        members · expires {receipt.envelope.expiresAt}
      </p>
      <p>
        Approval authorizes this exact selection for later operator staging. It does not send
        outreach.
      </p>
      <details>
        <summary>Current audience snapshot</summary>
        <ul>
          {receipt.envelope.audience.map((id) => (
            <li key={id}>{id}</li>
          ))}
        </ul>
      </details>
      {receipt.envelope.selections.map(({ event }, i) => (
        <article key={i}>
          <h3>
            {event.channel} · {event.kind} · {event.subject}
          </h3>
          <p>
            {event.occurredAt} ({event.timestampPrecision}) · {event.bodyRepresentation}
          </p>
          <p>
            Roadmap {event.roadmapId} · relationship {event.relationshipId}
          </p>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{event.bodyText}</pre>
          <p>
            Review source: {event.review.sourceRef}. Unrelated content, quoted history, secrets and
            attachments excluded by the recorded review.
          </p>
          <a
            href={event.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            Open original source
          </a>
        </article>
      ))}
      <p>
        Approval fingerprint: <code>{receipt.digest}</code>
      </p>
      {receipt.approvedAt ? (
        <>
          <p role="status">
            Approved by {receipt.approvedBy} at {receipt.approvedAt}. Operator staging and import
            are separate steps.
          </p>
          {state.imported ? (
            <p role="status">
              Import receipt: {state.imported.inserted} added · {state.imported.duplicates} already
              present · batch {state.imported.batchId}. No outreach sent.
            </p>
          ) : importAction ? (
            <>
              <p>Complete operator staging first. This imports approved history into CMD only.</p>
              <label>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={state.busy}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                Import this exact approved scope for authorized Roadmaps team members.
              </label>
              <button disabled={!acknowledged || state.busy} onClick={() => void importApproved()}>
                Import approved correspondence
              </button>
            </>
          ) : null}
        </>
      ) : (
        <>
          <label>
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={state.busy}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            I reviewed these exact messages, exclusions and identities, and authorize current and
            future team members with Roadmaps access to read them.
          </label>
          <button disabled={!acknowledged || state.busy} onClick={() => void confirm()}>
            Approve exact correspondence scope
          </button>
        </>
      )}
    </section>
  );
}
