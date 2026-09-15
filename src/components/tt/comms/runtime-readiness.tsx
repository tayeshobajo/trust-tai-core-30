/**
 * The three facts Connections must never blur together.
 *
 *  1. the mailbox: connected, syncing, or failing,
 *  2. the reviewing model: configured, and whether a review has ever actually
 *     completed in this workspace,
 *  3. whether a particular draft may be sent: decided per draft, at approval,
 *     and deliberately not summarised here.
 *
 * Nothing on this screen performs a send, and nothing here shows a credential.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { MetaPill, TTButton, TTCard } from "@/components/tt/primitives";
import { aiRuntimeAvailability, reviewRunHealth } from "@/data/supabase/comms-runtime-health";

export function RuntimeReadiness({ organizationId }: { organizationId: string }) {
  const availability = useQuery({
    queryKey: ["comms", "ai-runtime"],
    queryFn: aiRuntimeAvailability,
  });
  const health = useQuery({
    queryKey: ["comms", "review-run-health", organizationId],
    queryFn: () => reviewRunHealth(organizationId),
  });

  const configured = availability.data?.configured === true;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TTCard className="comms-card space-y-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-medium text-foreground">Reviewing model</h3>
          <MetaPill>
            {availability.isLoading
              ? "Asking"
              : availability.isError
                ? "Unknown"
                : configured
                  ? "Configured"
                  : "Not configured"}
          </MetaPill>
        </div>

        {availability.isError ? (
          <p className="text-sm text-destructive">
            {(availability.error as Error).message}{" "}
            <button type="button" className="underline" onClick={() => void availability.refetch()}>
              Try again
            </button>
          </p>
        ) : availability.isLoading ? (
          <p className="text-sm text-muted-foreground">Reading runtime configuration…</p>
        ) : configured ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            A model is configured for review
            {availability.data?.model ? ` (${availability.data.model})` : ""}. Configuration alone
            does not mean a review will succeed; what happened is below.
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            No reviewing model is configured for this deployment, so asking for a review will fail.
            Needs: a provider key set on the deployment. No key is ever shown here.
          </p>
        )}

        <div className="rounded-lg border border-border/60 p-3">
          <p className="tt-eyebrow">What actually happened here</p>
          {health.isError ? (
            <p className="mt-2 text-sm text-destructive">
              {(health.error as Error).message}{" "}
              <button type="button" className="underline" onClick={() => void health.refetch()}>
                Try again
              </button>
            </p>
          ) : health.isLoading ? (
            <p className="mt-2 text-sm text-muted-foreground">Reading review records…</p>
          ) : health.data ? (
            <div className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              {/* Each fact is read on its own, so one failed read never
                  becomes a claim about the others. */}
              <p>
                {health.data.total === null
                  ? `How many reviews have run here could not be read. ${health.data.totalError ?? ""}`
                  : health.data.total === 0
                    ? "No review has ever been run in this workspace."
                    : `${health.data.total} review${health.data.total === 1 ? "" : "s"} recorded here, all time.`}
              </p>
              <p>
                {health.data.everSucceeded === null
                  ? `Whether any review ever completed could not be read. ${health.data.successError ?? ""} It is not assumed either way.`
                  : health.data.everSucceeded
                    ? "At least one review has completed."
                    : "No review has ever completed — checked across every run, not just the recent ones."}
              </p>
              <p>
                {health.data.lastError
                  ? `The most recent attempt could not be read. ${health.data.lastError}`
                  : health.data.lastStatus
                    ? `Last attempt ${health.data.lastStatus}${
                        health.data.lastErrorCode ? ` (${health.data.lastErrorCode})` : ""
                      }${health.data.lastAt ? ` on ${new Date(health.data.lastAt).toLocaleString()}` : ""}.`
                    : "No attempt on record."}
              </p>
              {health.data.everSucceeded === false ? (
                <p>Nothing here has been proven to work.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </TTCard>

       <TTCard className="comms-card space-y-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-medium text-foreground">Whether a message may be sent</h3>
          <MetaPill>Per draft</MetaPill>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This is never a workspace-wide state, so it is not claimed as one. Each draft is judged on
          its own: a completed review of the exact words, no standing must-fix, and an owner or
          admin approval that still matches the current version. A connected mailbox does not make a
          draft sendable, and a configured model does not approve anything.
        </p>
        <TTButton asChild size="sm" variant="secondary">
          <Link to="/modules/comms/drafts">Open Drafts &amp; Reviews</Link>
        </TTButton>
      </TTCard>
    </div>
  );
}
