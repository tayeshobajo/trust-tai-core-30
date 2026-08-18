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
import { OutcomeLearning } from "@/components/tt/conductor/outcome-learning";
import {
  lastObservedAt,
  observableActions,
  runObservationPass,
} from "@/data/conductor/outcome-service";
import { correctLearning } from "@/data/supabase/conductor-learning-service";
import { ConductorConsole } from "@/components/tt/conductor/conductor-console";
import { FiguresPanel } from "@/components/tt/conductor/figures-panel";
import { SchemaStatus } from "@/components/tt/conductor/schema-status";
import {
  checkConductorSchema,
  checkControlSchema,
  checkLearningSchema,
} from "@/data/supabase/conductor-schema";
import type { CorrectionDraft } from "@/components/tt/conductor/correct-answer";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { answerQuestion } from "@/data/intelligence/conductor";
import { buildControlledActions } from "@/data/intelligence/conductor/control";
import {
  buildExecutionRead,
  describeExecution,
} from "@/data/intelligence/conductor/execution-read";
import { ADAPTER_GAPS } from "@/data/conductor/adapters";
import {
  loadLearning,
  loadObservations,
} from "@/data/supabase/conductor-learning-service";
import { getWorkforceSummary } from "@/data/execution-workforce";
import { MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import {
  approveEverything,
  decide,
  describeControl,
  publishProposedActions,
  routeAction,
  routeApproved,
} from "@/data/conductor/orchestrator";
import { loadSuiteSnapshot } from "@/data/intelligence/service";
import { getCurrentIcp } from "@/data/supabase/icp";
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
import { BusinessRead } from "@/components/tt/intelligence/business-read";
import { LearningTrailPanel } from "@/components/tt/intelligence/learning-trail";
import { useIntelligenceRuns } from "@/hooks/use-intelligence-runs";
import { intelligenceService } from "@/data/intelligence/service";
import { readHandoff, type ConductorHandoff } from "@/data/pulse/handoff";
import { accessContext, can } from "@/domain/access";
import type { ConductorAnswer } from "@/domain/conductor";
import type { WorkspaceIdentity } from "@/lib/workspace";


const TITLE = "Ask Trust Tai — the Conductor — Trust Tai OS";
const DESCRIPTION =
  "Ask the Trust Tai factory a question and get a grounded answer: vital signs, upstream causes, what is missing, and bounded next steps that only you can authorise.";

export const Route = createFileRoute("/modules/conductor")({
  /* Pulse hands over pointers only: which signal, which room, which lineage,
   * and the question to answer first. No business state crosses the boundary. */
  validateSearch: (search: Record<string, unknown>) => {
    const handoff = readHandoff(search);
    return handoff ? { ...handoff } : {};
  },
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
  const search = Route.useSearch();
  const handoff = readHandoff(search as Record<string, unknown>);
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <Conductor identity={identity} {...(handoff ? { handoff } : {})} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function Conductor({
  identity,
  handoff,
}: {
  identity: WorkspaceIdentity;
  handoff?: ConductorHandoff;
}) {
  const [answer, setAnswer] = useState<ConductorAnswer | undefined>(undefined);
  const [lastQuestion, setLastQuestion] = useState("");

  /* The cross-suite Business Read lives here, not on Pulse: interpretation,
   * confidence, what a step would and would not do, and authorisation. */
  const engine = useIntelligenceRuns(identity.organizationId);
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

  /* V3: without the learning ledger the room still acts, but remembers
   * nothing afterwards. That is said out loud rather than shown as silence. */
  const learningSchema = useQuery({
    queryKey: ["conductor-learning-schema", identity.organizationId],
    queryFn: () => checkLearningSchema(identity.organizationId),
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
      const [actions, receipts, observations, learning] = await Promise.all([
        loadControlledActions(identity.organizationId),
        loadReceipts(identity.organizationId),
        loadObservations(identity.organizationId),
        loadLearning(identity.organizationId),
      ]);
      return { actions, receipts, observations, learning };
    },
  });

  const workforce = useQuery({
    queryKey: ["conductor-workforce", identity.organizationId],
    queryFn: () => getWorkforceSummary({ data: { organizationId: identity.organizationId } }),
    staleTime: 30_000,
  });

  const now = new Date().toISOString();

  /*
   * The factory execution read: one honest line per governed action covering
   * where it stands, what should have become true, what was actually found in
   * the owning room, and whether that is enough to have learned anything.
   */
  const executionRead = buildExecutionRead({
    actions: control.data?.actions ?? [],
    receipts: control.data?.receipts ?? [],
    observations: control.data?.observations ?? [],
    learning: control.data?.learning ?? [],
    access: { can: (permission: string) => can(access, permission as never) },
  });

  /*
   * Reading is a deliberate act, not a background poll: the suite is read when
   * a person asks, and the answer is derived from that one snapshot so every
   * number on screen belongs to the same moment.
   */
  const ask = useMutation({
    mutationFn: async (question: string) => {
      const [snapshot, icp] = await Promise.all([
        loadSuiteSnapshot(identity.organizationId),
        /* Targeting truth a person already saved. Unreadable ICP simply means
         * no auto-filled brief — never an invented one. */
        getCurrentIcp(identity.organizationId).catch(() => null),
      ]);
      const result = await answerQuestion({
        snapshot,
        question,
        icp: icp
          ? {
              profileId: icp.id,
              version: icp.version,
              title: icp.title,
              contentMarkdown: icp.contentMarkdown,
              updatedAt: icp.updatedAt,
            }
          : null,
        intents: ledger.data?.intents ?? [],
        figures: ledger.data?.figures ?? [],
        corrections: ledger.data?.corrections ?? [],
        /* What earlier approved work actually produced. Filtered inside the
         * reasoning path to the rooms this answer touches. */
        priorLearning: control.data?.learning ?? [],
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

  /*
   * Observation is event-driven as well as read on load: the moment something
   * is handed to a room, the room is asked what actually became true. Nothing
   * is inferred — an unreachable ledger simply skips the pass.
   */
  const observeNow = async () => {
    if (!learningSchema.data?.ready) return;
    try {
      await runObservationPass({
        organizationId: identity.organizationId,
        actions: await loadControlledActions(identity.organizationId),
        receipts: await loadReceipts(identity.organizationId),
      });
    } catch {
      /* An observation pass never blocks a handover. */
    }
  };

  /*
   * The deliberate re-check. Only offered when there is something honestly
   * observable, and it never invents a result: an unchanged room resolves to
   * the reading already recorded rather than a second identical one.
   */
  const checkOutcomes = useMutation({
    mutationFn: observeNow,
    onSuccess: refreshControl,
  });

  /*
   * A person's own reading of what happened, appended as decided truth. It
   * supersedes what the system inferred and is retrievable by later answers.
   */
  const correctReading = useMutation({
    mutationFn: async (draft: { owningApp: string; operation: string; statement: string }) => {
      const standing = (control.data?.learning ?? [])
        .filter(
          (record) =>
            record.scope.owningApp === draft.owningApp &&
            record.scope.operation === draft.operation,
        )
        .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
      return correctLearning({
        organizationId: identity.organizationId,
        scope: { owningApp: draft.owningApp, operation: draft.operation },
        statement: draft.statement,
        correctedBy: actor,
        ...(standing ? { standing } : {}),
      });
    },
    onSuccess: refreshControl,
  });

  const checkable = observableActions(control.data?.actions ?? []).length;
  const lastChecked = lastObservedAt(control.data?.observations ?? []);

  const routeMutation = useMutation({
    mutationFn: async (actionId: string) => {
      const actions = control.data?.actions ?? [];
      const action = actions.find((row) => row.id === actionId);
      if (!action) throw new Error("That action is no longer in the queue.");
      const outcome = await routeAction(action, actions, access, actor);
      if (outcome.refusedBecause) throw new Error(outcome.refusedBecause);
      return outcome;
    },
    onSuccess: async () => {
      await observeNow();
      await refreshControl();
    },
  });

  const routeAllMutation = useMutation({
    mutationFn: async () => routeApproved(control.data?.actions ?? [], access, actor),
    onSuccess: async () => {
      await observeNow();
      await refreshControl();
    },
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

      {handoff ? (
        <section className="tt-surface p-5" aria-label="Opened from Pulse">
          <p className="tt-eyebrow">Opened from Pulse</p>
          <p className="mt-2 text-sm text-foreground">{handoff.entity ?? handoff.app}</p>
          <p className="mt-1 text-sm text-[var(--tt-ink-muted)]">{handoff.ask}</p>
          <p className="mt-2 text-xs text-[var(--tt-ink-muted)]">
            Pulse carried a pointer, not a copy. Everything below is read again from the rooms that
            own it, and nothing here executes without you.
          </p>
        </section>
      ) : null}

      <WorkforceSection workforce={workforce.data} loading={workforce.isPending} />

      <ConductorConsole
        {...(answer ? { answer } : {})}
        thinking={ask.isPending}
        {...(handoff ? { initialQuestion: handoff.ask } : {})}
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

      {engine.read ? (
        <section aria-label="Business read" className="space-y-4">
          <SectionHeading
            eyebrow="Business read"
            title="How the suite reads right now"
            description="A written read over the same evidence Pulse surfaces. Every next step still needs a person to authorise it, and the owning room still executes."
          />
          <BusinessRead
            read={engine.read}
            reasoning={engine.refreshing}
            access={access}
            onDecide={async ({ recommendation, decision, editedText }) => {
              await intelligenceService.decide({
                organizationId: identity.organizationId,
                userId: identity.userId,
                userName: identity.name,
                recommendation,
                decision,
                ...(editedText ? { editedText } : {}),
              });
              await engine.invalidate();
            }}
            onAuthorize={async ({ proposal, decision, note }) => {
              await intelligenceService.authorizeAction({
                organizationId: identity.organizationId,
                userId: identity.userId,
                userName: identity.name,
                access,
                proposal,
                decision,
                ...(note ? { note } : {}),
              });
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-[var(--tt-ink-muted)]">
              {engine.refreshing ? "Reading again." : engine.because}
            </p>
            <TTButton variant="quiet" onClick={() => void engine.refresh()}>
              Read now
            </TTButton>
          </div>
        </section>
      ) : engine.loading ? (
        <p className="text-sm text-[var(--tt-ink-muted)]">Reading the business.</p>
      ) : null}

      {engine.trail ? <LearningTrailPanel trail={engine.trail} /> : null}

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

      {controlSchema.data && !controlSchema.data.ready ? null : (
        <OutcomeLearning
          reads={executionRead}
          statement={describeExecution(executionRead)}
          gaps={ADAPTER_GAPS}
          {...(lastChecked ? { lastCheckedAt: lastChecked } : {})}
          checkable={learningSchema.data?.ready ? checkable : 0}
          checking={checkOutcomes.isPending}
          onCheckOutcomes={() => checkOutcomes.mutate()}
          correcting={correctReading.isPending}
          {...(learningSchema.data?.ready
            ? { onCorrect: (draft) => correctReading.mutate(draft) }
            : {})}
          {...(learningSchema.data && !learningSchema.data.ready
            ? { notice: learningSchema.data.message }
            : {})}
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

function WorkforceSection({
  workforce,
  loading,
}: {
  workforce:
    | Awaited<ReturnType<typeof getWorkforceSummary>>
    | undefined;
  loading: boolean;
}) {
  return (
    <section className="tt-surface p-6">
      <SectionHeading
        eyebrow="Execution"
        title="Workforce"
        description="Who is available, what is moving, and where the execution line is waiting on a person."
      />

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Available
          </dt>
          <dd className="mt-1 font-display text-3xl text-foreground">
            {loading ? "—" : workforce?.available ?? 0}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Working
          </dt>
          <dd className="mt-1 font-display text-3xl text-foreground">
            {loading ? "—" : workforce?.working ?? 0}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Blocked
          </dt>
          <dd className="mt-1 font-display text-3xl text-foreground">
            {loading ? "—" : workforce?.blocked ?? 0}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Waiting for Tai
          </dt>
          <dd className="mt-1 font-display text-3xl text-foreground">
            {loading ? "—" : workforce?.waitingForTai ?? 0}
          </dd>
        </div>
      </dl>

      <div className="mt-5 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="tt-eyebrow">Scout work item</p>
            <h3 className="mt-2 text-lg font-semibold text-foreground">
              {workforce?.scout.name ?? "Scout Growth Agent"}
            </h3>
          </div>
          <MetaPill>{workforce?.scout.status ?? "idle"}</MetaPill>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {workforce?.scout.goal ?? "Maintain 15 qualified prospects"}
        </p>
        <p className="mt-2 text-sm text-foreground">
          Progress: {loading ? "—" : `${workforce?.scout.current ?? 0} / ${workforce?.scout.target ?? 15}`}
        </p>
      </div>
    </section>
  );
}
