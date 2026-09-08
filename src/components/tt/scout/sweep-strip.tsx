/**
 * The quiet background check on the watchlist.
 *
 * A person can refresh in place, and can say how often Scout should do it on
 * its own. Deliberately small: this is a background check, not a monitoring
 * console. It reports counts, it never reports a percentage, a health score or
 * an urgency, and when nothing changed it says exactly that.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { TTButton } from "@/components/tt/primitives";
import { scoutService } from "@/data/supabase/scout-service";
import {
  DEFAULT_SWEEP_SETTINGS,
  SWEEP_BOUND_NOTE,
  planSweep,
  sweepCandidate,
  watchedCandidates,
  type SweepCadence,
  type SweepSummary,
} from "@/data/scout/sweep";
import type { ProspectCandidate } from "@/domain/scout";
import { cn } from "@/lib/utils";
import type { WorkspaceIdentity } from "@/lib/workspace";

function agoLabel(at: string): string {
  const ms = Date.now() - Date.parse(at);
  if (!Number.isFinite(ms)) return "recently";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "less than an hour ago";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function ScoutSweepStrip({
  candidates,
  identity,
}: {
  candidates: ProspectCandidate[];
  identity: WorkspaceIdentity;
}) {
  const queryClient = useQueryClient();
  const { organizationId, userId } = identity;
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<SweepSummary | null>(null);

  const state = useQuery({
    queryKey: ["scout", "sweep-state", organizationId],
    queryFn: () => scoutService.sweepState(organizationId),
  });
  const settings = state.data?.settings ?? DEFAULT_SWEEP_SETTINGS;
  const lastRun = state.data?.lastRun ?? null;

  const plan = planSweep({ candidates: watchedCandidates(candidates).map(sweepCandidate) });

  const saveSettings = useMutation({
    mutationFn: (next: { enabled: boolean; cadence: SweepCadence }) =>
      scoutService.saveSweepSettings(organizationId, next),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["scout", "sweep-state", organizationId] }),
  });

  const sweep = useMutation({
    mutationFn: () =>
      scoutService.sweepWatchlist(
        {
          candidates,
          onProgress: ({ name, index, total }) =>
            setProgress(`Reading ${name} (${index} of ${total})`),
        },
        { organizationId, userId },
      ),
    onSuccess: async (outcome) => {
      setProgress(null);
      setResult(outcome.summary);
      await queryClient.invalidateQueries({ queryKey: ["scout", "prospects", organizationId] });
      await queryClient.invalidateQueries({ queryKey: ["scout", "sweep-state", organizationId] });
    },
    onError: () => setProgress(null),
  });

  const error = sweep.error as Error | null;

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-foreground">Background check</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{SWEEP_BOUND_NOTE}</p>
        </div>
        <TTButton
          type="button"
          size="sm"
          variant="secondary"
          disabled={sweep.isPending}
          onClick={() => {
            setResult(null);
            sweep.mutate();
          }}
        >
          {sweep.isPending ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw aria-hidden className="size-3.5" />
          )}
          Check watched companies now
        </TTButton>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-muted-foreground">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            className="size-3.5 accent-royal"
            checked={settings.enabled}
            onChange={(event) =>
              saveSettings.mutate({ enabled: event.target.checked, cadence: settings.cadence })
            }
          />
          Check automatically
        </label>
        <label className="inline-flex items-center gap-2">
          <span className="sr-only">How often Scout checks on its own</span>
          <select
            value={settings.cadence}
            disabled={!settings.enabled}
            onChange={(event) =>
              saveSettings.mutate({
                enabled: settings.enabled,
                cadence: event.target.value as SweepCadence,
              })
            }
            className="rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
        <span>
          {plan.due.length > 0
            ? `${plan.due.length} due to be read${plan.deferred > 0 ? `, ${plan.deferred} waiting for the next run` : ""}`
            : "Nothing is due to be read"}
        </span>
        {lastRun ? (
          <span>
            Last checked {agoLabel(lastRun.at)} · {lastRun.read} read, {lastRun.changed} with new
            evidence
          </span>
        ) : (
          <span>Not checked yet</span>
        )}
      </div>

      {progress ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 inline-flex items-center gap-2 text-[13px] text-muted-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
        >
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
          {progress}
        </p>
      ) : null}

      {result ? (
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "mt-3 rounded-lg border px-3 py-2 text-[13px] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
            result.changed > 0
              ? "border-success/25 bg-success/8 text-success"
              : "border-border bg-secondary text-muted-foreground",
          )}
        >
          {result.quietLine} <span className="text-muted-foreground">{result.countsLine}</span>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          {error.message}
        </p>
      ) : null}
    </div>
  );
}
