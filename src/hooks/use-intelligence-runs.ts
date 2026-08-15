/**
 * Scheduling the Intelligence Engine.
 *
 * A read should be there when a person arrives, refresh itself when a room
 * records something, and renew once a day even in a quiet week. It should
 * never flicker, never re-reason for no reason, and never hide the fact that
 * it is working.
 *
 * The deterministic read lands first and stands on its own. The model stage is
 * only asked to connect evidence when the suite has actually moved.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { intelligenceService } from "@/data/intelligence/service";
import { reasonAboutBusiness } from "@/data/intelligence/reason-client";
import {
  ACTIVITY_POLL_MS,
  runSentence,
  shouldRun,
  withReasoning,
  type RunReason,
  type RunState,
} from "@/data/intelligence/engine";
import type { EngineRead } from "@/domain/intelligence-engine";
import type { ID } from "@/domain/entities";

export interface IntelligenceRun {
  read: EngineRead | undefined;
  trail: Awaited<ReturnType<typeof intelligenceService.run>>["trail"] | undefined;
  /** Why the read on screen exists, in a person's language. */
  because: string;
  reason: RunReason;
  loading: boolean;
  /** A refresh is happening behind a read that is already on screen. */
  refreshing: boolean;
  failed: boolean;
  /** Ask for a read now. Always runs, including the model stage. */
  refresh: () => Promise<void>;
  /** Call after a decision so the next read reflects what was learned. */
  invalidate: () => Promise<void>;
}

export function useIntelligenceRuns(organizationId: ID): IntelligenceRun {
  const queryClient = useQueryClient();
  const last = useRef<RunState | null>(null);
  const [reason, setReason] = useState<RunReason>("first_run");
  const [because, setBecause] = useState("Reading the business.");

  const query = useQuery({
    queryKey: ["intelligence-run", organizationId],
    queryFn: async () => {
      const now = new Date().toISOString();
      const run = await intelligenceService.run(organizationId);
      const decision = shouldRun({
        last: last.current,
        fingerprint: run.fingerprint,
        now,
      });

      /*
       * Nothing moved: keep the read that is already on screen rather than
       * asking the model to say the same thing in different words.
       */
      const previous = queryClient.getQueryData<{ read: EngineRead }>([
        "intelligence-run",
        organizationId,
      ]);
      if (!decision.run && previous?.read) {
        setReason(decision.reason);
        setBecause(runSentence(decision.reason, last.current?.at ?? now));
        return { ...previous, trail: run.trail };
      }

      let read = run.read;
      try {
        const reasoned = await reasonAboutBusiness({
          organizationId,
          packet: run.packet,
          observations: read.observations,
          now: read.generatedAt,
        });
        if (reasoned.hypotheses.length > 0) read = withReasoning(read, reasoned.hypotheses);
      } catch {
        /* The deterministic read stands alone and says so on the surface. */
      }

      last.current = { fingerprint: run.fingerprint, at: now };
      setReason(decision.reason);
      setBecause(runSentence(decision.reason, now));
      return { read, trail: run.trail };
    },
    refetchInterval: ACTIVITY_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  /* A read is stale the moment the working day turns over. */
  useEffect(() => {
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["intelligence-run", organizationId] });
    }, ACTIVITY_POLL_MS * 5);
    return () => window.clearInterval(timer);
  }, [organizationId, queryClient]);

  const refresh = useCallback(async () => {
    last.current = null;
    setReason("requested");
    await queryClient.invalidateQueries({ queryKey: ["intelligence-run", organizationId] });
  }, [organizationId, queryClient]);

  const invalidate = useCallback(async () => {
    /* A decision is new evidence: force the next read to take it into account. */
    last.current = null;
    await queryClient.invalidateQueries({ queryKey: ["intelligence-run", organizationId] });
  }, [organizationId, queryClient]);

  return {
    read: query.data?.read,
    trail: query.data?.trail,
    because,
    reason,
    loading: query.isLoading,
    refreshing: query.isFetching && !query.isLoading,
    failed: query.isError,
    refresh,
    invalidate,
  };
}
