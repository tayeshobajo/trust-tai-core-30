/**
 * The workspace: one shell, every approval type.
 *
 * Header, context, the type-specific middle, the boundary, the decision bar and
 * the trail. The shell reads only universal fields; the middle is delegated to
 * the registered renderer. That separation is the reason a comms draft and a
 * fifty-post content batch feel like the same room.
 */

import { useMemo, useState } from "react";

import { MetaPill, TTButton } from "@/components/tt/primitives";
import { rendererFor } from "@/components/tt/approvals/renderers";
import { downstreamAdapter } from "@/data/approvals/downstream";
import {
  APPROVAL_TYPE_LABEL,
  IMPACT_LABEL,
  SOURCE_APP_LABEL,
  STATUS_LABEL,
  STATUS_MEANING,
  URGENCY_LABEL,
  availableActions,
  readyItemIds,
  type ApprovalAction,
  type ApprovalEvent,
  type ApprovalItem,
  type ApprovalRequest,
} from "@/domain/approvals";

export interface DecisionInput {
  action: ApprovalAction;
  reason: string;
  itemIds: string[];
}

export function ApprovalWorkspace({
  request,
  items,
  events,
  refusal,
  pending,
  onDecide,
  onNote,
}: {
  request: ApprovalRequest;
  items: ApprovalItem[];
  events: ApprovalEvent[];
  /** Non-null when this person may not decide. The bar stays visible, and closed. */
  refusal: string | null;
  pending: boolean;
  onDecide: (input: DecisionInput) => void;
  onNote: (body: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(readyItemIds(items)));
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const Renderer = rendererFor(request.approvalType);
  const adapter = downstreamAdapter(request.approvalType);
  const actions = useMemo(
    () =>
      availableActions({
        approvalType: request.approvalType,
        status: request.status,
        ...(request.batch ? { batch: request.batch } : {}),
      }),
    [request.approvalType, request.status, request.batch],
  );

  function toggle(itemId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  const authorising = actions.filter((action) => action.authorising);
  const supporting = actions.filter((action) => !action.authorising);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-5">
        <p className="tt-eyebrow">
          {SOURCE_APP_LABEL[request.sourceApp]} · {APPROVAL_TYPE_LABEL[request.approvalType]}
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
          {request.title}
        </h2>
        <p className="mt-2 max-w-reading text-sm text-muted-foreground">{request.summary}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <MetaPill>{STATUS_LABEL[request.status]}</MetaPill>
          <MetaPill>{URGENCY_LABEL[request.urgency]}</MetaPill>
          <MetaPill>{IMPACT_LABEL[request.impact]}</MetaPill>
          {request.revision > 1 ? <MetaPill>Revision {request.revision}</MetaPill> : null}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{STATUS_MEANING[request.status]}</p>
      </header>

      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
        <section className="tt-level-secondary rounded-xl p-4">
          <p className="tt-eyebrow mb-2">Why this needs you</p>
          <p className="max-w-reading text-sm text-foreground">{request.whyItNeedsYou}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Prepared by {request.submittedBy.label}.
          </p>
        </section>

        <Renderer request={request} items={items} selected={selected} onToggle={toggle} />

        <section className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="tt-eyebrow mb-2">If you approve</p>
            <ul className="space-y-1.5 text-sm text-foreground">
              {request.boundary.willDo.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">{adapter.describe(request)}</p>
          </div>
          <div>
            <p className="tt-eyebrow mb-2">Trust Tai will not</p>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {request.boundary.willNotDo.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </section>

        {request.downstream ? (
          <section className="tt-level-secondary rounded-xl p-4">
            <p className="tt-eyebrow mb-2">After the decision</p>
            <p className="text-sm text-muted-foreground">{request.downstream.because}</p>
          </section>
        ) : null}

        <section>
          <p className="tt-eyebrow mb-3">Trail</p>
          <ol className="space-y-3">
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
            ) : (
              events.map((event) => (
                <li key={event.id} className="border-l border-border pl-3">
                  <p className="text-sm text-foreground">{event.body}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {event.actor.label} · {new Date(event.createdAt).toLocaleString()}
                  </p>
                </li>
              ))
            )}
          </ol>

          <div className="mt-4 flex gap-2">
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add a note for the record"
              className="tt-level-secondary min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
            />
            <TTButton
              variant="secondary"
              disabled={!note.trim()}
              onClick={() => {
                onNote(note.trim());
                setNote("");
              }}
            >
              Add note
            </TTButton>
          </div>
        </section>
      </div>

      <footer className="border-t border-border bg-card/80 px-6 py-4 backdrop-blur">
        {refusal ? (
          <p className="mb-3 text-sm text-muted-foreground">{refusal}</p>
        ) : (
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason (required to reject or request a revision)"
            className="tt-level-secondary mb-3 w-full rounded-lg px-3 py-2 text-sm outline-none"
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          {authorising.map((action) => (
            <TTButton
              key={action.id}
              variant={action.tone === "primary" ? "primary" : "secondary"}
              disabled={
                Boolean(refusal) ||
                pending ||
                (action.id === "approve_ready" && selected.size === 0) ||
                (action.id === "reject" && !reason.trim())
              }
              onClick={() =>
                onDecide({ action, reason: reason.trim(), itemIds: Array.from(selected) })
              }
            >
              {action.id === "approve_ready"
                ? `Approve ${selected.size} of ${items.length}`
                : action.label}
            </TTButton>
          ))}

          {supporting.map((action) => (
            <TTButton
              key={action.id}
              variant="quiet"
              disabled={
                pending ||
                (action.id === "request_revision" && (Boolean(refusal) || !reason.trim()))
              }
              onClick={() =>
                onDecide({ action, reason: reason.trim(), itemIds: Array.from(selected) })
              }
            >
              {action.label}
            </TTButton>
          ))}
        </div>
      </footer>
    </div>
  );
}
