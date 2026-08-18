/**
 * The approval queue, the Conductor's control surface.
 *
 * One list, one question per row: will you allow this? Each row says which
 * room owns it, what it will and will not do, what it rests on, and what would
 * show it worked. Approving is permission, never execution; routing hands the
 * work to the owning room and says so in those words.
 */

import { useState } from "react";

import { MetaPill, TTButton, TTCard } from "@/components/tt/primitives";
import type {
  ControlResponse,
  ControlledAction,
  ExecutionReceipt,
} from "@/domain/conductor-control";

export interface ApprovalDecisionInput {
  actionId: string;
  kind: "approve" | "hold" | "reject" | "withdraw";
  reason?: string;
}

export interface ApprovalQueueProps {
  control: ControlResponse;
  receipts: ExecutionReceipt[];
  /** False when this person may see the queue but not decide it. */
  canApprove: boolean;
  canExecute: boolean;
  deciding?: boolean;
  routing?: boolean;
  onDecide: (decisions: ApprovalDecisionInput[]) => void | Promise<void>;
  onRoute: (actionId: string) => void | Promise<void>;
  onRouteAll: () => void | Promise<void>;
}

const CONSEQUENCE_LABEL: Record<string, string> = {
  informational: "Opens a view",
  internal_preparation: "Prepares a draft",
  internal_change: "Changes internal state",
  external: "Leaves the building",
};

