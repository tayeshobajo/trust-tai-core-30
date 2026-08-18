/**
 * Manual Fathom refresh.
 *
 * Steward reads calls when a person asks it to. This control re-checks the
 * connected source and re-reads the workspace's own rows, then says plainly
 * whether that worked, when the last call was stored, and what to do if it
 * failed. It never claims a sync that did not happen.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, RefreshCw } from "lucide-react";
import { useState } from "react";

import { TTButton } from "@/components/tt/primitives";
import { readSourceState } from "@/data/steward/ingest";

function stamp(at: string | null): string {
  if (!at) return "never";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "never";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function FathomSyncControl({
  organizationId,
  /** When Steward last stored a Fathom call, from the workspace's own rows. */
  lastSyncedAt,
  /** Query keys to re-read once the source has been checked. */
  refreshKeys,
}: {
  organizationId: string;
  lastSyncedAt: string | null;
  refreshKeys: readonly (readonly unknown[])[];
}) {
  const queryClient = useQueryClient();
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const source = useQuery({
    queryKey: ["steward", "source", organizationId],
    queryFn: () => readSourceState(organizationId),
    staleTime: 60_000,
  });

  const refresh = useMutation({
    mutationFn: async () => {
      const state = await source.refetch({ throwOnError: true });
      await Promise.all(
        refreshKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      return state.data;
    },
    onSuccess: () => setCheckedAt(new Date().toISOString()),
  });

  const failure =
    refresh.error instanceof Error
      ? refresh.error.message
      : source.error instanceof Error
        ? source.error.message
        : null;
  const connected = source.data?.status.configured === true;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <TTButton
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => refresh.mutate()}
        disabled={refresh.isPending}
      >
        <RefreshCw
          aria-hidden
          className={refresh.isPending ? "size-3.5 animate-spin" : "size-3.5"}
        />
        {refresh.isPending ? "Checking Fathom…" : failure ? "Try again" : "Refresh Fathom sync"}
      </TTButton>

      <p
        aria-live="polite"
        className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground"
      >
        {refresh.isPending ? (
          "Re-checking the connected recording source."
        ) : failure ? (
          <>
            <AlertTriangle aria-hidden className="size-3.5 text-destructive" />
            <span className="text-destructive">Not refreshed. {failure}</span>
          </>
        ) : (
          <>
            {checkedAt ? <Check aria-hidden className="size-3.5 text-success" /> : null}
            <span>
              {checkedAt ? `Checked ${stamp(checkedAt)}. ` : ""}
              {connected ? "Fathom connected" : "Fathom not connected"} · last call stored{" "}
              {stamp(lastSyncedAt)}
            </span>
          </>
        )}
      </p>
    </div>
  );
}
