/**
 * The governed step for one unanswered routed request.
 *
 * Pulse can only say "nobody has answered this". The Conductor says what that
 * means and offers the single bounded step this house is entitled to take:
 * withdrawing its own ask. Everything else about Ops and Studio stays theirs,
 * and is said plainly rather than left as an empty button.
 */

import { useState } from "react";

import { MetaPill, TTButton, TTCard } from "@/components/tt/primitives";
import { ROUTE_TARGET_LABEL } from "@/domain/project-routing";
import { routeStanding } from "@/domain/route-ledger";
import type { RouteLedgerEntry } from "@/domain/route-ledger";

export interface RoutedWorkStepProps {
  entry: RouteLedgerEntry;
  /** Why no step is available, when there is none. */
  gap?: string;
  /** The Ops-side gap, always shown: acceptance is never ours to record. */
  opsGap: string;
  canPropose: boolean;
  proposing: boolean;
  proposed: boolean;
  onPropose: (because: string) => void;
}

export function RoutedWorkStep({
  entry,
  gap,
  opsGap,
  canPropose,
  proposing,
  proposed,
  onPropose,
}: RoutedWorkStepProps) {
  const target = ROUTE_TARGET_LABEL[entry.targetApp];
  const [because, setBecause] = useState("");

  return (
    <TTCard className="space-y-4 p-5">
      <div className="space-y-2">
        <p className="tt-eyebrow">Routed work</p>
        <h3 className="text-lg font-medium text-foreground">
          {entry.projectName} asked {target} for: {entry.requestedOutcome}
        </h3>
        <p className="text-sm text-[var(--tt-ink-muted)]">{routeStanding(entry)}</p>
        <div className="flex flex-wrap gap-2">
          <MetaPill>{`${entry.ageDays} day${entry.ageDays === 1 ? "" : "s"} old`}</MetaPill>
          <MetaPill>{entry.status}</MetaPill>
          {entry.notification ? (
            <MetaPill>
              {entry.notification.delivered ? `${target} was told` : `${target} was not told`}
            </MetaPill>
          ) : null}
        </div>
      </div>

      <div className="space-y-2 rounded-xl bg-secondary/50 p-4">
        <p className="text-[13px] font-medium text-foreground">What cannot happen here</p>
        <p className="text-[13px] text-[var(--tt-ink-muted)]">{opsGap}</p>
      </div>

      {gap ? (
        <p className="text-sm text-[var(--tt-ink-muted)]">{gap}</p>
      ) : proposed ? (
        <p className="text-sm text-[var(--tt-ink-muted)]">
          The step is in the approval queue below. Nothing has been withdrawn yet — approving it is
          what hands it to Projects.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-foreground">
              Bounded next step: take the ask back
            </p>
            <ul className="space-y-1 text-[13px] text-[var(--tt-ink-muted)]">
              <li>Will do: record in Projects that this house is no longer waiting.</li>
              <li>Will not do: change anything in {target}, or tell anyone.</li>
            </ul>
          </div>
          <label className="block space-y-1">
            <span className="text-[13px] text-[var(--tt-ink-muted)]">Why is it being taken back?</span>
            <textarea
              value={because}
              onChange={(event) => setBecause(event.target.value)}
              rows={2}
              className="w-full rounded-xl border border-border bg-background p-3 text-sm text-foreground outline-none focus:border-primary"
              placeholder="We are handling this in-house instead."
            />
          </label>
          <TTButton
            onClick={() => onPropose(because)}
            disabled={!canPropose || proposing || because.trim().length === 0}
          >
            {proposing ? "Preparing" : "Propose this step"}
          </TTButton>
          {canPropose ? null : (
            <p className="text-[13px] text-[var(--tt-ink-muted)]">
              Your role can read Projects but not withdraw work it routed, so this step is not
              yours to propose.
            </p>
          )}
        </div>
      )}
    </TTCard>
  );
}
