/**
 * Scout, company detail.
 *
 * One question leads this page: does this company deserve our attention, and
 * why? The Overview answers it in a curated way; the deeper tabs hold the
 * exhaustive evidence. Nothing here executes on its own.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";


import { AppShell } from "@/components/tt/app-shell";
import { EmptyState, TTButton } from "@/components/tt/primitives";
import { SequenceInRoadmap } from "@/components/tt/roadmap/sequence-button";
import { InboundSourceCard } from "@/components/tt/scout/inbound-source";
import {
  InboundOriginRail,
  StatedPanel,
  StatedTranscript,
} from "@/components/tt/scout/inbound";
import {
  EvidenceReviewPanel,
  TaiDecisionStatePanel,
} from "@/components/tt/scout/detail/research";
import {
  DecisionStatePanel,
  type DecisionCommit,
} from "@/components/tt/scout/detail/decision-state";
import { buildDecisionState } from "@/data/scout/decision-state";
import {
  contradictions,
  evidenceCoverage,
  evidenceThemes,
  lastResearchedAt,
  scoutRead,
} from "@/data/scout/research-brief";
import type { ProspectCandidate } from "@/domain/scout";
import { researchPermission } from "@/data/scout/research-consent";
import {
  planResearchRun,
  researchLifecycle,
  type ResearchRunPlan,
} from "@/data/scout/research-run";
import { inboundToldUs } from "@/data/scout/inbound";
import {
  ContradictionsPanel,
  CoverageStrip,
  EvidenceLanes,
  ResearchHeader,
  ResearchSources,
  RerunPanel,
  ScoutReadPanel,
} from "@/components/tt/scout/detail/research-brief";
import {
  hasResearchWorkspace,
  reviewStatedEvidence,
  scoutConductorAsk,
  taiDecisionState,
  type DecisionActionKey,
} from "@/data/scout/research-workspace";

import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { HandoffPanel } from "@/components/tt/prospect/handoff";
import { PeoplePanel, type ManualPersonForm } from "@/components/tt/prospect/people-panel";
import {
  RecommendedNextMoveCard,
} from "@/components/tt/scout/detail/recommended-move";
import { CompanyHero, DetailUtilityRow } from "@/components/tt/scout/detail/hero";
import {
  IcpAlignmentCard,
  KeySignalsCard,
  RecentActivityCard,
  ScoutSummaryCard,
  SimilarCompaniesCard,
} from "@/components/tt/scout/detail/overview";
import {
  AtAGlanceCard,
  NotesPreviewCard,
  TopReasonsCard,
} from "@/components/tt/scout/detail/rail";
import {
  ActivityTab,
  DetailTabs,
  IcpAnalysisTab,
  NotesTab,
  SignalsTab,
  parseDetailTab,
  type DetailTab,
} from "@/components/tt/scout/detail/tabs";
import { buildPersonPlan } from "@/data/person-priority";
import { buildMoveBlockers } from "@/data/scout/move-blockers";
import { composeProspectPage } from "@/data/prospect-modules";
import { buildHandoffDraft, developmentFromBrief } from "@/data/comms-handoff";
import { buildRelationshipBrief } from "@/data/relationship-development";
import { buildScoutCompanySummary } from "@/data/scout/company-summary";
import { readIcpFactors } from "@/data/scout/icp-factors";
import {
  buildRecommendedNextMove,
  type RecommendedMoveAction,
} from "@/data/scout/recommended-move";
import { similarCompanies } from "@/data/scout/similar-companies";
import { rankScoutSignals, topScoutSignals } from "@/data/scout/top-signals";
import { availablePeopleProviders, peopleProviderInfo } from "@/data/people/registry";
import { peopleService } from "@/data/supabase/people-service";
import { scoutService } from "@/data/supabase/scout-service";
import type { HandoffDraft } from "@/domain/comms-handoff";
import type { Person } from "@/domain/people";
import type { FitLight } from "@/domain/scout-fit";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Company · Scout · Trust Tai OS";
const DESCRIPTION =
  "Does this company deserve our attention, and why? ICP alignment, dated signals, people, and the bounded next step.";

type Section = "scout" | "qualified" | "research" | "worth_knowing";
type Fit = "all" | FitLight;

function parseSection(value: unknown): Section {
  return value === "qualified" || value === "research" || value === "worth_knowing"
    ? value
    : "scout";
}

function parseFit(value: unknown): Fit {
  return value === "green" || value === "yellow" || value === "red" || value === "neutral"
    ? value
    : "all";
}

export const Route = createFileRoute("/modules/scout/prospects/$prospectId")({
  validateSearch: (search: Record<string, unknown>) => ({
    section: parseSection(search["section"]),
    fit: parseFit(search["fit"]),
    ...(parseDetailTab(search["tab"]) === "overview"
      ? {}
      : { tab: parseDetailTab(search["tab"]) }),
  }),
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
  component: ProspectRoute,
});

function ProspectRoute() {
  const { prospectId } = Route.useParams();
  const search = Route.useSearch();
  return (
    <WorkspaceGate appId="scout">
      {(identity) => (
        <CompanyDetail
          identity={identity}
          prospectId={prospectId}
          section={search.section}
          fit={search.fit}
          tab={search.tab ?? "overview"}
        />
      )}
    </WorkspaceGate>
  );
}

function CompanyDetail({
  identity,
  prospectId,
  section,
  fit,
  tab,
}: {
  identity: WorkspaceIdentity;
  prospectId: string;
  section: Section;
  fit: Fit;
  tab: DetailTab;
}) {
  const { organizationId, userId } = identity;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const backSearch = { section, fit };

  const goToTab = (next: DetailTab) =>
    navigate({
      to: "/modules/scout/prospects/$prospectId",
      params: { prospectId },
      search: { section, fit, ...(next === "overview" ? {} : { tab: next }) },
    });

  const icp = useQuery({
    queryKey: ["scout", "icp", organizationId],
    queryFn: () => scoutService.icp(organizationId),
  });

  const saved = useQuery({
    queryKey: ["scout", "prospects", organizationId],
    queryFn: () => scoutService.list(organizationId),
  });

  const events = useQuery({
    queryKey: ["scout", "activity", organizationId, prospectId],
    queryFn: () => scoutService.activity(organizationId, prospectId, 60),
  });

  const people = useQuery({
    queryKey: ["scout", "people", organizationId, prospectId],
    queryFn: () => peopleService.list(organizationId, prospectId),
  });

  const providers = useQuery({
    queryKey: ["scout", "people-providers"],
    queryFn: async () => await availablePeopleProviders(),
    staleTime: 5 * 60 * 1000,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["scout", "prospects", organizationId] }),
      queryClient.invalidateQueries({ queryKey: ["scout", "activity", organizationId, prospectId] }),
      queryClient.invalidateQueries({ queryKey: ["scout", "people", organizationId, prospectId] }),
    ]);

  const board = saved.data ?? [];
  const candidate = board.find((c) => c.prospect.id === prospectId) ?? null;

  // A run is always planned first: the plan decides what gets re-read and what
  // is preserved, and the service refuses a plan that permission does not allow.
  const research = useMutation({
    mutationFn: (input: { candidate: ProspectCandidate; plan: ResearchRunPlan }) =>
      scoutService.runResearch(input, { organizationId, userId }),
    onSuccess: refresh,
  });

  const setResearchConsent = useMutation({
    mutationFn: (decision: "granted" | "withheld") => {
      if (!candidate) throw new Error("That company is no longer on your board.");
      return scoutService.setResearchConsent(
        {
          prospectId,
          companyName: candidate.prospect.name,
          decision,
          actorLabel: identity.name,
        },
        { organizationId, userId },
      );
    },
    onSuccess: refresh,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "qualified" | "passed" }) =>
      scoutService.setStatus(id, status, { organizationId, userId }),
    onSuccess: refresh,
  });

  const recordDecision = useMutation({
    mutationFn: (commit: DecisionCommit) => {
      if (!candidate) throw new Error("That company is no longer on your board.");
      return scoutService.recordDecision(
        {
          prospectId,
          companyName: candidate.prospect.name,
          move: commit.move,
          note: commit.note,
          previousStatus: candidate.prospect.status,
        },
        { organizationId, userId },
      );
    },
    onSuccess: refresh,
  });

  const ingest = useMutation({
    mutationFn: (providerId: string) => {
      if (!candidate) throw new Error("That company is no longer on your board.");
      return peopleService.ingest(providerId, candidate, { organizationId, userId });
    },
    onSuccess: refresh,
  });

  // The governed deeper-research action. Idempotent: a current brief is left
  // untouched, a stale or missing one is prepared from stored public evidence.
  const prepareBrief = useMutation({
    mutationFn: (input: { force?: boolean; quiet?: boolean }) =>
      scoutService.prepareRelationshipDevelopment(
        { prospectId, ...(input.force !== undefined ? { force: input.force } : {}) },
        { organizationId, userId },
      ),
    onSuccess: async (_result, input) => {
      await refresh();
      if (!input?.quiet) {
        toast.success("Research ready", {
          description: "The relationship research has been refreshed from stored public evidence.",
        });
      }
    },
  });

  const addPerson = useMutation({
    mutationFn: (form: ManualPersonForm) =>
      peopleService.addManual(
        {
          prospectId,
          fullName: form.fullName,
          roleTitle: form.roleTitle || undefined,
          seniority: form.seniority,
          email: form.email || undefined,
          linkedinUrl: form.linkedinUrl || undefined,
        },
        { organizationId, userId },
      ),
    // A newly added founder can make the company newly eligible — prepare the
    // brief if so (research only; a current brief is never re-run).
    onSuccess: () => {
      prepareBrief.mutate({ quiet: true });
      refresh();
    },
  });

  const confirmEmail = useMutation({
    mutationFn: (person: Person) => peopleService.confirmEmail(person, { organizationId, userId }),
    onSuccess: () => {
      prepareBrief.mutate({ quiet: true });
      refresh();
    },
  });

  const routeToComms = useMutation({
    mutationFn: (draft: HandoffDraft) =>
      scoutService.routeToComms(draft, { organizationId, userId }),
    onSuccess: refresh,
  });

  // A person's pacing decision: worth watching, or not for now. Reversible,
  // recorded on the prospect and in the shared activity stream.
  const setWatch = useMutation({
    mutationFn: (watch: "watching" | "not_now" | null) => {
      if (!candidate) throw new Error("That company is no longer on your board.");
      return scoutService.setWatch(
        { prospectId, companyName: candidate.prospect.name, watch },
        { organizationId, userId },
      );
    },
    onSuccess: refresh,
  });

  const addNote = useMutation({
    mutationFn: (body: string) => {
      if (!candidate) throw new Error("That company is no longer on your board.");
      return scoutService.addNote(
        { prospectId, companyName: candidate.prospect.name, body },
        { organizationId, userId },
      );
    },
    onSuccess: refresh,
  });

  const derived = useMemo(() => {
    if (!candidate) return null;
    return {
      summary: buildScoutCompanySummary(candidate),
      factors: readIcpFactors(candidate.evaluation),
      allSignals: rankScoutSignals(candidate),
      keySignals: topScoutSignals(candidate, 4),
      similar: similarCompanies(candidate, board),
    };
  }, [candidate, board]);

  const allEvents = events.data ?? [];
  const notes = allEvents.filter((event) => event.name === "prospect.commented");
  const peopleRows = people.data ?? [];

  // The confirm failure surfaces inline next to its blocker, where the click
  // happened — not as a detached page-level banner.
  const error = (research.error ??
    setResearchConsent.error ??
    setStatus.error ??
    recordDecision.error ??
    ingest.error ??
    addPerson.error ??
    routeToComms.error ??
    setWatch.error ??
    addNote.error ??
    saved.error) as Error | null;
  const prepareErrorMessage = prepareBrief.error
    ? prepareBrief.error instanceof Error
      ? prepareBrief.error.message
      : "Scout could not prepare the research. Retry when you are ready."
    : null;

  const busy =
    research.isPending ||
    setResearchConsent.isPending ||
    setStatus.isPending ||
    recordDecision.isPending ||
    ingest.isPending ||
    addPerson.isPending ||
    confirmEmail.isPending ||
    prepareBrief.isPending ||
    routeToComms.isPending ||
    setWatch.isPending ||
    addNote.isPending;

  if (saved.isPending) {
    return (
      <AppShell identity={identity}>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          Opening this company…
        </p>
      </AppShell>
    );
  }

  if (!candidate || !derived) {
    return (
      <AppShell identity={identity}>
        <EmptyState
          title="That company is not on your board"
          belongsHere="Companies are scoped to your organization. This one may have been removed, or it belongs to another workspace."
          whyItMatters="Scout never shows records outside the organization you are signed in to."
          action={
            <TTButton asChild variant="secondary">
              <Link to="/modules/scout" search={backSearch}>
                Back to Scout
              </Link>
            </TTButton>
          }
        />
      </AppShell>
    );
  }

  const { prospect, evaluation } = candidate;
  const ordered = board.filter((c) => c.prospect.status !== "archived");
  const position = ordered.findIndex((c) => c.prospect.id === prospectId);
  const prevCandidate = position > 0 ? ordered[position - 1] : undefined;
  const nextCandidate = position >= 0 ? ordered[position + 1] : undefined;

  const plan = buildPersonPlan(peopleRows);
  const composition = composeProspectPage({ candidate, activeIcpVersion: icp.data?.version ?? null });

  const review = reviewStatedEvidence(candidate);
  const permission = researchPermission(candidate);
  const coverage = evidenceCoverage(candidate, review.observed);
  const conflicts = contradictions(review);
  const themes = evidenceThemes(candidate, review);
  const brief = scoutRead({
    review,
    coverage,
    conflicts,
    permissionState: permission.state,
  });
  const lifecycle = researchLifecycle({
    coverage,
    permission,
    observedCount: review.observed.length,
    contradictions: conflicts.length,
    lastResearchedAt: lastResearchedAt(candidate),
    running: research.isPending,
  });
  const state = lifecycle.state;
  const decision = taiDecisionState({
    candidate,
    review,
    peopleCount: peopleRows.length,
    events: allEvents,
    canResearch: permission.canResearch,
    researchBecause: permission.because,
  });
  const workspace = { review, decision, ask: scoutConductorAsk(candidate, decision) };

  // The Tai Decision State: one suggested move, bounded human actions, and the
  // record of everything already settled here.
  const decisionState = buildDecisionState({
    candidate,
    review,
    read: brief,
    conflicts,
    permission,
    coverage,
    events: allEvents,
  });

  /** Start a controlled pass. `force` refreshes areas that are still fresh. */
  const startResearch = (force = false) => {
    const plan = force
      ? planResearchRun({
          coverage,
          permission,
          lastResearchedAt: lastResearchedAt(candidate),
          force: true,
        })
      : lifecycle.plan;
    if (!plan.allowed) return;
    research.mutate({ candidate, plan });
  };

  // The handoff draft behind "Prepare first message": the stored governed
  // brief travels as provenance, with canonical prospect/person IDs intact.
  // Built first because it is the canonical readiness read — the recommended
  // move below must never recommend outreach this draft would block.
  const storedBrief =
    candidate.development?.research?.state === "prepared"
      ? candidate.development.research.brief
      : undefined;
  const firstMessageDevelopment =
    developmentFromBrief(storedBrief) ??
    developmentFromBrief(buildRelationshipBrief({ candidate, people: peopleRows }));
  const firstMessageDraft = buildHandoffDraft({
    candidate,
    people: peopleRows,
    coverage: composition.coverage,
    fitConfidence: composition.confidence,
    ...(firstMessageDevelopment ? { development: firstMessageDevelopment } : {}),
  });

  // The one canonical decision surface: the recommended next move, computed
  // from the eligibility read, the governed brief, the pacing decision, and
  // the same handoff readiness that governs the Scout → Comms transition.
  const recommendedMove = buildRecommendedNextMove({
    candidate,
    people: peopleRows,
    firstMessage: { ready: firstMessageDraft.ready, blockers: firstMessageDraft.blockers },
  });

  // The guided flow behind "Resolve N blockers": the same structured blockers
  // the handoff draft lists, each carrying its own governed next action.
  const moveBlockers = buildMoveBlockers({
    candidate,
    people: peopleRows,
    coverage: composition.coverage,
  });

  const onRecommendedPrimary = (kind: RecommendedMoveAction) => {
    switch (kind) {
      case "open_in_comms":
        void navigate({ to: "/modules/comms" });
        break;
      case "find_person":
        void goToTab("people");
        break;
      case "prepare_research":
        prepareBrief.mutate(
          recommendedMove.prepareForce ? { force: true } : {},
        );
        break;
      case "research_company":
        startResearch();
        break;
      case "prepare_first_message":
      case "none":
        break;
    }
  };

  // "Prepare first message" is the explicit Scout → Comms transition: the
  // brief is carried across, and the person reviews the draft there.
  const prepareFirstMessage = () => {
    if (!firstMessageDraft.ready) return;
    routeToComms.mutate(firstMessageDraft, {
      onSuccess: () => void navigate({ to: "/modules/comms" }),
    });
  };

  // A blocked handoff is never a dead end: move to the canonical People area
  // and put keyboard focus on the reachability blockers.
  const resolveHandoffBlockers = () => {
    void goToTab("people");
    window.setTimeout(() => {
      const target = document.getElementById("scout-people-blockers");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      target?.focus({ preventScroll: true });
    }, 80);
  };

  const onDecisionAction = (key: DecisionActionKey) => {
    switch (key) {
      case "review_evidence":
        document
          .getElementById("scout-evidence-review")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      case "run_research":
        startResearch();
        break;
      case "find_people":
      case "route_to_comms":
        void goToTab("people");
        break;
      case "sequence_in_roadmap":
        void goToTab("overview");
        break;
      case "ask_question":
        void goToTab("notes");
        break;
      case "qualify":
        setStatus.mutate({ id: prospect.id, status: "qualified" });
        break;
      case "pass":
        setStatus.mutate({ id: prospect.id, status: "passed" });
        break;
      default:
        break;
    }
  };


  return (
    <AppShell identity={identity}>
      <div className="space-y-6">
        <DetailUtilityRow
          companyName={prospect.name}
          backSearch={backSearch}
          previous={
            prevCandidate
              ? { id: prevCandidate.prospect.id, name: prevCandidate.prospect.name }
              : null
          }
          next={
            nextCandidate
              ? { id: nextCandidate.prospect.id, name: nextCandidate.prospect.name }
              : null
          }
        />

        {research.isPending ? (
          <div
            role="status"
            aria-live="polite"
            className="tt-surface flex items-center gap-3 p-4 text-sm text-muted-foreground"
          >
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-royal" />
            Re-reading the public pages on {prospect.domain}. This takes a few moments.
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ) : null}

        <CompanyHero candidate={candidate} summary={derived.summary} />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_330px]">
          <div className="min-w-0 space-y-6">
            <DetailTabs
              active={tab}
              counts={{
                signals: derived.allSignals.length,
                notes: notes.length,
                people: peopleRows.length,
              }}
              showResearch={hasResearchWorkspace(candidate)}
              onChange={(next) => void goToTab(next)}
            />

            {tab === "research" ? (
              <div className="space-y-6">
                <ResearchHeader
                  companyName={prospect.name}
                  toldUs={candidate.stated ? inboundToldUs(candidate.stated) : null}
                  permission={permission}
                  state={state}
                  researchedAt={lastResearchedAt(candidate)}
                  onRunResearch={() => startResearch()}
                  onResolveConsent={(decisionValue) => setResearchConsent.mutate(decisionValue)}
                  busy={busy}
                />
                <CoverageStrip
                  areas={coverage.areas}
                  checkedCount={coverage.checkedCount}
                  total={coverage.total}
                />
                <RerunPanel
                  plan={lifecycle.plan}
                  onRun={() => startResearch()}
                  onForce={() => startResearch(true)}
                  busy={busy}
                />
                <ContradictionsPanel conflicts={conflicts} />
                <EvidenceLanes themes={themes} observed={review.observed} />
                <ResearchSources observed={review.observed} />
                <ScoutReadPanel read={brief} />
                <DecisionStatePanel
                  companyName={prospect.name}
                  state={decisionState}
                  toldUs={candidate.stated ? inboundToldUs(candidate.stated) : null}
                  submissionHref={
                    candidate.stated?.submissionRowId
                      ? `/modules/website/submissions/${candidate.stated.submissionRowId}`
                      : null
                  }
                  onCommit={(commit) => recordDecision.mutate(commit)}
                  busy={busy}
                />
                <TaiDecisionStatePanel
                  decision={workspace.decision}
                  conductorSearch={workspace.ask}
                  onAction={onDecisionAction}
                  busy={busy}
                />
                <div id="scout-evidence-review">
                  <EvidenceReviewPanel review={workspace.review} />
                </div>
                {candidate.stated ? <StatedTranscript packet={candidate.stated} /> : null}
              </div>
            ) : null}


            {tab === "overview" ? (
              <div className="space-y-6">
                {candidate.stated ? (
                  <>
                    <InboundOriginRail
                      packet={candidate.stated}
                      channel={
                        [
                          candidate.stated.attribution.utmSource,
                          candidate.stated.attribution.utmCampaign,
                        ]
                          .filter((part): part is string => Boolean(part && part.trim()))
                          .join(" · ") || "Direct"
                      }
                    />
                    <StatedPanel packet={candidate.stated} />
                    <StatedTranscript packet={candidate.stated} />
                  </>
                ) : null}
                <InboundSourceCard organizationId={organizationId} prospectId={prospectId} />
                <ScoutSummaryCard
                  summary={derived.summary}
                  onViewRationale={() => void goToTab("icp")}
                />

                <RecommendedNextMoveCard
                  move={recommendedMove}
                  candidate={candidate}
                  blockers={moveBlockers}
                  busy={busy}
                  preparingBrief={prepareBrief.isPending}
                  prepareError={prepareErrorMessage}
                  firstMessageReady={firstMessageDraft.ready}
                  routingFirstMessage={routeToComms.isPending}
                  confirmingEmailId={
                    confirmEmail.isPending ? (confirmEmail.variables?.id ?? null) : null
                  }
                  confirmedEmailId={confirmEmail.data?.id ?? null}
                  confirmEmailError={
                    confirmEmail.error
                      ? {
                          personId: confirmEmail.variables?.id ?? "",
                          message:
                            confirmEmail.error instanceof Error
                              ? confirmEmail.error.message
                              : "That confirmation could not be saved. Retry when you are ready.",
                        }
                      : null
                  }
                  researchPending={research.isPending}
                  onPrimary={onRecommendedPrimary}
                  onPrepareFirstMessage={prepareFirstMessage}
                  onWatch={(watch) => setWatch.mutate(watch)}
                  onPrepareBrief={(force) =>
                    prepareBrief.mutate(force ? { force: true } : {})
                  }
                  onConfirmEmail={(person) => {
                    confirmEmail.reset();
                    confirmEmail.mutate(person);
                  }}
                  onRunResearch={() => startResearch()}
                  onOpenPeople={resolveHandoffBlockers}
                  onSeeResearch={() =>
                    void goToTab(hasResearchWorkspace(candidate) ? "research" : "icp")
                  }
                />

                <KeySignalsCard
                  signals={derived.keySignals}
                  total={derived.allSignals.length}
                  onViewAll={() => void goToTab("signals")}
                />
                <IcpAlignmentCard
                  view={derived.factors}
                  onViewAnalysis={() => void goToTab("icp")}
                />
                <RecentActivityCard
                  events={allEvents}
                  onViewAll={() => void goToTab("activity")}
                />
                <SimilarCompaniesCard companies={derived.similar} linkSearch={backSearch} />
              </div>
            ) : null}

            {tab === "signals" ? <SignalsTab signals={derived.allSignals} /> : null}

            {tab === "icp" ? (
              <IcpAnalysisTab
                view={derived.factors}
                explanation={derived.summary.summary}
                icpVersion={icp.data?.version ?? null}
              />
            ) : null}

            {tab === "people" ? (
              <div className="space-y-6">
                <PeoplePanel
                  criteria={evaluation.criteria.filter((c) => c.key === "decision_maker")}
                  people={peopleRows}
                  providers={peopleProviderInfo()}
                  availableProviders={providers.data ?? []}
                  onIngest={(providerId) => ingest.mutate(providerId)}
                  onAddManual={(form) => addPerson.mutate(form)}
                  onConfirmEmail={(person) => confirmEmail.mutate(person)}
                  busy={busy}
                  note={ingest.data?.note}
                  plan={plan}
                />
                <HandoffPanel
                  candidate={candidate}
                  coverage={composition.coverage}
                  people={peopleRows}
                  fitConfidence={composition.confidence}
                  onRoute={(draft) => routeToComms.mutate(draft)}
                  onResolveBlockers={resolveHandoffBlockers}
                  routed={prospect.status === "ready_for_comms"}
                  busy={busy}
                  routing={routeToComms.isPending}
                />
              </div>
            ) : null}

            {tab === "notes" ? (
              <NotesTab
                notes={notes}
                onAdd={(body) => addNote.mutate(body)}
                busy={addNote.isPending}
              />
            ) : null}

            {tab === "activity" ? <ActivityTab events={allEvents} /> : null}
          </div>

          <aside className="space-y-5">
            <AtAGlanceCard candidate={candidate} />
            <TopReasonsCard reasons={derived.summary.topReasons} />
            <NotesPreviewCard
              notes={notes}
              onAdd={() => void goToTab("notes")}
              onViewAll={() => void goToTab("notes")}
            />
            <div className="flex flex-col gap-2">
              <TTButton
                variant="secondary"
                className="h-10 justify-center text-[13px]"
                disabled={busy || prospect.status === "qualified"}
                onClick={() => setStatus.mutate({ id: prospect.id, status: "qualified" })}
              >
                Qualify this company
              </TTButton>
              <TTButton
                variant="quiet"
                className="h-10 justify-center text-[13px]"
                disabled={busy || prospect.status === "passed"}
                onClick={() => setStatus.mutate({ id: prospect.id, status: "passed" })}
              >
                Pass for now
              </TTButton>
              <SequenceInRoadmap
                subject={{ kind: "prospect", id: prospect.id, label: prospect.name }}
                objective={`Move ${prospect.name} from where they stand today to a working Trust Tai engagement.`}
                context={{ organizationId, userId, userLabel: identity.name }}
              />
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
