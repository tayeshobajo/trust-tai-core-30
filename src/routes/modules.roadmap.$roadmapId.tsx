/**
 * One roadmap, read top to bottom.
 *
 * Orientation → current truth → destination → the walk → decisions → next move.
 * Observed, inferred and decided never blend: each line carries its own tier
 * and its own evidence.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import {
  EmptyState,
  MetaPill,
  PageHeader,
  SectionHeading,
  TTButton,
} from "@/components/tt/primitives";
import { DecisionPanel } from "@/components/tt/roadmap/decision-panel";
import {
  PointAPanel,
  PointBPanel,
  StageList,
} from "@/components/tt/roadmap/roadmap-spine";
import { AskPanel } from "@/components/tt/roadmap/ask-panel";
import { BuildOrderView } from "@/components/tt/roadmap/build-order-view";
import { StartInProjects } from "@/components/tt/projects/start-in-projects";
import { MilestonesView } from "@/components/tt/roadmap/milestones-view";
import { ResearchView } from "@/components/tt/roadmap/research-view";
import {
  isRoadmapView,
  RoadmapTabs,
  type RoadmapView,
} from "@/components/tt/roadmap/roadmap-tabs";
import { StrategyView } from "@/components/tt/roadmap/strategy-view";
import { StudioView } from "@/components/tt/roadmap/studio-view";
import { readRoadmapBrand } from "@/data/supabase/roadmap-brand";
import { TierChip } from "@/components/tt/roadmap/tier";
import { WalkthroughView } from "@/components/tt/roadmap/walkthrough-view";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { roadmapService, type RoadmapContext } from "@/data/supabase/roadmap-service";
import { roadmapIntel, type IntelContext } from "@/data/supabase/roadmap-intel-service";
import {
  normalizeMilestones,
  normalizeResearch,
  normalizeStrategy,
} from "@/data/roadmap-research-parse";
import { readNdjsonStream } from "@/lib/ndjson-stream";
import type {
  ApprovalState,
  ArtifactSection,
  MilestoneStatus,
  RoadmapArtifact,
  RoadmapMilestone,
  WalkthroughEntryKind,
} from "@/domain/roadmap-intel";

import { supabase } from "@/integrations/trust-tai/supabase";
import type {
  DecisionState,
  RoadmapDecision,
  RoadmapStage,
  StageState,
} from "@/domain/roadmap";
import { ROADMAP_STATUS_LABEL } from "@/domain/roadmap";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Roadmap workspace — Trust Tai OS";
const DESCRIPTION =
  "One roadmap: current truth, the destination, the walk between them, and who carries each step.";

export const Route = createFileRoute("/modules/roadmap/$roadmapId")({
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
  validateSearch: (search: Record<string, unknown>): { view: RoadmapView } => ({
    view: isRoadmapView(search["view"]) ? search["view"] : "overview",
  }),
  component: RoadmapDetailRoute,
});

function RoadmapDetailRoute() {
  const { roadmapId } = Route.useParams();
  const { view } = Route.useSearch();
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <RoadmapWorkspace identity={identity} roadmapId={roadmapId} view={view} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function RoadmapWorkspace({
  identity,
  roadmapId,
  view,
}: {
  identity: WorkspaceIdentity;
  roadmapId: string;
  view: RoadmapView;
}) {
  const queryClient = useQueryClient();
  const context: RoadmapContext = {
    organizationId: identity.organizationId,
    userId: identity.userId,
    userLabel: identity.name,
  };

  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["roadmap", "detail", roadmapId],
    queryFn: () => roadmapService.detail(roadmapId, identity.organizationId),
    retry: false,
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["roadmap"] });
  }

  function fail(error: unknown) {
    setActionError(error instanceof Error ? error.message : "That change could not be saved.");
  }

  const approve = useMutation({
    mutationFn: async () => {
      const detail = detailQuery.data;
      if (!detail?.roadmap.pointB) throw new Error("There is no destination to approve.");
      return roadmapService.approveDestination(
        detail.roadmap.id,
        detail.roadmap.subjectLabel,
        detail.roadmap.pointB,
        context,
      );
    },
    onSuccess: refresh,
    onError: fail,
  });

  const archive = useMutation({
    mutationFn: async () => {
      const detail = detailQuery.data;
      if (!detail) throw new Error("There is no roadmap to archive.");
      return roadmapService.setStatus(
        detail.roadmap.id,
        detail.roadmap.status === "archived" ? "in_progress" : "archived",
        detail.roadmap.subjectLabel,
        context,
      );
    },
    onSuccess: refresh,
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: async () => {
      const detail = detailQuery.data;
      if (!detail) throw new Error("There is no roadmap to delete.");
      await roadmapService.remove(detail.roadmap.id, detail.roadmap.subjectLabel, context);
    },
    onSuccess: async () => {
      await refresh();
      await navigate({ to: "/modules/roadmap" });
    },
    onError: fail,
  });

  const stageState = useMutation({
    mutationFn: async ({ stage, state }: { stage: RoadmapStage; state: StageState }) => {
      setBusyId(stage.id);
      return roadmapService.setStageState(
        stage,
        state,
        detailQuery.data?.roadmap.subjectLabel ?? "This roadmap",
        context,
      );
    },
    onSettled: () => setBusyId(null),
    onSuccess: refresh,
    onError: fail,
  });

  const resolve = useMutation({
    mutationFn: async ({
      decision,
      status,
      note,
    }: {
      decision: RoadmapDecision;
      status: Exclude<DecisionState, "open">;
      note: string;
    }) => {
      setBusyId(decision.id);
      return roadmapService.resolveDecision(
        decision,
        status,
        detailQuery.data?.roadmap.subjectLabel ?? "This roadmap",
        context,
        note,
      );
    },
    onSettled: () => setBusyId(null),
    onSuccess: refresh,
    onError: fail,
  });


  /* ------------------------------------------------- roadmap intelligence */

  const intelContext: IntelContext = {
    organizationId: identity.organizationId,
    userId: identity.userId,
    userLabel: identity.name,
  };

  const [researchStage, setResearchStage] = useState<string | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [studioStage, setStudioStage] = useState<string | null>(null);

  const [busyKey, setBusyKey] = useState<string | null>(null);

  const intelQuery = useQuery({
    queryKey: ["roadmap", "intel", roadmapId],
    queryFn: () => roadmapIntel.load(roadmapId),
    retry: false,
  });

  async function accessToken(): Promise<string> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Your session expired. Sign in again to research.");
    return token;
  }

  /**
   * One research pass: research the business, propose a strategy, and generate
   * milestone candidates. Everything lands Inferred and Proposed. Nothing here
   * can approve itself.
   */
  const research = useMutation({
    mutationFn: async () => {
      const detail = detailQuery.data;
      if (!detail) throw new Error("This roadmap could not be read.");
      setResearchError(null);
      setResearchStage("Starting");

      const response = await fetch("/api/public/roadmap/research", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await accessToken()}`,
        },
        body: JSON.stringify({
          organization_id: identity.organizationId,
          subject_label: detail.roadmap.subjectLabel,
          objective: detail.roadmap.objective,
          known: detail.roadmap.pointA.map((entry) => `${entry.label}: ${entry.value}`),
        }),
      });

      if (!response.ok || !response.body) {
        const detailText = await response.text();
        throw new Error(detailText.slice(0, 300) || "The research run could not start.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let payload: Record<string, unknown> | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const stage = JSON.parse(line) as { stage: string; message: string; data?: unknown };
          setResearchStage(stage.message);
          if (stage.stage === "error") throw new Error(stage.message);
          if (stage.stage === "complete") payload = stage.data as Record<string, unknown>;
        }
      }

      if (!payload) throw new Error("The research run returned nothing. Nothing was changed.");

      const provenance = {
        provider: String(payload["provider"] ?? "unknown"),
        model: String(payload["model"] ?? "unknown"),
        checkedAt: String(payload["checkedAt"] ?? new Date().toISOString()),
      };
      const label = detail.roadmap.subjectLabel;

      await roadmapIntel.saveResearch(
        intelContext,
        roadmapId,
        label,
        normalizeResearch(payload["research"], provenance),
        provenance,
      );

      const strategy = normalizeStrategy(payload["strategy"], provenance);
      await roadmapIntel.saveStrategy(intelContext, roadmapId, label, {
        ...strategy,
        provider: provenance.provider,
        model: provenance.model,
        generatedAt: provenance.checkedAt,
      });

      const candidates = normalizeMilestones(payload["milestones"], provenance);
      if (candidates.length > 0) {
        await roadmapIntel.replaceCandidates(intelContext, roadmapId, label, candidates);
      }
    },
    onSettled: () => setResearchStage(null),
    onSuccess: refresh,
    onError: (error) =>
      setResearchError(error instanceof Error ? error.message : "The research run failed."),
  });

  const approval = useMutation({
    mutationFn: async ({ key, state }: { key: string; state: ApprovalState }) => {
      const strategy = intelQuery.data?.strategy;
      if (!strategy) throw new Error("There is no strategy to decide on.");
      setBusyKey(key);
      return roadmapIntel.setStrategyApproval(
        intelContext,
        strategy,
        key,
        state,
        detailQuery.data?.roadmap.subjectLabel ?? "This roadmap",
      );
    },
    onSettled: () => setBusyKey(null),
    onSuccess: refresh,
    onError: fail,
  });

  const milestoneStatus = useMutation({
    mutationFn: async ({
      milestone,
      status,
      note,
    }: {
      milestone: RoadmapMilestone;
      status: MilestoneStatus;
      note: string;
    }) => {
      setBusyId(milestone.id);
      return roadmapIntel.setMilestoneStatus(
        intelContext,
        milestone,
        status,
        detailQuery.data?.roadmap.subjectLabel ?? "This roadmap",
        note || undefined,
      );
    },
    onSettled: () => setBusyId(null),
    onSuccess: refresh,
    onError: fail,
  });

  /**
   * Studio composition. The server builds an approved evidence packet, asks the
   * model to express only that packet, then validates the result back against
   * it. Nothing here can add a fact, and a hand edited document is only
   * replaced when someone explicitly says so.
   */
  const compose = useMutation({
    mutationFn: async ({ kind, replace }: { kind: "preview" | "full"; replace?: boolean }) => {
      const detail = detailQuery.data;
      const intel = intelQuery.data;
      if (!detail || !intel) throw new Error("There is nothing to compose yet.");
      setStudioStage("Starting");

      const response = await fetch("/api/public/roadmap/studio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await accessToken()}`,
        },
        body: JSON.stringify({
          organization_id: identity.organizationId,
          subject_label: detail.roadmap.subjectLabel,
          kind,
          strategy: intel.strategy,
          milestones: intel.milestones,
          research: intel.research,
        }),
      });

      const payload = await readNdjsonStream(response, (stage) => setStudioStage(stage.message));
      if (!payload) throw new Error("Studio returned nothing. Nothing was saved.");

      const sections = (payload["sections"] ?? []) as ArtifactSection[];
      // Only a validated logo or brand colour travels into the document.
      const brand = await readRoadmapBrand(detail.roadmap);
      return roadmapIntel.saveArtifact(
        intelContext,
        roadmapId,
        kind,
        `${detail.roadmap.subjectLabel} roadmap`,
        sections,
        {
          provider: String(payload["provider"] ?? "unknown"),
          model: String(payload["model"] ?? "unknown"),
          rejected: (payload["rejected"] ?? []) as {
            section: string;
            line: string;
            reason: string;
          }[],
          ...(brand ? { brand } : {}),
          replaceHumanEdits: replace === true,
        },
      );
    },
    onSettled: () => setStudioStage(null),
    onSuccess: refresh,
    onError: fail,
  });

  /** A human edit to the composed document. Decided truth, so it is protected. */
  const editArtifact = useMutation({
    mutationFn: async ({
      artifact,
      sections,
    }: {
      artifact: RoadmapArtifact;
      sections: ArtifactSection[];
    }) => roadmapIntel.editArtifact(intelContext, artifact, sections),
    onSuccess: refresh,
    onError: fail,
  });


  const walkthrough = useMutation({
    mutationFn: async (
      action:
        | { type: "start" }
        | { type: "capture"; kind: WalkthroughEntryKind; body: string }
        | { type: "end" },
    ) => {
      const intel = intelQuery.data;
      const label = detailQuery.data?.roadmap.subjectLabel ?? "This roadmap";
      const open = intel?.sessions.find((entry) => !entry.endedAt) ?? null;
      if (action.type === "start") {
        return roadmapIntel.startSession(intelContext, roadmapId, label);
      }
      if (!open) throw new Error("No walkthrough is running.");
      if (action.type === "end") return roadmapIntel.endSession(intelContext, open);
      return roadmapIntel.appendEntry(intelContext, open, {
        kind: action.kind,
        body: action.body,
      });
    },
    onSuccess: refresh,
    onError: fail,
  });

  const ask = useMutation({
    mutationFn: async ({ question, research }: { question: string; research: boolean }) => {
      const detail = detailQuery.data;
      const intel = intelQuery.data;
      if (!detail) throw new Error("This roadmap could not be read.");
      setAskError(null);
      const response = await fetch("/api/public/roadmap/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await accessToken()}`,
        },
        body: JSON.stringify({
          organization_id: identity.organizationId,
          subject_label: detail.roadmap.subjectLabel,
          question,
          research,
          context: {
            point_a: detail.roadmap.pointA,
            objective: detail.roadmap.objective,
            research: intel?.research ?? null,
            strategy: intel?.strategy ?? null,
            milestones: intel?.milestones ?? [],
          },
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) throw new Error(String(body["error"] ?? "Roadmap could not answer."));
      return roadmapIntel.saveAnswer(intelContext, roadmapId, {
        question,
        answer: String(body["answer"] ?? ""),
        facts: (body["facts"] ?? []) as { statement: string; sources: never[] }[],
        inferences: (body["inferences"] ?? []) as string[],
        unknowns: (body["unknowns"] ?? []) as string[],
        provider: String(body["provider"] ?? ""),
        model: String(body["model"] ?? ""),
      });
    },
    onSuccess: refresh,
    onError: (error) =>
      setAskError(error instanceof Error ? error.message : "Roadmap could not answer."),
  });

  if (detailQuery.isLoading) {
    return (
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Reading this roadmap…
      </p>
    );
  }

  if (detailQuery.isError) {
    const error = detailQuery.error;
    return (
      <EmptyState
        title="This roadmap could not be read."
        belongsHere="Roadmaps live in the shared Trust Tai backend and are read under your own access."
        whyItMatters={error instanceof Error ? error.message : "An unexpected error stopped the read."}
        action={<BackLink />}
      />
    );
  }

  const detail = detailQuery.data;
  if (!detail) {
    return (
      <EmptyState
        title="That roadmap is not in this workspace."
        belongsHere="Roadmaps are organization-scoped. You only see the ones your organization owns."
        whyItMatters="If you expected it here, it may belong to another organization."
        action={<BackLink />}
      />
    );
  }

  const { roadmap, stages, decisions } = detail;
  const intel = intelQuery.data;
  const unknowns = Array.isArray(roadmap.metadata["unknowns"])
    ? (roadmap.metadata["unknowns"] as string[])
    : [];

  return (
    <div className="space-y-8">
      <BackLink />

      <PageHeader
        appId="roadmap"
        eyebrow={`Roadmap · ${roadmap.subjectLabel}`}
        title={roadmap.title}
        supporting={roadmap.objective}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <MetaPill>{ROADMAP_STATUS_LABEL[roadmap.status]}</MetaPill>
            <TTButton
              variant="secondary"
              disabled={archive.isPending}
              onClick={() => archive.mutate()}
            >
              {roadmap.status === "archived" ? "Reopen" : "Archive"}
            </TTButton>
            {confirmingDelete ? (
              <>
                <TTButton
                  variant="secondary"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  Delete permanently
                </TTButton>
                <TTButton variant="quiet" onClick={() => setConfirmingDelete(false)}>
                  Keep it
                </TTButton>
              </>
            ) : (
              <TTButton variant="quiet" onClick={() => setConfirmingDelete(true)}>
                Delete
              </TTButton>
            )}
          </div>
        }
      />

      {actionError ? <p className="text-sm text-danger">{actionError}</p> : null}

      <RoadmapTabs roadmapId={roadmapId} view={view} />

      {intelQuery.isError ? (
        <p className="text-sm text-destructive">
          {intelQuery.error instanceof Error
            ? intelQuery.error.message
            : "The intelligence layer could not be read."}
        </p>
      ) : null}

      <AskPanel
        subjectLabel={roadmap.subjectLabel}
        answers={intel?.questions ?? []}
        pending={ask.isPending}
        error={askError}
        onAsk={(question, research) => ask.mutate({ question, research })}
      />

      {view === "research" ? (
        <ResearchView
          research={intel?.research ?? null}
          history={intel?.researchHistory ?? []}
          running={research.isPending}
          stage={researchStage}
          error={researchError}
          onRun={() => research.mutate()}
        />
      ) : null}

      {view === "strategy" ? (
        <StrategyView
          strategy={intel?.strategy ?? null}
          busyKey={busyKey}
          generating={research.isPending}
          onGenerate={() => research.mutate()}
          onApproval={(key, state) => approval.mutate({ key, state })}
        />
      ) : null}

      {view === "milestones" ? (
        <MilestonesView
          milestones={intel?.milestones ?? []}
          busyId={busyId}
          generating={research.isPending}
          onGenerate={() => research.mutate()}
          onStatus={(milestone, status, note) =>
            milestoneStatus.mutate({ milestone, status, note })
          }
        />
      ) : null}

      {view === "studio" ? (
        <StudioView
          subjectLabel={detail?.roadmap.subjectLabel ?? ""}
          strategy={intel?.strategy ?? null}
          milestones={intel?.milestones ?? []}
          research={intel?.research ?? null}
          preview={intel?.artifacts.find((entry) => entry.kind === "preview") ?? null}
          full={intel?.artifacts.find((entry) => entry.kind === "full") ?? null}
          busy={compose.isPending || editArtifact.isPending}
          stage={studioStage}
          onCompose={(kind, replace) => compose.mutate({ kind, ...(replace ? { replace } : {}) })}
          onEdit={(artifact, sections) => editArtifact.mutate({ artifact, sections })}
        />

      ) : null}

      {view === "walkthrough" ? (
        <WalkthroughView
          session={intel?.sessions.find((entry) => !entry.endedAt) ?? null}
          history={intel?.sessions ?? []}
          busy={walkthrough.isPending}
          onStart={() => walkthrough.mutate({ type: "start" })}
          onCapture={(kind, body) => walkthrough.mutate({ type: "capture", kind, body })}
          onEnd={() => walkthrough.mutate({ type: "end" })}
        />
      ) : null}

      {view === "build" ? (
        <BuildOrderView
          milestones={intel?.milestones ?? []}
          action={(milestone) => (
            <StartInProjects
              milestone={milestone}
              subjectLabel={roadmap.subjectLabel}
              context={{
                organizationId: identity.organizationId,
                userId: identity.userId,
                userLabel: identity.name,
              }}
            />
          )}
        />
      ) : null}

      {view !== "overview" ? null : (
      <>
      <div className="grid gap-6 lg:grid-cols-2">
        <PointAPanel notes={roadmap.pointA} />
        <PointBPanel
          destination={roadmap.pointB}
          approving={approve.isPending}
          onApprove={() => approve.mutate()}
        />
      </div>

      {unknowns.length > 0 ? (
        <section className="tt-surface p-6" aria-label="What is not established">
          <p className="tt-eyebrow">Not established</p>
          <ul className="mt-3 space-y-1.5">
            {unknowns.map((entry) => (
              <li key={entry} className="text-sm text-muted-foreground">
                — {entry}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="the-walk">
        <SectionHeading
          eyebrow="The walk"
          title="Build order"
          description="Each stage is a step between where this stands and where it is going."
        />
        <StageList
          stages={stages}
          busyId={busyId}
          onState={(stage, state) => stageState.mutate({ stage, state })}
        />
      </section>

      <DecisionPanel
        decisions={decisions}
        busyId={busyId}
        onResolve={(decision, status, note) => resolve.mutate({ decision, status, note })}
      />

      {roadmap.nextMove ? (
        <section className="tt-surface p-6" aria-labelledby="next-move">
          <p className="tt-eyebrow">Next move</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TierChip tier={roadmap.nextMove.tier} />
            <MetaPill>Carried by {roadmap.nextMove.ownerLabel ?? "no one yet"}</MetaPill>
          </div>
          <h2 id="next-move" className="mt-3 font-display text-2xl text-foreground">
            {roadmap.nextMove.action}
          </h2>
          <p className="mt-2 max-w-reading text-sm text-muted-foreground">
            {roadmap.nextMove.because}
          </p>
        </section>
      ) : null}
      </>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/modules/roadmap"
      className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      All roadmaps
    </Link>
  );
}
