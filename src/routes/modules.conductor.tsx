/**
 * The Conductor — the command layer over the whole factory.
 *
 * Not a peer business room: it owns no entity and writes no room's truth. It
 * reads Scout, Comms, Roadmap, Projects, Ops, Studio, the shared activity
 * stream, Steward and Pulse, answers in plain language, and hands every piece
 * of consequential work back to the room and the person who own it.
 */

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { ApprovalQueue } from "@/components/tt/conductor/approval-queue";
import { ConductorConsole } from "@/components/tt/conductor/conductor-console";
import { FiguresPanel } from "@/components/tt/conductor/figures-panel";
import { SchemaStatus } from "@/components/tt/conductor/schema-status";
import { checkConductorSchema, checkControlSchema } from "@/data/supabase/conductor-schema";
import type { CorrectionDraft } from "@/components/tt/conductor/correct-answer";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { answerQuestion } from "@/data/intelligence/conductor";
import { buildControlledActions } from "@/data/intelligence/conductor/control";
import {
  approveEverything,
  decide,
  describeControl,
  publishProposedActions,
  routeAction,
  routeApproved,
} from "@/data/conductor/orchestrator";
import { loadSuiteSnapshot } from "@/data/intelligence/service";
import {
  loadControlledActions,
  loadReceipts,
} from "@/data/supabase/conductor-control-service";
import {
  loadBusinessFigures,
  loadBusinessIntents,
  loadCorrections,
  recordCorrection,
  recordFigure,
} from "@/data/supabase/conductor-service";
import { accessContext, can } from "@/domain/access";
import type { ConductorAnswer } from "@/domain/conductor";
import type { WorkspaceIdentity } from "@/lib/workspace";


const TITLE = "Ask Trust Tai — the Conductor — Trust Tai OS";
const DESCRIPTION =
  "Ask the Trust Tai factory a question and get a grounded answer: vital signs, upstream causes, what is missing, and bounded next steps that only you can authorise.";

export const Route = createFileRoute("/modules/conductor")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConductorRoute,
});

