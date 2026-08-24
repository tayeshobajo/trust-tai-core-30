/**
 * One company, read as a candidate.
 *
 * The page is organized around one recommended next move, one clear reason,
 * and one primary action. Overview keeps the summary, the move and the
 * handoff; Signals, Research, People and History carry the underlying
 * evidence. Nothing here sends anything.
 */

import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { ArrowLeft, CircleAlert } from "lucide-react";

import { RecommendedNextMoveCard } from "@/components/tt/scout/detail/recommended-move";
import {
  DetailSection,
  Empty,
  FactorIcon,
  SectionLink,
  StrengthPill,
  relativeTime,
} from "@/components/tt/scout/detail/parts";
import { type ICPFactorStatus } from "@/data/scout/icp-factors";
import { SectionLabel, TTButton, ToneDot } from "@/components/tt/primitives";
import {
  ActivityNote,
  BeforeAfter,
  ComparisonCard,
  ConfirmAction,
  ConfidenceChip,
  EvidenceLink,
  FitLight,
  HandoffPanel,
  NextMovePanel,
  OpportunityCard,
  Panel,
  SignalRow,
  TierTag,
  WhyWeThink,
} from "@/components/tt/prospect/panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";
import { resolveContact } from "@/data/people/enrichment";
import { buildActivitySummary } from "@/data/scout/activity";
import { buildHandoff, buildHandoffBlockers } from "@/data/comms-handoff";
import { estimateRelationshipReadiness } from "@/data/comms-onboarding";
import {
  buildNextMove,
  buildResearchCoverage,
  type NextMove,
} from "@/data/prospect-modules";
import {
  computeFactorStatus,
  deriveFitConfidence,
  deriveModuleConfidence,
} from "@/data/scout-confidence";
import { buildMoveBlockers } from "@/data/scout/move-blockers";
import {
  buildRecommendedNextMove,
  type RecommendedNextMove,
  type RecommendedMoveAction,
} from "@/data/scout/recommended-move";
import {
  PREVIEW_WATCH,
  prepareRelationshipDevelopment,
  watchRelationshipDevelopment,
} from "@/data/relationship-development";
import { buildStatedView } from "@/data/stated";
import { buildTopSignals } from "@/data/scout/top-signals";
import { activityRepository } from "@/data/supabase/activities";
import { icpRepository } from "@/data/supabase/icp";
import { peopleService } from "@/data/supabase/people-service";
import { supabaseProspectModules } from "@/data/supabase/prospect-modules";
import { createScoutProvider } from "@/lib/scout-provider";
import { runScoutResearch } from "@/lib/scout-discovery";
import { normalizeWebsite } from "@/lib/website-url";
import {
  EmptyIntel,
  ScoutHeader,
  WorkspaceContextGate,
  scoutQueryKeys,
  useIntelQuery,
  useProspectList,
  useScoutWorkspace,
} from "@/components/tt/scout-workspace";
import type { Person } from "@/domain/people";
import type { ProspectActivity, ResearchRun } from "@/domain/prospect-modules";
import type { WatchState } from "@/domain/relationship-development";
import type { ProspectCandidate } from "@/domain/scout";

export const Route = createFileRoute("/modules/scout/prospects/$prospectId")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab:
      typeof search.tab === "string" && search.tab !== "overview"
        ? search.tab
        : undefined,
    // Other rooms link here carrying the board's return context; accepted and
    // ignored so those links stay valid.
    section: typeof search.section === "string" ? search.section : undefined,
    fit: typeof search.fit === "string" ? search.fit : undefined,
  }),
  component: ProspectDetailRoute,
});

function ProspectDetailRoute() {
  const { prospectId } = useParams({ from: "/modules/scout/prospects/$prospectId" });
  return (
    <WorkspaceContextGate>
      {({ organizationId, role }) => (
        <ProspectDetailPage prospectId={prospectId} organizationId={organizationId} role={role} />
      )}
    </WorkspaceContextGate>
  );
}

