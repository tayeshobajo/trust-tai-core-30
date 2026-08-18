/**
 * The Conductor, the command layer over the whole factory.
 *
 * Not a peer business room: it owns no entity and writes no room's truth. It
 * reads Scout, Comms, Roadmap, Projects, Ops, Studio, the shared activity
 * stream, Steward and Pulse, answers in plain language, and hands every piece
 * of consequential work back to the room and the person who own it.
 */

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
import { TTButton } from "@/components/tt/primitives";
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
  saveControlledActions,
  loadReceipts,
} from "@/data/supabase/conductor-control-service";
import {
  loadBusinessFigures,
  loadBusinessIntents,
  loadCorrections,
  recordCorrection,
  recordFigure,
} from "@/data/supabase/conductor-service";
import { LearningTrailPanel } from "@/components/tt/intelligence/learning-trail";
import { ConductorHeader } from "@/components/tt/conductor/conductor-header";
import { AskSurface } from "@/components/tt/conductor/ask-surface";
import { RecommendationCard } from "@/components/tt/conductor/recommendation-card";
import { ConductorSidebar } from "@/components/tt/conductor/conductor-sidebar";
import { ConductorRightRail } from "@/components/tt/conductor/conductor-right-rail";
import { BoundaryRows } from "@/components/tt/conductor/boundary-rows";
import {
  conductorGlance,
  leadRecommendations,
  needsTai,
  recentlyMoved,
} from "@/data/conductor/page-projection";
import { useIntelligenceRuns } from "@/hooks/use-intelligence-runs";
import { intelligenceService } from "@/data/intelligence/service";
import { readHandoff, type ConductorHandoff } from "@/data/pulse/handoff";
import { RoutedWorkStep } from "@/components/tt/conductor/routed-work-step";
import { buildRouteWithdrawalAction, routeStepGap } from "@/data/conductor/route-proposal";
import { projectsService } from "@/data/supabase/projects-service";
import { operationGap } from "@/data/conductor/adapters";
import { accessContext, can } from "@/domain/access";
import type { ConductorAnswer } from "@/domain/conductor";
import type { WorkspaceIdentity } from "@/lib/workspace";