function ConductorRoute() {
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <Conductor identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function Conductor({ identity }: { identity: WorkspaceIdentity }) {
  const [answer, setAnswer] = useState<ConductorAnswer | undefined>(undefined);
  const [lastQuestion, setLastQuestion] = useState("");
  const queryClient = useQueryClient();

  /*
   * Decided truth — outcomes, hand-recorded figures, and corrections — is
   * loaded up front, because it changes what the very first answer is allowed
   * to say. Everything else is read at the moment a question is asked.
   */
  const ledger = useQuery({
    queryKey: ["conductor-ledger", identity.organizationId],
    queryFn: async () => {
      const [intents, figures, corrections] = await Promise.all([
        loadBusinessIntents(identity.organizationId),
        loadBusinessFigures(identity.organizationId),
        loadCorrections(identity.organizationId),
      ]);
      return { intents, figures, corrections };
    },
  });

  /*
   * Before anything is written, the ledger is asked whether it exists at all.
   * A missing migration is a named condition here, not a silent failed save.
   */
  const schema = useQuery({
    queryKey: ["conductor-schema", identity.organizationId],
    queryFn: () => checkConductorSchema(identity.organizationId),
    staleTime: 60_000,
  });

  /* The V2 control ledger is checked separately: without it the Conductor
   * still reasons, but nothing may be approved or handed to a room. */
  const controlSchema = useQuery({
    queryKey: ["conductor-control-schema", identity.organizationId],
    queryFn: () => checkControlSchema(identity.organizationId),
    staleTime: 60_000,
  });

  const access = accessContext({
    userId: identity.userId,
    organizationId: identity.organizationId,
    role: identity.role,
  });
  const actor = { id: identity.userId, label: identity.name };

  const control = useQuery({
    queryKey: ["conductor-control", identity.organizationId],
    queryFn: async () => {
      const [actions, receipts] = await Promise.all([
        loadControlledActions(identity.organizationId),
        loadReceipts(identity.organizationId),
      ]);
      return { actions, receipts };
    },
  });

  const now = new Date().toISOString();

  /*
   * Reading is a deliberate act, not a background poll: the suite is read when
   * a person asks, and the answer is derived from that one snapshot so every
   * number on screen belongs to the same moment.
   */
  const ask = useMutation({
    mutationFn: async (question: string) => {
      const snapshot = await loadSuiteSnapshot(identity.organizationId);
      const result = await answerQuestion({
        snapshot,
        question,
        intents: ledger.data?.intents ?? [],
        figures: ledger.data?.figures ?? [],
        corrections: ledger.data?.corrections ?? [],
      });

      /*
       * Preparing the queue is not acting: the graph becomes governed actions
       * sitting at "proposed" until a person decides. Idempotent on the
       * action's source key, so re-asking never duplicates the queue.
       */
      if (result.actionGraph && controlSchema.data?.ready) {
        const actions = buildControlledActions({
          organizationId: identity.organizationId,
          graph: result.actionGraph,
          answerId: result.id,
          now: new Date().toISOString(),
          existing: control.data?.actions ?? [],
        });
        await publishProposedActions(actions, access, actor).catch(() => undefined);
        await queryClient.invalidateQueries({
          queryKey: ["conductor-control", identity.organizationId],
        });
      }
      return result;
    },
    onSuccess: (result) => setAnswer(result),
  });

  const refreshControl = () =>
    queryClient.invalidateQueries({ queryKey: ["conductor-control", identity.organizationId] });

  const decideMutation = useMutation({
    mutationFn: async (
      decisions: { actionId: string; kind: "approve" | "hold" | "reject" | "withdraw"; reason?: string }[],
    ) => decide(control.data?.actions ?? [], decisions, access, actor),
    onSuccess: refreshControl,
  });

  const approveAllMutation = useMutation({
    mutationFn: async () => approveEverything(control.data?.actions ?? [], access, actor),
    onSuccess: refreshControl,
  });

  const routeMutation = useMutation({
    mutationFn: async (actionId: string) => {
      const actions = control.data?.actions ?? [];
      const action = actions.find((row) => row.id === actionId);
      if (!action) throw new Error("That action is no longer in the queue.");
      const outcome = await routeAction(action, actions, access, actor);
      if (outcome.refusedBecause) throw new Error(outcome.refusedBecause);
      return outcome;
    },
    onSuccess: refreshControl,
  });

  const routeAllMutation = useMutation({
    mutationFn: async () => routeApproved(control.data?.actions ?? [], access, actor),
    onSuccess: refreshControl,
  });

  /** Recording a figure re-asks the last question, so the answer moves with it. */
  const record = useMutation({
    mutationFn: async (input: {
      key: string;
      value: number;
      asOf: string;
      note?: string;
    }) =>
      recordFigure({
        organizationId: identity.organizationId,
        recordedBy: { id: identity.userId, label: identity.name },
        ...input,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["conductor-ledger", identity.organizationId],
      });
      if (lastQuestion) await ask.mutateAsync(lastQuestion);
    },
  });

  const correct = useMutation({
    mutationFn: async (draft: CorrectionDraft) =>
      recordCorrection({
        organizationId: identity.organizationId,
        correctedBy: { id: identity.userId, label: identity.name },
        ...(answer ? { answerId: answer.id, topic: answer.topic } : {}),
        ...(lastQuestion ? { question: lastQuestion } : {}),
        ...draft,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["conductor-ledger", identity.organizationId],
      });
      if (lastQuestion) await ask.mutateAsync(lastQuestion);
    },
  });

  return (
    <div className="space-y-12">
      <AppHero
        appId="conductor"
        eyebrow="Steward / Intelligence · Conductor"
        title="Ask Trust Tai."
        supporting="One question, one grounded answer. What is observed, what you decided, what follows from it, and what nobody can see yet."
      />

      <ConductorConsole
        {...(answer ? { answer } : {})}
        thinking={ask.isPending}
        onAsk={(question) => {
          setLastQuestion(question);
          return ask.mutateAsync(question).then(() => undefined);
        }}
        correcting={correct.isPending}
        corrected={correct.isSuccess}
        onCorrect={(draft) => correct.mutateAsync(draft).then(() => undefined)}
        figures={
          <div className="space-y-3">
            <SchemaStatus
              {...(schema.data ? { health: schema.data } : {})}
              checking={schema.isPending}
            />
            <FiguresPanel
              figures={ledger.data?.figures ?? []}
              now={now}
              saving={record.isPending}
              disabled={schema.data ? !schema.data.ready : true}
              {...(schema.data && !schema.data.ready
                ? { disabledReason: schema.data.message }
                : {})}
              onRecord={(input) => record.mutateAsync(input).then(() => undefined)}
            />
          </div>
        }
      />

      {controlSchema.data && !controlSchema.data.ready ? (
        <p className="text-sm text-[var(--tt-ink-muted)]">{controlSchema.data.message}</p>
      ) : (
        <ApprovalQueue
          control={describeControl(control.data?.actions ?? [], access)}
          receipts={control.data?.receipts ?? []}
          canApprove={can(access, "conductor.approve")}
          canExecute={can(access, "conductor.execute")}
          deciding={decideMutation.isPending || approveAllMutation.isPending}
          routing={routeMutation.isPending || routeAllMutation.isPending}
          onDecide={(decisions) => decideMutation.mutateAsync(decisions).then(() => undefined)}
          onRoute={(actionId) => routeMutation.mutateAsync(actionId).then(() => undefined)}
          onRouteAll={() => routeAllMutation.mutateAsync().then(() => undefined)}
        />
      )}

      {routeMutation.isError ? (
        <p className="text-sm text-[var(--tt-ink-muted)]">
          Nothing was handed over: {(routeMutation.error as Error).message}
        </p>
      ) : null}

      {record.isError ? (
        <p className="text-sm text-[var(--tt-ink-muted)]">
          That figure was not recorded: {(record.error as Error).message}
        </p>
      ) : null}


      {ask.isError ? (
        <p className="text-sm text-[var(--tt-ink-muted)]">
          The suite could not be read just now. Nothing was changed; try again.
        </p>
      ) : null}
    </div>
  );
}