function ProspectDetailPage({
  prospectId,
  organizationId,
  role,
}: {
  prospectId: string;
  organizationId: string;
  role: ReturnType<typeof useScoutWorkspace>["role"];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { tab } = useSearch({ from: "/modules/scout/prospects/$prospectId" });
  const provider = useMemo(() => createScoutProvider(organizationId), [organizationId]);

  const prospectList = useProspectList(provider, organizationId);
  const intelQuery = useIntelQuery(organizationId, prospectId);
  const icpQuery = useQuery({
    queryKey: scoutQueryKeys.icp(organizationId),
    queryFn: () => icpRepository.get(organizationId),
  });
  const activityQuery = useQuery({
    queryKey: scoutQueryKeys.activities(organizationId, prospectId),
    queryFn: () => activityRepository.list(prospectId),
  });
  const modulesQuery = useQuery({
    queryKey: scoutQueryKeys.modules(organizationId, prospectId),
    queryFn: () => supabaseProspectModules.get(prospectId),
  });

  const [statusBusy, setStatusBusy] = useState(false);
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchFailed, setResearchFailed] = useState(false);
  const [prepareBusy, setPrepareBusy] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [routingFirstMessage, setRoutingFirstMessage] = useState(false);
  const [confirmingPersonId, setConfirmingPersonId] = useState<string | null>(null);
  const blockerSectionRef = useRef<HTMLElement | null>(null);

  const candidate = useMemo(() => {
    const base = prospectList.data?.find((entry) => entry.prospect.id === prospectId);
    return base ? { ...base, intel: intelQuery.data ?? base.intel } : undefined;
  }, [prospectList.data, intelQuery.data, prospectId]);

  const status = candidate?.prospect.status ?? "discovered";
  const people = useMemo(() => candidate?.intel?.people ?? [], [candidate]);
  const activities = activityQuery.data ?? [];
  const modules = modulesQuery.data;
  const researchRuns = modules?.history ?? [];
  const latestRun = researchRuns[researchRuns.length - 1] ?? null;
  const previousRun = researchRuns.length > 1 ? researchRuns[researchRuns.length - 2]! : null;
  const coverage = useMemo(
    () =>
      candidate
        ? buildResearchCoverage({
            candidate,
            activities,
            researchRun: latestRun,
            icp: icpQuery.data ?? null,
            intel: intelQuery.data,
            modules,
          })
        : null,
    [candidate, activities, latestRun, icpQuery.data, intelQuery.data, modules],
  );

  const draft = useMemo(() => {
    if (!candidate || !coverage) return null;
    return buildHandoff({
      candidate,
      people,
      coverage,
      fitConfidence: deriveFitConfidence({ coverage, evaluation: candidate.evaluation }),
      development: candidate.development?.research
        ? { research: candidate.development.research }
        : undefined,
    });
  }, [candidate, people, coverage]);

  const handoffBlockers = useMemo(() => {
    if (!candidate || !coverage) return [];
    return buildHandoffBlockers({ candidate, people, coverage });
  }, [candidate, people, coverage]);

  const move: RecommendedNextMove | null = useMemo(() => {
    if (!candidate) return null;
    return buildRecommendedNextMove({
      candidate,
      people,
      ...(draft
        ? {
            firstMessage: {
              ready: draft.ready,
              blockers: handoffBlockers.map((blocker) => blocker.message),
            },
          }
        : {}),
    });
  }, [candidate, people, draft, handoffBlockers]);

  const moveBlockers = useMemo(
    () => (candidate && coverage ? buildMoveBlockers({ candidate, people, coverage }) : []),
    [candidate, people, coverage],
  );

  const nextMove: NextMove | null = useMemo(() => {
    if (!candidate || !coverage) return null;
    return buildNextMove({
      status,
      evaluation: candidate.evaluation,
      coverage,
      development: candidate.development,
      intel: candidate.intel,
    });
  }, [candidate, coverage, status]);

  const topSignals = useMemo(() => {
    if (!candidate || !coverage) return [];
    return buildTopSignals({
      candidate,
      coverage,
      intel: intelQuery.data,
      development: candidate.development,
      researchRun: latestRun,
    });
  }, [candidate, coverage, intelQuery.data, latestRun]);

  const summary = useMemo(
    () => (candidate && coverage ? buildActivitySummary({ candidate, activities, coverage }) : null),
    [candidate, activities, coverage],
  );
  const statedView = useMemo(() => buildStatedView(candidate), [candidate]);
  const decisionMakers = useMemo(
    () => people.filter((person) => person.decisionMakerLikelihood === "high"),
    [people],
  );
  const primaryContact = useMemo(
    () => resolveContact(people).person ?? people[0] ?? null,
    [people],
  );
  const fitConfidence = useMemo(
    () => (candidate && coverage ? deriveFitConfidence({ coverage, evaluation: candidate.evaluation }) : null),
    [candidate, coverage],
  );
  const moveConfidence = useMemo(
    () =>
      candidate && coverage
        ? deriveModuleConfidence("next_move", {
            coverage,
            icp: icpQuery.data ?? null,
            intel: intelQuery.data,
          })
        : null,
    [candidate, coverage, icpQuery.data, intelQuery.data],
  );

  const busy =
    statusBusy ||
    prepareBusy ||
    researchBusy ||
    routingFirstMessage ||
    confirmingPersonId !== null;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: scoutQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: ["comms"] }),
    ]);
  };

  const changeTab = (next: string) => {
    void navigate({
      to: "/modules/scout/prospects/$prospectId",
      params: { prospectId },
      search: next === "overview" ? {} : { tab: next },
      replace: true,
    });
  };

  /** The governed prepare-brief action behind the recommended move. */
  const prepareBrief = async (force: boolean) => {
    if (!candidate || prepareBusy) return;
    setPrepareBusy(true);
    setPrepareError(null);
    try {
      await prepareRelationshipDevelopment({
        candidate,
        organizationId,
        force,
      });
      await invalidate();
      toast.success("Research ready", {
        description: "The relationship brief has been refreshed.",
      });
    } catch (error) {
      setPrepareError(error instanceof Error ? error.message : "Research could not be prepared.");
    } finally {
      setPrepareBusy(false);
    }
  };

  /** The governed company research pass behind coverage blockers. */
  const runResearch = async () => {
    if (!candidate || researchBusy) return;
    setResearchBusy(true);
    setResearchFailed(false);
    try {
      const normalized = normalizeWebsite(
        candidate.prospect.websiteUrl ?? `https://${candidate.prospect.domain}`,
      );
      await runScoutResearch(provider, organizationId, normalized, {});
      await invalidate();
    } catch {
      setResearchFailed(true);
    } finally {
      setResearchBusy(false);
    }
  };

  /** Hand the approved brief to Comms, then open the new relationship there. */
  const prepareFirstMessage = async () => {
    if (!candidate || !draft || !draft.ready || routingFirstMessage) return;
    setRoutingFirstMessage(true);
    try {
      const staged = await carryToComms();
      if (!staged) return;
      const readiness = estimateRelationshipReadiness({
        relationship: staged.relationship,
        onboarding: staged.onboarding,
      });
      toast.success(
        readiness === "developing" ? "History is in place" : "Relationship created",
        {
          description:
            readiness === "developing"
              ? "Recent labeled mail was carried over. Comms is preparing the first message for your review."
              : "Comms is preparing the first message for your review. Nothing is sent automatically.",
        },
      );
      await navigate({
        to: "/modules/comms",
        search: { relationship: staged.relationship.id },
      });
    } finally {
      setRoutingFirstMessage(false);
    }
  };

  /** The canonical place for people work: the People tab, focused on it. */
  const resolveHandoffBlockers = () => {
    if (tab === "people") {
      blockerSectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      blockerSectionRef.current?.focus({ preventScroll: true });
      return;
    }
    changeTab("people");
  };

  // Once the People tab is mounted, bring the blocker area into view.
  useEffect(() => {
    if (tab !== "people") return;
    const id = window.setTimeout(() => {
      blockerSectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 150);
    return () => window.clearTimeout(id);
  }, [tab]);

  /** The page's one fallback surface, kept for the non-prepare states. */
  const runPrimary = async (kind: RecommendedMoveAction) => {
    if (!candidate) return;
    if (kind === "open_in_comms") {
      await navigate({
        to: "/modules/comms",
        search: { q: candidate.prospect.name },
      });
    }
  };

  const setWatch = async (watch: WatchState | null) => {
    if (!candidate) return;
    try {
      await watchRelationshipDevelopment({
        organizationId,
        prospectId: candidate.prospect.id,
        watch,
        ...(candidate.development?.research ? { research: candidate.development.research } : {}),
      });
      await invalidate();
    } catch (error) {
      toast.error("Pacing was not saved", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  };

  const qualify = async () => {
    if (!candidate || !draft || !draft.ready) return;
    setStatusBusy(true);
    try {
      await provider.setStatus(candidate.prospect.id, "ready_for_comms", {
        organizationId,
        userId: previewUserId(),
      });
      await invalidate();
      toast.success("Qualified", { description: "The company is ready for Comms." });
    } catch (error) {
      toast.error("Qualify failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setStatusBusy(false);
    }
  };

  const pass = async () => {
    if (!candidate) return;
    setStatusBusy(true);
    try {
      await provider.setStatus(candidate.prospect.id, "passed", {
        organizationId,
        userId: previewUserId(),
      });
      await invalidate();
      toast.success("Passed", { description: "The company stays in the record as passed." });
      await navigate({ to: "/modules/scout" });
    } catch (error) {
      toast.error("Pass failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setStatusBusy(false);
    }
  };

  const confirmEmail = async (personId: string) => {
    if (!candidate || confirmingPersonId) return;
    const person = people.find((entry) => entry.id === personId);
    if (!person) return;
    setConfirmingPersonId(personId);
    try {
      await peopleService.confirmEmail(person, {
        organizationId,
        userId: previewUserId(),
      });
      await invalidate();
      toast.success("Address confirmed", {
        description: "The email is now treated as verified.",
      });
    } catch (error) {
      toast.error("Could not confirm the address", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setConfirmingPersonId(null);
    }
  };

  const carryToComms = async () => {
    if (!candidate || !draft || !draft.ready) return null;
    setStatusBusy(true);
    try {
      const staged = await stageRelationship(candidate, draft, organizationId);
      await invalidate();
      return staged;
    } catch (error) {
      toast.error("Handoff failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      return null;
    } finally {
      setStatusBusy(false);
    }
  };

  if (prospectList.isPending) {
    return (
      <main className="min-h-dvh bg-background">
        <div className="mx-auto max-w-[1280px] space-y-6 px-6 py-8">
          <div className="h-8 w-48 animate-pulse rounded-md bg-secondary" />
          <div className="h-[300px] animate-pulse rounded-xl bg-card" />
        </div>
      </main>
    );
  }

  if (!candidate || !coverage || !summary || !move || !nextMove || !draft) {
    return (
      <main className="min-h-dvh bg-background">
        <div className="mx-auto max-w-[720px] px-6 py-24 text-center">
          <h1 className="text-xl font-semibold text-foreground">This company is not on record</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            It may have been removed, or the link is stale. The board holds everything Scout
            knows about.
          </p>
          <div className="mt-6">
            <Link
              to="/modules/scout"
              className="inline-flex items-center gap-2 text-sm font-medium text-royal underline-offset-4 hover:underline"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back to the board
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const evaluation = candidate.evaluation;
  const researchRead = latestRun?.read ?? null;
  const plan = draft.plan;
  const showQualify = status === "discovered";
  const showCarry = status === "discovered";
  const showStatusAdjust = status === "qualified" || status === "ready_for_comms";
  const blockerCount = handoffBlockers.length;

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto max-w-[1280px] space-y-6 px-6 pb-16 pt-8">
        <ScoutHeader
          crumbs={[
            { label: "Scout", to: "/modules/scout" },
            { label: candidate.prospect.name },
          ]}
          title={candidate.prospect.name}
          lede={draft.summary.whyItFits}
          badges={
            <>
              <span className="tt-chip">{domainOf(candidate)}</span>
              {draft.research.state === "ready" && plan ? (
                <span className="tt-chip border-royal/25 bg-royal/8 text-royal">
                  {plan === "deepen_relationship" ? "Deepen the relationship" : "Begin a conversation"}
                </span>
              ) : null}
              {draft.research.state !== "ready" ? (
                <span className="tt-chip">Brief {draft.research.state.replace(/_/g, " ")}</span>
              ) : null}
              <FitLight light={evaluation.light} />
            </>
          }
          meta={`${evaluation.scoreable ? `ICP fit ${evaluation.score}` : "Not scored"} · Last checked ${relativeTime(candidate.lastCheckedAt)}`}
          actions={
            <>
              <TTButton
                variant="secondary"
                size="sm"
                pending={researchBusy}
                pendingLabel="Reading the public pages…"
                disabled={busy}
                onClick={() => void runResearch()}
              >
                Research again
              </TTButton>
              {status !== "passed" ? (
                <ConfirmAction
                  label="Pass"
                  confirmLabel="Confirm pass"
                  description="The company stays in the record as passed, with its evidence intact."
                  onConfirm={() => void pass()}
                  disabled={busy}
                />
              ) : null}
              {showStatusAdjust ? (
                <TTButton
                  variant="quiet"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void provider
                      .setStatus(candidate.prospect.id, "discovered", {
                        organizationId,
                        userId: previewUserId(),
                      })
                      .then(invalidate)
                  }
                >
                  Move back to discovered
                </TTButton>
              ) : null}
            </>
          }
        />

        {intelQuery.isError ? (
          <EmptyIntel
            message="The deeper read could not be loaded. The board summary still stands; retry to fetch signals, opportunities, and people."
            onRetry={() => void intelQuery.refetch()}
          />
        ) : null}

        {researchFailed ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3"
          >
            <p className="text-sm text-foreground">
              Research did not complete. Nothing was changed.
            </p>
            <TTButton
              variant="secondary"
              size="sm"
              pending={researchBusy}
              pendingLabel="Reading the public pages…"
              disabled={busy}
              onClick={() => void runResearch()}
            >
              Retry
            </TTButton>
          </div>
        ) : null}

        <Tabs
          value={tab ?? "overview"}
          onValueChange={changeTab}
          className="space-y-6"
        >
          <TabsList className="h-auto flex-wrap justify-start gap-1 rounded-xl border border-border bg-card p-1">
            <TabsTrigger value="overview" className="rounded-lg px-3 py-2 text-[13px]">
              Overview
            </TabsTrigger>
            <TabsTrigger value="signals" className="rounded-lg px-3 py-2 text-[13px]">
              Signals
            </TabsTrigger>
            <TabsTrigger value="research" className="rounded-lg px-3 py-2 text-[13px]">
              Research
            </TabsTrigger>
            <TabsTrigger value="people" className="rounded-lg px-3 py-2 text-[13px]">
              People
            </TabsTrigger>
            <TabsTrigger value="history" className="rounded-lg px-3 py-2 text-[13px]">
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="space-y-6">
                <Panel
                  eyebrow="Summary"
                  title="What matters right now"
                  emphasis="secondary"
                >
                  <ul className="space-y-3">
                    {summary.bullets.map((bullet, index) => (
                      <li key={index} className="flex items-start gap-3">
                        <ToneDot
                          tone={
                            index === 0
                              ? "navy"
                              : index === 1
                                ? "royal"
                                : index === 2
                                  ? "warning"
                                  : "neutral"
                          }
                          className="mt-[7px]"
                        />
                        <p className="max-w-reading text-sm leading-6 text-foreground">{bullet}</p>
                      </li>
                    ))}
                  </ul>
                </Panel>

                <RecommendedNextMoveCard
                  move={move}
                  candidate={candidate}
                  blockers={moveBlockers}
                  busy={busy}
                  preparingBrief={prepareBusy}
                  prepareError={prepareError}
                  firstMessageReady={draft.ready}
                  routingFirstMessage={routingFirstMessage}
                  confirmingEmail={confirmingPersonId !== null}
                  researchPending={researchBusy}
                  confidenceLevel={moveConfidence?.level}
                  onPrimary={(kind) => void runPrimary(kind)}
                  onPrepareFirstMessage={() => void prepareFirstMessage()}
                  onPrepareBrief={(force) => void prepareBrief(force)}
                  onConfirmEmail={(person) => void confirmEmail(person.id)}
                  onRunResearch={() => void runResearch()}
                  onOpenPeople={resolveHandoffBlockers}
                  onWatch={(watch) => void setWatch(watch)}
                  onSeeResearch={() => changeTab("research")}
                />

                <NextMovePanel
                  move={nextMove}
                  busy={statusBusy}
                  canResearch={Boolean(candidate.prospect.websiteUrl || candidate.prospect.domain)}
                  onQualify={() => void qualify()}
                  onPass={() => void pass()}
                  onResearch={() => void runResearch()}
                />

                <Panel
                  eyebrow="Handoff"
                  title="Ready for Comms"
                  aside={
                    <WhyWeThink
                      confidence={{
                        level: "moderate",
                        because: draft.planReason,
                        evidence: draft.evidence,
                      }}
                    />
                  }
                  emphasis="secondary"
                >
                  <HandoffPanel
                    draft={draft}
                    busy={statusBusy}
                    onQualify={() => void qualify()}
                    onCarry={() => void carryToComms()}
                    onResolveBlockers={resolveHandoffBlockers}
                    showQualify={showQualify}
                    showCarry={showCarry}
                  />
                </Panel>
              </div>

              <div className="space-y-6">
                <Panel
                  eyebrow="Activity"
                  title="What has happened"
                  emphasis="tertiary"
                  aside={<TierTag tier="utility" />}
                >
                  {activities.length > 0 ? (
                    <ul className="space-y-3">
                      {activities.slice(0, 6).map((entry) => (
                        <ActivityNote key={entry.id} activity={entry} />
                      ))}
                    </ul>
                  ) : (
                    <Empty>No recorded activity yet. Qualifying, passing and researching all write here.</Empty>
                  )}
                </Panel>

                <Panel
                  eyebrow="Top signals"
                  title={`${topSignals.length} signal${topSignals.length === 1 ? "" : "s"}`}
                  emphasis="tertiary"
                  aside={<TierTag tier="utility" />}
                >
                  {topSignals.length > 0 ? (
                    <ul className="space-y-2.5">
                      {topSignals.slice(0, 4).map((signal) => (
                        <SignalRow
                          key={signal.id}
                          signal={signal}
                          compact
                          onOpen={
                            signal.kind === "people"
                              ? () => changeTab("people")
                              : () => changeTab("signals")
                          }
                        />
                      ))}
                    </ul>
                  ) : (
                    <Empty>
                      Nothing stands out yet. When research finds buying signals or a digital gap,
                      the strongest few appear here.
                    </Empty>
                  )}
                  <div className="mt-4 border-t border-border pt-3">
                    <SectionLink onClick={() => changeTab("signals")}>Open signals</SectionLink>
                  </div>
                </Panel>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="signals" className="space-y-6">
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <DetailSection title="All signals" emphasis="lead">
                {topSignals.length > 0 ? (
                  <ul className="space-y-3">
                    {topSignals.map((signal) => (
                      <li
                        key={signal.id}
                        className="rounded-xl border border-border bg-card p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <StrengthPill strength={signal.strength} />
                          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                            {signal.kind.replace(/_/g, " ")}
                          </span>
                        </div>
                        <p className="mt-3 max-w-reading text-sm leading-6 text-foreground">
                          {signal.statement}
                        </p>
                        <p className="mt-2 text-[13px] text-muted-foreground">{signal.whyItMatters}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          {signal.sourceUrl ? <EvidenceLink url={signal.sourceUrl} /> : null}
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {relativeTime(signal.observedAt)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>
                    No signals are on record yet. Run research to read the public pages; anything
                    dated or useful lands here.
                  </Empty>
                )}
              </DetailSection>

              <div className="space-y-6">
                <DetailSection
                  title="Digital opportunities"
                  meta={`${intelQuery.data?.opportunities.length ?? 0} observed`}
                  emphasis="quiet"
                >
                  {intelQuery.data && intelQuery.data.opportunities.length > 0 ? (
                    <ul className="space-y-3">
                      {intelQuery.data.opportunities.slice(0, 4).map((opportunity) => (
                        <OpportunityCard key={opportunity.id} opportunity={opportunity} compact />
                      ))}
                    </ul>
                  ) : (
                    <Empty>No website gaps stand out in the current read.</Empty>
                  )}
                </DetailSection>

                <DetailSection title="Buying signals" emphasis="quiet">
                  {intelQuery.data && intelQuery.data.buyingSignals.length > 0 ? (
                    <ul className="space-y-2.5">
                      {intelQuery.data.buyingSignals.map((signal, index) => (
                        <li
                          key={`${signal.statement}-${index}`}
                          className="rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground"
                        >
                          {signal.statement}
                          <span className="mt-1 block font-mono text-[11px] text-muted-foreground">
                            {relativeTime(signal.observedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty>No dated buying signals on record.</Empty>
                  )}
                </DetailSection>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="research" className="space-y-6">
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="space-y-6">
                {statedView ? (
                  <DetailSection
                    title="What they told us"
                    meta={statedView.prelude}
                    emphasis="lead"
                  >
                    <ul className="space-y-4">
                      {statedView.entries.map((entry, index) => (
                        <li
                          key={index}
                          className="rounded-xl border border-royal/25 bg-royal/8 p-4"
                        >
                          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-royal">
                            {entry.topic}
                          </p>
                          <p className="mt-2 max-w-reading text-sm leading-6 text-foreground">
                            {entry.quote}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </DetailSection>
                ) : null}

                <DetailSection title="The read" emphasis={statedView ? "normal" : "lead"}>
                  {researchRead ? (
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <SectionLabel>Observed</SectionLabel>
                        <p className="max-w-reading text-sm leading-6 text-foreground">
                          {researchRead.whatTheyDo || "No observation on record."}
                        </p>
                        <p className="text-[13px] text-muted-foreground">
                          {researchRead.businessModel || "Business model not recorded."}
                        </p>
                      </div>

                      {researchRead.whoTheyHelp.length > 0 || researchRead.offerings.length > 0 ? (
                        <BeforeAfter
                          before={
                            <div className="space-y-2">
                              <SectionLabel>Who they help</SectionLabel>
                              <ul className="space-y-1 text-[13px] text-foreground">
                                {researchRead.whoTheyHelp.map((item, index) => (
                                  <li key={index}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          }
                          after={
                            <div className="space-y-2">
                              <SectionLabel>What they sell</SectionLabel>
                              <ul className="space-y-1 text-[13px] text-foreground">
                                {researchRead.offerings.map((item, index) => (
                                  <li key={index}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          }
                        />
                      ) : null}

                      {researchRead.notes.length > 0 ? (
                        <div className="space-y-2 border-t border-border pt-4">
                          <SectionLabel>Notes</SectionLabel>
                          <ul className="space-y-1.5 text-[13px] text-muted-foreground">
                            {researchRead.notes.map((note, index) => (
                              <li key={index}>{note}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <Empty>
                      No structured read yet. Run research to read the public pages and write one.
                    </Empty>
                  )}
                </DetailSection>

                {previousRun && latestRun ? (
                  <DetailSection title="What changed" emphasis="normal">
                    <ComparisonCard before={previousRun} after={latestRun} />
                  </DetailSection>
                ) : null}
              </div>

              <div className="space-y-6">
                <DetailSection title="Sources" emphasis="quiet">
                  {latestRun && latestRun.pages.length > 0 ? (
                    <ul className="space-y-2">
                      {latestRun.pages.map((page) => (
                        <li
                          key={page.url}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
                        >
                          <EvidenceLink url={page.url} label={page.title || page.url} />
                          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                            {relativeTime(page.fetchedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty>No pages are on record for this read.</Empty>
                  )}
                </DetailSection>

                <DetailSection title="Coverage" emphasis="quiet">
                  <p className="text-sm text-foreground">
                    {latestRun
                      ? `${latestRun.pages.length} page${latestRun.pages.length === 1 ? "" : "s"} read · ${relativeTime(latestRun.finishedAt)}`
                      : "No completed research pass."}
                  </p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {coverage.thin
                      ? "Coverage is thin — the brief rests on partial reading."
                      : "Coverage is sufficient for the current read."}
                  </p>
                  <div className="mt-3 border-t border-border pt-3">
                    <TTButton
                      variant="secondary"
                      size="sm"
                      pending={researchBusy}
                      pendingLabel="Reading the public pages…"
                      disabled={busy}
                      onClick={() => void runResearch()}
                    >
                      Research again
                    </TTButton>
                  </div>
                </DetailSection>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="people" className="space-y-6">
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="space-y-6">
                <BlockersSection
                  ref={blockerSectionRef}
                  draftBlockers={draft.blockers}
                  busy={busy}
                  verifyingPersonId={confirmingPersonId}
                  onVerify={(personId) => void confirmEmail(personId)}
                  people={people}
                />

                <DetailSection title="People" meta={`${people.length} on record`} emphasis="lead">
                  {people.length > 0 ? (
                    <ul className="space-y-4">
                      {people.map((person) => {
                        const isPrimary = primaryContact?.id === person.id;
                        const isDecisionMaker = person.decisionMakerLikelihood === "high";
                        const enriched = Boolean(person.email);
                        return (
                          <li
                            key={person.id}
                            className="rounded-xl border border-border bg-card p-4"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[15px] font-semibold text-foreground">
                                  {person.fullName}
                                </p>
                                <p className="text-[13px] text-muted-foreground">
                                  {person.roleTitle || "Role not recorded"}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {isPrimary ? (
                                    <span className="tt-chip border-navy/25 bg-navy/8 text-navy">
                                      Suggested contact
                                    </span>
                                  ) : null}
                                  {isDecisionMaker ? <span className="tt-chip">Decision maker</span> : null}
                                  {enriched ? <span className="tt-chip">Enriched</span> : null}
                                </div>
                              </div>
                              <ConfidenceChip level={person.confidence} />
                            </div>

                            <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-[13px]">
                              <p className="text-foreground">
                                Email ·{" "}
                                {person.email ? (
                                  <>
                                    {person.email}{" "}
                                    <span className="text-muted-foreground">
                                      ({person.emailStatus ?? "unknown"})
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-muted-foreground">Not on record</span>
                                )}
                              </p>
                              {person.phone ? (
                                <p className="text-muted-foreground">Phone · {person.phone}</p>
                              ) : null}
                              {person.linkedinUrl ? (
                                <EvidenceLink url={person.linkedinUrl} label="LinkedIn profile" />
                              ) : null}
                            </div>

                            {person.sourceUrl ? (
                              <div className="mt-3">
                                <EvidenceLink url={person.sourceUrl} label="Where this person was found" />
                              </div>
                            ) : null}

                            {person.email && person.emailStatus === "found" && role !== "viewer" ? (
                              <div className="mt-4 border-t border-border pt-3">
                                <TTButton
                                  variant="secondary"
                                  size="sm"
                                  pending={confirmingPersonId === person.id}
                                  pendingLabel="Confirming…"
                                  disabled={busy}
                                  onClick={() => void confirmEmail(person.id)}
                                >
                                  Confirm this address is real
                                </TTButton>
                                <p className="mt-2 text-[12px] text-muted-foreground">
                                  Confirmation is a human decision. It marks the address verified;
                                  nothing is sent.
                                </p>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <Empty>
                      No people are on record. Research reads the public pages for founders and
                      decision makers; anyone credible lands here.
                    </Empty>
                  )}
                </DetailSection>
              </div>

              <div className="space-y-6">
                <DetailSection title="Decision makers" emphasis="quiet">
                  {decisionMakers.length > 0 ? (
                    <ul className="space-y-2">
                      {decisionMakers.map((person) => (
                        <li
                          key={person.id}
                          className="rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground"
                        >
                          {person.fullName}
                          <span className="block text-[12px] text-muted-foreground">
                            {person.roleTitle || "Role not recorded"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty>No founder or decision maker is on record yet.</Empty>
                  )}
                </DetailSection>

                <DetailSection title="Contact readiness" emphasis="quiet">
                  <p className="text-sm text-foreground">
                    {draft.ready
                      ? "The handoff is clear: a credible person, a reachable address, and enough research."
                      : `${blockerCount} thing${blockerCount === 1 ? "" : "s"} still stand between this company and a safe handoff.`}
                  </p>
                  {!draft.ready ? (
                    <div className="mt-3">
                      <TTButton
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={resolveHandoffBlockers}
                      >
                        Resolve {blockerCount} blocker{blockerCount === 1 ? "" : "s"}
                      </TTButton>
                    </div>
                  ) : null}
                </DetailSection>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="history" className="space-y-6">
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <DetailSection title="Research passes" meta={`${researchRuns.length} completed`} emphasis="lead">
                {researchRuns.length > 0 ? (
                  <ul className="space-y-3">
                    {[...researchRuns].reverse().map((run) => (
                      <ResearchRunRow key={run.id} run={run} />
                    ))}
                  </ul>
                ) : (
                  <Empty>No research passes yet. The first one writes the read, the sources and the score.</Empty>
                )}
              </DetailSection>

              <DetailSection title="Activity" meta={`${activities.length} entries`} emphasis="quiet">
                {activities.length > 0 ? (
                  <ul className="space-y-3">
                    {activities.map((entry) => (
                      <ActivityNote key={entry.id} activity={entry} />
                    ))}
                  </ul>
                ) : (
                  <Empty>Nothing recorded yet.</Empty>
                )}
              </DetailSection>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

/**
 * What still stands between this company and a safe handoff, with the exact
 * action that clears each item where the action is available in place.
 */
const BlockersSection = ({
  ref,
  draftBlockers,
  people,
  busy,
  verifyingPersonId,
  onVerify,
}: {
  ref: Ref<HTMLElement | null>;
  draftBlockers: string[];
  people: Person[];
  busy: boolean;
  verifyingPersonId: string | null;
  onVerify: (personId: string) => void;
}) => {
  const peopleByEmailFragment = (blocker: string) =>
    people.find(
      (person) =>
        person.email &&
        person.emailStatus === "found" &&
        blocker.includes(person.email),
    ) ?? null;

  return (
    <section
      ref={ref}
      id="handoff-blockers"
      tabIndex={-1}
      aria-label="Handoff blockers"
      className="tt-level-secondary scroll-mt-6 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-royal/40"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
          What is in the way
        </h2>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {draftBlockers.length === 0 ? "Clear" : `${draftBlockers.length} open`}
        </span>
      </header>
      <div className="px-5 pb-5 pt-4">
        {draftBlockers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-surface-tertiary px-4 py-5 text-[13px] text-muted-foreground">
            Nothing is in the way. The handoff to Comms is clear.
          </p>
        ) : (
          <ul className="space-y-2">
            {draftBlockers.map((blocker, index) => {
              const person = peopleByEmailFragment(blocker);
              return (
                <li
                  key={index}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <CircleAlert aria-hidden className="size-4 shrink-0 text-warning" />
                    <p className="text-[13px] text-foreground">{blocker}</p>
                  </div>
                  {person ? (
                    <TTButton
                      variant="secondary"
                      size="sm"
                      pending={verifyingPersonId === person.id}
                      pendingLabel="Confirming…"
                      disabled={busy}
                      onClick={() => onVerify(person.id)}
                    >
                      Confirm this address is real
                    </TTButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
};

function ResearchRunRow({ run }: { run: ResearchRun }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <FactorIcon status={factorStatusOf(run)} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {run.pages.length} page{run.pages.length === 1 ? "" : "s"} read
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {relativeTime(run.finishedAt)}
              {typeof run.score === "number" ? ` · Score ${run.score}` : ""}
            </p>
          </div>
        </div>
        <TTButton variant="quiet" size="sm" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide detail" : "See detail"}
        </TTButton>
      </div>
      {open ? (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <p className="text-[13px] text-foreground">{run.read.whatTheyDo || "No observation recorded."}</p>
          {run.pages.length > 0 ? (
            <ul className="space-y-1.5">
              {run.pages.map((page) => (
                <li key={page.url}>
                  <EvidenceLink url={page.url} label={page.title || page.url} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function factorStatusOf(run: ResearchRun): ICPFactorStatus {
  return computeFactorStatus(run) === "partial" ? "partial" : computeFactorStatus(run);
}

function domainOf(candidate: ProspectCandidate): string {
  return candidate.prospect.domain || candidate.prospect.websiteUrl || "No website on record";
}

function previewUserId(): string {
  return PREVIEW_WATCH.userId;
}

/** Carry the approved brief across, creating the Comms relationship in place. */
async function stageRelationship(
  candidate: ProspectCandidate,
  draft: ReturnType<typeof buildHandoff>,
  organizationId: string,
) {
  const { stageRelationshipHandoff } = await import("@/data/comms-handoff");
  return stageRelationshipHandoff({
    candidate,
    draft,
    organizationId,
    userId: previewUserId(),
  });
}
