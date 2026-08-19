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

import { AppShell } from "@/components/tt/app-shell";
import { EmptyState, TTButton } from "@/components/tt/primitives";
import { SequenceInRoadmap } from "@/components/tt/roadmap/sequence-button";
import { InboundSourceCard } from "@/components/tt/scout/inbound-source";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { HandoffPanel } from "@/components/tt/prospect/handoff";
import { PeoplePanel, type ManualPersonForm } from "@/components/tt/prospect/people-panel";
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
  NextStepsCard,
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
import { composeProspectPage } from "@/data/prospect-modules";
import { buildScoutCompanySummary } from "@/data/scout/company-summary";
import { readIcpFactors } from "@/data/scout/icp-factors";
import { scoutNextSteps, type ScoutNextStep } from "@/data/scout/next-steps";
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

type Section = "scout" | "qualified" | "research";
type Fit = "all" | FitLight;

function parseSection(value: unknown): Section {
  return value === "qualified" || value === "research" ? value : "scout";
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

  const research = useMutation({
    mutationFn: (websiteUrl: string) =>
      scoutService.research({ organizationId, userId, websiteUrl }),
    onSuccess: refresh,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "qualified" | "passed" }) =>
      scoutService.setStatus(id, status, { organizationId, userId }),
    onSuccess: refresh,
  });

  const ingest = useMutation({
    mutationFn: (providerId: string) => {
      if (!candidate) throw new Error("That company is no longer on your board.");
      return peopleService.ingest(providerId, candidate, { organizationId, userId });
    },
    onSuccess: refresh,
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
    onSuccess: refresh,
  });

  const confirmEmail = useMutation({
    mutationFn: (person: Person) => peopleService.confirmEmail(person, { organizationId, userId }),
    onSuccess: refresh,
  });

  const routeToComms = useMutation({
    mutationFn: (draft: HandoffDraft) =>
      scoutService.routeToComms(draft, { organizationId, userId }),
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

  const error = (research.error ??
    setStatus.error ??
    ingest.error ??
    addPerson.error ??
    confirmEmail.error ??
    routeToComms.error ??
    addNote.error ??
    saved.error) as Error | null;

  const busy =
    research.isPending ||
    setStatus.isPending ||
    ingest.isPending ||
    addPerson.isPending ||
    confirmEmail.isPending ||
    routeToComms.isPending ||
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

  const steps = scoutNextSteps({
    candidate,
    peopleCount: peopleRows.length,
    providerAvailable: (providers.data ?? []).length > 0,
  });

  const onStep = (step: ScoutNextStep) => {
    if (!step.available) return;
    switch (step.key) {
      case "research_leadership":
        void goToTab("people");
        break;
      case "rerun_research": {
        const url = prospect.websiteUrl || prospect.domain;
        if (url) research.mutate(url);
        break;
      }
      case "prepare_comms_handoff":
        void goToTab("people");
        break;
      case "add_note":
        void goToTab("notes");
        break;
      case "track_signals":
        void goToTab("signals");
        break;
    }
  };

  const plan = buildPersonPlan(peopleRows);
  const composition = composeProspectPage({ candidate, activeIcpVersion: icp.data?.version ?? null });

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
              onChange={(next) => void goToTab(next)}
            />

            {tab === "overview" ? (
              <div className="space-y-6">
                <InboundSourceCard organizationId={organizationId} prospectId={prospectId} />
                <ScoutSummaryCard
                  summary={derived.summary}
                  onViewRationale={() => void goToTab("icp")}
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
                  routed={prospect.status === "ready_for_comms"}
                  busy={busy}
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
            <NextStepsCard steps={steps} onSelect={onStep} busy={busy} />
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