function Boundary({ action }: { action: ControlledAction }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <p className="text-xs uppercase tracking-wide text-[var(--tt-ink-muted)]">Will do</p>
        <ul className="mt-1 space-y-1 text-sm">
          {action.boundary.willDo.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-[var(--tt-ink-muted)]">Will not do</p>
        <ul className="mt-1 space-y-1 text-sm text-[var(--tt-ink-muted)]">
          {action.boundary.willNotDo.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ActionRow({
  action,
  canApprove,
  canExecute,
  routable,
  because,
  deciding,
  routing,
  onDecide,
  onRoute,
}: {
  action: ControlledAction;
  canApprove: boolean;
  canExecute: boolean;
  routable: boolean;
  because?: string;
  deciding?: boolean;
  routing?: boolean;
  onDecide: (decisions: ApprovalDecisionInput[]) => void | Promise<void>;
  onRoute: (actionId: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <li className="space-y-3 border-t border-[var(--tt-rule)] py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm">{action.intent}</p>
          <p className="text-sm text-[var(--tt-ink-muted)]">{action.whyItMatters}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <MetaPill>{action.owningApp}</MetaPill>
          <MetaPill>{CONSEQUENCE_LABEL[action.consequence] ?? action.consequence}</MetaPill>
          <MetaPill>{action.status}</MetaPill>
        </div>
      </div>

      <button
        type="button"
        className="text-xs text-[var(--tt-ink-muted)] underline underline-offset-4"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide the boundary" : "What exactly would happen?"}
      </button>

      {open ? (
        <div className="space-y-3">
          <Boundary action={action} />
          <p className="text-xs text-[var(--tt-ink-muted)]">
            Signal: {action.expectedSignal.statement} · Observed in{" "}
            {action.expectedSignal.observedIn} · Requires {action.requiredCapability}
          </p>
          {action.evidence.length > 0 ? (
            <ul className="space-y-1 text-xs text-[var(--tt-ink-muted)]">
              {action.evidence.map((ref, index) => (
                <li key={`${ref.label}-${index}`}>{ref.label}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {action.approval ? (
        <p className="text-xs text-[var(--tt-ink-muted)]">
          {action.approval.kind} by {action.approval.by.label}
          {action.approval.reason ? ` · ${action.approval.reason}` : ""}
        </p>
      ) : null}

      {because ? <p className="text-xs text-[var(--tt-ink-muted)]">{because}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        {action.status === "proposed" ? (
          <>
            <TTButton
              disabled={!canApprove || deciding}
              onClick={() => onDecide([{ actionId: action.id, kind: "approve" }])}
            >
              Approve
            </TTButton>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason (for hold or reject)"
              className="min-w-48 flex-1 border-b border-[var(--tt-rule)] bg-transparent py-1 text-sm outline-none"
            />
            <TTButton
              variant="quiet"
              disabled={!canApprove || deciding}
              onClick={() =>
                onDecide([
                  { actionId: action.id, kind: "hold", ...(reason.trim() ? { reason } : {}) },
                ])
              }
            >
              Hold
            </TTButton>
            <TTButton
              variant="quiet"
              disabled={!canApprove || deciding}
              onClick={() =>
                onDecide([
                  { actionId: action.id, kind: "reject", ...(reason.trim() ? { reason } : {}) },
                ])
              }
            >
              Reject
            </TTButton>
          </>
        ) : null}

        {action.status === "approved" ? (
          <>
            <TTButton
              disabled={!canExecute || !routable || routing}
              onClick={() => onRoute(action.id)}
            >
              Hand to {action.owningApp}
            </TTButton>
            <TTButton
              variant="quiet"
              disabled={!canApprove || deciding}
              onClick={() => onDecide([{ actionId: action.id, kind: "withdraw" }])}
            >
              Withdraw
            </TTButton>
          </>
        ) : null}

        {action.status === "held" ? (
          <TTButton
            variant="quiet"
            disabled={!canApprove || deciding}
            onClick={() => onDecide([{ actionId: action.id, kind: "approve" }])}
          >
            Release and approve
          </TTButton>
        ) : null}

        <a
          href={action.route}
          className="text-xs text-[var(--tt-ink-muted)] underline underline-offset-4"
        >
          {action.routeLabel}
        </a>
      </div>
    </li>
  );
}

export function ApprovalQueue({
  control,
  receipts,
  canApprove,
  canExecute,
  deciding,
  routing,
  onDecide,
  onRoute,
  onRouteAll,
}: ApprovalQueueProps) {
  const blockedBecause = new Map(
    [...control.blocked, ...control.notRoutable].map((row) => [row.action.id, row.because]),
  );
  const routableIds = new Set(control.approved.map((action) => action.id));
  const pending = control.readyToApprove;
  const receiptFor = new Map(receipts.map((receipt) => [receipt.actionId, receipt]));

  const nothing =
    pending.length === 0 &&
    control.approved.length === 0 &&
    control.routed.length === 0 &&
    control.held.length === 0 &&
    control.rejected.length === 0;

  return (
    <TTCard className="space-y-5 p-6">
      <div className="space-y-1">
        <h2 className="text-base">What needs your say-so</h2>
        <p className="text-sm text-[var(--tt-ink-muted)]">{control.statement}</p>
        {!canApprove ? (
          <p className="text-xs text-[var(--tt-ink-muted)]">
            Your role may read this queue but not decide it. Ask an owner, admin or lead.
          </p>
        ) : null}
      </div>

      {nothing ? (
        <p className="text-sm text-[var(--tt-ink-muted)]">
          Nothing is waiting on you. Ask a question and the Conductor will prepare work here.
        </p>
      ) : null}

      {pending.length > 0 || control.held.length > 0 || control.approved.length > 0 ? (
        <ul>
          {[...pending, ...control.approved, ...control.held].map((action) => (
            <ActionRow
              key={action.id}
              action={action}
              canApprove={canApprove}
              canExecute={canExecute}
              routable={routableIds.has(action.id) && !blockedBecause.has(action.id)}
              {...(blockedBecause.get(action.id)
                ? { because: blockedBecause.get(action.id)! }
                : {})}
              {...(deciding ? { deciding } : {})}
              {...(routing ? { routing } : {})}
              onDecide={onDecide}
              onRoute={onRoute}
            />
          ))}
        </ul>
      ) : null}

      {control.approved.length > 0 && canExecute ? (
        <TTButton disabled={routing} onClick={() => onRouteAll()}>
          Hand every approved action to its room
        </TTButton>
      ) : null}

      {control.routed.length > 0 ? (
        <div className="space-y-2 border-t border-[var(--tt-rule)] pt-4">
          <h3 className="text-sm">Handed over</h3>
          <ul className="space-y-2 text-sm text-[var(--tt-ink-muted)]">
            {control.routed.map((action) => {
              const receipt = receiptFor.get(action.id);
              return (
                <li key={action.id}>
                  {action.intent} → {action.owningApp}
                  {receipt ? ` · ${receipt.boundaryCrossed}` : ""}
                  {receipt?.result?.label ? ` · ${receipt.result.label}` : ""}
                  {action.routedAt ? ` · ${new Date(action.routedAt).toLocaleString()}` : ""}
                  {". "}
                  {action.owningApp} decides what happens next.
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {control.notRoutable.length > 0 ? (
        <div className="space-y-2 border-t border-[var(--tt-rule)] pt-4">
          <h3 className="text-sm">Approved, but no safe way in yet</h3>
          <ul className="space-y-1 text-sm text-[var(--tt-ink-muted)]">
            {control.notRoutable.map(({ action, because }) => (
              <li key={action.id}>
                {action.intent} · {because}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {control.rejected.length > 0 ? (
        <div className="space-y-2 border-t border-[var(--tt-rule)] pt-4">
          <h3 className="text-sm">Declined</h3>
          <ul className="space-y-1 text-sm text-[var(--tt-ink-muted)]">
            {control.rejected.map((action) => (
              <li key={action.id}>
                {action.intent}
                {action.approval?.reason ? ` · ${action.approval.reason}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </TTCard>
  );
}