const TITLE = "Ask Trust Tai · the Conductor · Trust Tai OS";
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
    <WorkspaceGate
      appId="conductor"
      preview={{
        room: "The Conductor",
        purpose:
          "The Conductor reads across every room, proposes one bounded next step at a time, and waits for a person to authorise it. None of that can run without a verified Trust Tai identity.",
        unavailable: [
          "Asking a question across Scout, Comms, Roadmap, Projects and Steward, answers are grounded in your organization's records, so there is nothing to read while signed out.",
          "Seeing what needs your judgment, including bounded steps still awaiting authorisation.",
          "Approving, holding or rejecting a step. Execution always requires an authenticated person with the right role in the owning room.",
          "Reading the learning trail and what the Conductor has observed after past outcomes.",
        ],
        returnTo: "/modules/conductor",
      }}
    >
      {(identity) => (
        <Conductor identity={identity} {...(handoff ? { handoff } : {})} />
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
  const [decided, setDecided] = useState<Record<string, boolean>>({});

  /* The cross-suite Business Read lives here, not on Pulse: interpretation,
   * confidence, what a step would and would not do, and authorisation. */
  const engine = useIntelligenceRuns(identity.organizationId);
  const queryClient = useQueryClient();

  /*
   * Decided truth, outcomes, hand-recorded figures, and corrections, is
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

  /*
   * A Pulse routed-work signal carries the request key only. The ledger is
   * re-read here from the shared activity stream, never copied across.
   */
  const routedWork = useQuery({
    queryKey: ["conductor-routed-work", identity.organizationId, handoff?.route ?? ""],
    enabled: Boolean(handoff?.route),
    queryFn: async () => {
      const ledger = await projectsService.routeLedger(identity.organizationId);
      return ledger.find((entry) => entry.key === handoff!.route) ?? null;
    },
  });

  /* Proposing is not approving: the step enters the queue as "proposed". */
  const proposeWithdrawal = useMutation({
    mutationFn: async (because: string) => {
      const entry = routedWork.data;
      if (!entry) throw new Error("That routed request is no longer in the ledger.");
      const action = buildRouteWithdrawalAction({
        entry,
        because,
        createdAt: new Date().toISOString(),
      });
      if (!action) throw new Error("There is no bounded step to propose for this request.");
      await saveControlledActions([action]);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["conductor-control", identity.organizationId] }),
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
         * no auto-filled brief, never an invented one. */
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
   * is inferred, an unreachable ledger simply skips the pass.
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

  /* Readings a person has already settled leave the surface immediately. */
  const openRecommendations = (engine.read?.recommendations ?? []).filter(
    (row) => !decided[row.id],
  );
  const lead = leadRecommendations(openRecommendations);

  const glance = conductorGlance({
    actions: control.data?.actions ?? [],
    recommendations: openRecommendations,
  });
  const needs = needsTai({
    actions: control.data?.actions ?? [],
    recommendations: openRecommendations,
  });
  const moved = recentlyMoved({
    receipts: control.data?.receipts ?? [],
    actions: control.data?.actions ?? [],
  });

  const openBoundaries = () => {
    const node = document.getElementById("conductor-boundaries");
    if (!(node instanceof HTMLDetailsElement)) return;
    node.open = true;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <AppShell identity={identity} sidebar={<ConductorSidebar glance={glance} />}>
    <div className="space-y-8">
      <ConductorHeader onExplain={openBoundaries} />

      <AskSurface
        thinking={ask.isPending}
        {...(handoff ? { initialQuestion: handoff.ask } : {})}
        onAsk={(question) => {
          setLastQuestion(question);
          return ask.mutateAsync(question).then(() => undefined);
        }}
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8">
          {handoff ? (
            <section className="rounded-xl border border-border bg-card p-4" aria-label="Opened from Pulse">
              <p className="tt-eyebrow">Opened from Pulse</p>
              <p className="mt-1.5 text-sm text-foreground">{handoff.entity ?? handoff.app}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Pulse carried a pointer, not a copy. Everything below is read again from the rooms
                that own it, and nothing here moves without you.
              </p>
            </section>
          ) : null}

          {routedWork.data ? (
            <RoutedWorkStep
              entry={routedWork.data}
              {...(routeStepGap(routedWork.data) ? { gap: routeStepGap(routedWork.data)! } : {})}
              opsGap={
                operationGap("ops", "ops.accept_routed_work") ??
                "Acceptance is the receiving room's own word."
              }
              canPropose={can(access, "projects.write")}
              proposing={proposeWithdrawal.isPending}
              proposed={(control.data?.actions ?? []).some(
                (action) => action.sourceEventKey === `${routedWork.data!.key}:withdrawn`,
              )}
              onPropose={(because) => proposeWithdrawal.mutate(because)}
            />
          ) : null}

          <ConductorConsole
            {...(answer ? { answer } : {})}
            thinking={ask.isPending}
            composer={false}
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
            <section aria-labelledby="business-read-heading" className="space-y-5">
              <div>
                <p className="tt-eyebrow">Business read</p>
                <h2
                  id="business-read-heading"
                  className="tt-display mt-2 max-w-[30ch] text-[22px] text-foreground sm:text-[26px]"
                >
                  {lead.length > 0
                    ? `${COUNT_WORD[lead.length] ?? lead.length} thing${
                        lead.length === 1 ? "" : "s"
                      } ${lead.length === 1 ? "is" : "are"} worth your judgment right now.`
                    : engine.read.headline}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Read across Projects, Comms, Roadmap, Scout, and the rest of the suite.
                </p>
                {engine.refreshing ? (
                  <p className="mt-1 text-[13px] text-muted-foreground">Reading again.</p>
                ) : null}
              </div>

              {lead.map((recommendation) => (
                <RecommendationCard
                  key={recommendation.id}
                  recommendation={recommendation}
                  hypotheses={engine.read!.hypotheses.filter((row) =>
                    recommendation.hypothesisRefs.includes(row.id),
                  )}
                  access={access}
                  onDecide={async ({ recommendation: row, decision, editedText }) => {
                    await intelligenceService.decide({
                      organizationId: identity.organizationId,
                      userId: identity.userId,
                      userName: identity.name,
                      recommendation: row,
                      decision,
                      ...(editedText ? { editedText } : {}),
                    });
                    setDecided((current) => ({ ...current, [row.id]: true }));
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
              ))}

              {openRecommendations.length > lead.length ? (
                <p className="text-[13px] text-muted-foreground">
                  {openRecommendations.length - lead.length} further reading
                  {openRecommendations.length - lead.length === 1 ? "" : "s"} were held back so the
                  few that matter stay legible.
                </p>
              ) : null}

              {lead.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing is waiting on your judgment. That is a truthful result, not an empty
                  screen.
                </p>
              ) : null}

              <div>
                <TTButton variant="quiet" onClick={() => void engine.refresh()}>
                  Read now
                </TTButton>
              </div>
            </section>
          ) : engine.loading ? (
            <p className="text-sm text-muted-foreground">Reading the business.</p>
          ) : null}

          <div id="approval-queue">
            {controlSchema.data && !controlSchema.data.ready ? (
              <p className="text-sm text-muted-foreground">{controlSchema.data.message}</p>
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
          </div>

          <BoundaryRows
            lessons={(control.data?.learning ?? []).length}
            learning={
              <div className="space-y-6">
                {engine.trail ? <LearningTrailPanel trail={engine.trail} /> : null}
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
              </div>
            }
          />

          {routeMutation.isError ? (
            <p className="text-sm text-muted-foreground">
              Nothing was handed over: {(routeMutation.error as Error).message}
            </p>
          ) : null}

          {record.isError ? (
            <p className="text-sm text-muted-foreground">
              That figure was not recorded: {(record.error as Error).message}
            </p>
          ) : null}

          {ask.isError ? (
            <p className="text-sm text-muted-foreground">
              The suite could not be read just now. Nothing was changed; try again.
            </p>
          ) : null}
        </div>

        <ConductorRightRail
          glance={glance}
          needs={needs}
          moved={moved}
          onCapabilities={openBoundaries}
        />
      </div>
    </div>
    </AppShell>
  );
}

const COUNT_WORD: Record<number, string> = { 1: "One", 2: "Two", 3: "Three" };
