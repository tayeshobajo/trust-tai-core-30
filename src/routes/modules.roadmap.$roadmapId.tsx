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
import { useMemo, useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { EmptyState } from "@/components/tt/primitives";
import { DecisionPanel } from "@/components/tt/roadmap/decision-panel";
import { RoadmapCompanyHeader } from "@/components/tt/roadmap/detail/header";
import {
  AnchorProofCard,
  CurrentMilestoneCard,
  PathSection,
  PointSummary,
} from "@/components/tt/roadmap/detail/overview";
import {
  ActionsCard,
  ClientCopyCard,
  NextAttentionCard,
  NotesCard,
} from "@/components/tt/roadmap/detail/rail";
import { ExportsView } from "@/components/tt/roadmap/detail/exports-view";
import { EvidenceLinksCard } from "@/components/tt/roadmap/detail/evidence-links";
import {
  ExecutionHandoffCard,
  linkStatusFromProject,
} from "@/components/tt/roadmap/detail/execution-handoff";
import {
  handClientCopyToComms,
  relationshipForRoadmap,
} from "@/data/supabase/roadmap-comms-handoff";
import { projectsService } from "@/data/supabase/projects-service";
import { projectFromMilestone } from "@/data/projects-handoff";
import type { PathMilestone } from "@/data/roadmap/detail/projection";
import type { RoadmapEvidenceInput, RoadmapExport } from "@/domain/roadmap-exports";
import type { ExecutionState } from "@/domain/projects";
import { ActivityView } from "@/components/tt/roadmap/detail/activity-view";
import {
  anchorProof,
  buildExportSnapshot,
  buildMilestonePath,
  currentMilestone,
  exportFreshness,
  nextAttention,
  pathProgress,
} from "@/data/roadmap/detail/projection";
import { nextVersion } from "@/domain/roadmap-exports";
import {
  roadmapExportsService,
  type ExportsContext,
} from "@/data/supabase/roadmap-exports-service";
import { supabaseActivity } from "@/data/supabase/activities";
import { AskPanel } from "@/components/tt/roadmap/ask-panel";
import { BuildOrderView } from "@/components/tt/roadmap/build-order-view";
import { StartInProjects } from "@/components/tt/projects/start-in-projects";
import { MilestonesView } from "@/components/tt/roadmap/milestones-view";
import { ResearchView } from "@/components/tt/roadmap/research-view";
import { isRoadmapView, RoadmapTabs, type RoadmapView } from "@/components/tt/roadmap/roadmap-tabs";
import { StrategyView } from "@/components/tt/roadmap/strategy-view";
import { StudioView } from "@/components/tt/roadmap/studio-view";
import { readRoadmapBrand } from "@/data/supabase/roadmap-brand";
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
import type { DecisionState, RoadmapDecision } from "@/domain/roadmap";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Roadmap workspace · Trust Tai OS";
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

  /* ------------------------------------------ client copies, links, history */

  const exportsContext: ExportsContext = {
    organizationId: identity.organizationId,
    userId: identity.userId,
    userLabel: identity.name,
  };

  const linksQuery = useQuery({
    queryKey: ["roadmap", "links", roadmapId],
    queryFn: () => roadmapExportsService.listLinks(roadmapId),
    retry: false,
  });

  const exportsQuery = useQuery({
    queryKey: ["roadmap", "exports", roadmapId],
    queryFn: () => roadmapExportsService.listExports(roadmapId),
    retry: false,
  });

  const evidenceQuery = useQuery({
    queryKey: ["roadmap", "evidence", roadmapId],
    queryFn: () => roadmapExportsService.listEvidence(roadmapId),
    retry: false,
  });

  const notesQuery = useQuery({
    queryKey: ["roadmap", "notes", roadmapId],
    queryFn: () => roadmapExportsService.listNotes(roadmapId),
    retry: false,
  });

  const activityQuery = useQuery({
    queryKey: ["roadmap", "activity", roadmapId],
    queryFn: () =>
      supabaseActivity.list({
        organizationId: identity.organizationId,
        subjectId: roadmapId,
        limit: 30,
      }),
    retry: false,
  });

  /* Identity is decoration only: a failed read never blocks the page. */
  const brandQuery = useQuery({
    queryKey: ["roadmap", "brand", roadmapId],
    queryFn: async () =>
      detailQuery.data ? await readRoadmapBrand(detailQuery.data.roadmap) : null,
    enabled: Boolean(detailQuery.data),
    retry: false,
  });

  /* Delivery truth is read back from Projects; the roadmap never sets it. */
  const linkedProjectIds = useMemo(
    () =>
      (linksQuery.data?.items ?? [])
        .map((link) => link.projectId)
        .filter((id): id is string => Boolean(id)),
    [linksQuery.data],
  );

  const projectStatesQuery = useQuery({
    queryKey: ["roadmap", "link-projects", roadmapId, linkedProjectIds.join(",")],
    enabled: linkedProjectIds.length > 0,
    retry: false,
    queryFn: async () => {
      const states: Record<string, ExecutionState> = {};
      for (const id of linkedProjectIds) {
        const project = await projectsService.get(id, identity.organizationId);
        if (project) states[id] = project.state;
      }
      return states;
    },
  });

  const milestones = useMemo(() => intelQuery.data?.milestones ?? [], [intelQuery.data]);
  const decisionList = useMemo(() => detailQuery.data?.decisions ?? [], [detailQuery.data]);
  const path = useMemo(
    () => buildMilestonePath(milestones, linksQuery.data?.items ?? [], decisionList),
    [milestones, linksQuery.data, decisionList],
  );
  const progress = useMemo(() => pathProgress(path), [path]);
  const current = useMemo(() => currentMilestone(path), [path]);
  const anchors = useMemo(() => anchorProof(intelQuery.data?.strategy ?? null), [intelQuery.data]);
  const attention = useMemo(
    () => (detailQuery.data ? nextAttention(detailQuery.data.roadmap, path, decisionList) : null),
    [detailQuery.data, path, decisionList],
  );
  const freshness = useMemo(
    () =>
      detailQuery.data
        ? exportFreshness(detailQuery.data.roadmap, exportsQuery.data?.items ?? [])
        : null,
    [detailQuery.data, exportsQuery.data],
  );

  const [sendingId, setSendingId] = useState<string | null>(null);

  /** A client copy is frozen here and never rewritten afterwards. */
  const createExport = useMutation({
    mutationFn: async () => {
      const detail = detailQuery.data;
      if (!detail) throw new Error("This roadmap could not be read.");
      const snapshot = buildExportSnapshot(detail.roadmap, path);
      if (snapshot.milestones.length === 0) {
        throw new Error("No milestone is approved yet, so there is nothing a client should see.");
      }
      return roadmapExportsService.createExport(
        {
          roadmapId,
          version: nextVersion(exportsQuery.data?.items ?? []),
          snapshot,
          subjectLabel: detail.roadmap.subjectLabel,
        },
        exportsContext,
      );
    },
    onSuccess: refresh,
    onError: fail,
  });

  const markSent = useMutation({
    mutationFn: async (exportId: string) => {
      setSendingId(exportId);
      return roadmapExportsService.markSent(exportId, exportsContext);
    },
    onSettled: () => setSendingId(null),
    onSuccess: refresh,
    onError: fail,
  });

  const [handingId, setHandingId] = useState<string | null>(null);
  const [removingEvidenceId, setRemovingEvidenceId] = useState<string | null>(null);

  const addEvidence = useMutation({
    mutationFn: async (input: RoadmapEvidenceInput) =>
      roadmapExportsService.addEvidence(roadmapId, input, exportsContext),
    onSuccess: refresh,
    onError: fail,
  });

  const removeEvidence = useMutation({
    mutationFn: async (id: string) => {
      setRemovingEvidenceId(id);
      return roadmapExportsService.removeEvidence(id, exportsContext);
    },
    onSettled: () => setRemovingEvidenceId(null),
    onSuccess: refresh,
    onError: fail,
  });

  const requestDecision = useMutation({
    mutationFn: async (input: {
      question: string;
      whyItMatters: string;
      options: string[];
      labels: string[];
    }) => {
      const detail = detailQuery.data;
      if (!detail) throw new Error("This roadmap could not be read.");
      return roadmapService.addDecision(
        roadmapId,
        detail.roadmap.subjectLabel,
        {
          question: input.question,
          whyItMatters: input.whyItMatters,
          options: input.options,
          evidence: [],
        },
        context,
        input.labels,
      );
    },
    onSuccess: refresh,
    onError: fail,
  });

  const setLabels = useMutation({
    mutationFn: async ({ decision, labels }: { decision: RoadmapDecision; labels: string[] }) =>
      roadmapService.setDecisionLabels(decision, labels, context),
    onSuccess: refresh,
    onError: fail,
  });

  /**
   * The client copy travels to Comms as a draft that needs human review.
   * Roadmap never sends: the conversation owns delivery.
   */
  const handToComms = useMutation({
    mutationFn: async (entry: RoadmapExport) => {
      const detail = detailQuery.data;
      if (!detail) throw new Error("This roadmap could not be read.");
      setHandingId(entry.id);
      const relationship = await relationshipForRoadmap(detail.roadmap, identity.organizationId);
      if (!relationship) {
        throw new Error(
          "No conversation exists for this company yet. Open one in Comms first, then hand the copy over.",
        );
      }
      const draft = await handClientCopyToComms(entry, relationship, {
        organizationId: identity.organizationId,
        userId: identity.userId,
      });
      await roadmapExportsService.attachComms(
        entry.id,
        { relationshipId: relationship.id, draftId: draft.id },
        exportsContext,
      );
      return relationship.id;
    },
    onSettled: () => setHandingId(null),
    onSuccess: async (relationshipId) => {
      await refresh();
      void relationshipId;
      await navigate({ to: "/modules/comms" });
    },
    onError: fail,
  });

  /**
   * A person confirms which approved milestones move into delivery. Each one
   * opens at most one project, and the link is what the roadmap reads back.
   */
  const confirmHandoff = useMutation({
    mutationFn: async (entries: PathMilestone[]) => {
      const detail = detailQuery.data;
      if (!detail) throw new Error("This roadmap could not be read.");
      for (const entry of entries) {
        const handoff = projectFromMilestone(entry.milestone, detail.roadmap.subjectLabel);
        if (!handoff.ok) throw new Error(handoff.because);
        const project = await projectsService.start(handoff.input, {
          organizationId: identity.organizationId,
          userId: identity.userId,
          userLabel: identity.name,
        });
        await roadmapExportsService.linkExecution(
          {
            roadmapId,
            milestoneId: entry.id,
            owningApp: "projects",
            projectId: project.id,
          },
          exportsContext,
        );
      }
    },
    onSuccess: refresh,
    onError: fail,
  });

  const addNote = useMutation({
    mutationFn: async (noteBody: string) =>
      roadmapExportsService.addNote({ roadmapId, body: noteBody }, exportsContext),
    onSuccess: refresh,
    onError: fail,
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
        whyItMatters={
          error instanceof Error ? error.message : "An unexpected error stopped the read."
        }
        action={<BackLink />}
      />
    );
  }

  const detail = detailQuery.data;
  if (!detail || !attention || !freshness) {
    return (
      <EmptyState
        title="That roadmap is not in this workspace."
        belongsHere="Roadmaps are organization-scoped. You only see the ones your organization owns."
        whyItMatters="If you expected it here, it may belong to another organization."
        action={<BackLink />}
      />
    );
  }

  const { roadmap, decisions } = detail;
  const intel = intelQuery.data;
  const openDecisions = decisions.filter((entry) => entry.status === "open").length;
  const decided = path.filter((entry) => entry.decided).length;
  const exportBlocked =
    decided === 0
      ? "A client copy carries approved milestones only. Approve at least one first."
      : "";

  const projectsContext = {
    organizationId: identity.organizationId,
    userId: identity.userId,
    userLabel: identity.name,
  };

  return (
    <div className="space-y-6">
      <RoadmapCompanyHeader
        roadmap={roadmap}
        identity={{
          logoUrl: brandQuery.data?.logoUrl ?? null,
          themeColor: brandQuery.data?.accent ?? null,
        }}
        progress={progress}
        openDecisions={openDecisions}
        archiving={archive.isPending}
        deleting={remove.isPending}
        onArchive={() => archive.mutate()}
        onDelete={() => remove.mutate()}
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
        <div className="min-w-0 space-y-6">
          {view === "overview" ? (
            <>
              <PointSummary
                roadmap={roadmap}
                approving={approve.isPending}
                onApprove={() => approve.mutate()}
              />
              <PathSection path={path} activeId={current?.id ?? null} />
              <CurrentMilestoneCard
                entry={current}
                action={
                  current?.decided ? (
                    <StartInProjects
                      milestone={current.milestone}
                      subjectLabel={roadmap.subjectLabel}
                      context={projectsContext}
                    />
                  ) : null
                }
              />
              <AnchorProofCard lines={anchors} />
            </>
          ) : null}

          {view === "milestones" ? (
            <>
              <PathSection path={path} activeId={current?.id ?? null} />
              <MilestonesView
                milestones={milestones}
                busyId={busyId}
                generating={research.isPending}
                onGenerate={() => research.mutate()}
                onStatus={(milestone, status, note) =>
                  milestoneStatus.mutate({ milestone, status, note })
                }
              />
              <ExecutionHandoffCard
                path={path}
                links={linksQuery.data?.items ?? []}
                available={linksQuery.data?.available ?? false}
                busy={confirmHandoff.isPending}
                projectStates={projectStatesQuery.data ?? {}}
                onConfirm={(entries) => confirmHandoff.mutate(entries)}
              />
              <BuildOrderView
                milestones={milestones}
                action={(milestone) => (
                  <StartInProjects
                    milestone={milestone}
                    subjectLabel={roadmap.subjectLabel}
                    context={projectsContext}
                  />
                )}
              />
            </>
          ) : null}

          {view === "evidence" ? (
            <>
              <EvidenceLinksCard
                items={evidenceQuery.data?.items ?? []}
                available={evidenceQuery.data?.available ?? false}
                saving={addEvidence.isPending}
                removingId={removingEvidenceId}
                onAdd={(input) => addEvidence.mutate(input)}
                onRemove={(id) => removeEvidence.mutate(id)}
              />
              <AskPanel
                subjectLabel={roadmap.subjectLabel}
                answers={intel?.questions ?? []}
                pending={ask.isPending}
                error={askError}
                onAsk={(question, researchFirst) =>
                  ask.mutate({ question, research: researchFirst })
                }
              />
              <ResearchView
                research={intel?.research ?? null}
                history={intel?.researchHistory ?? []}
                running={research.isPending}
                stage={researchStage}
                error={researchError}
                onRun={() => research.mutate()}
              />
              <StrategyView
                strategy={intel?.strategy ?? null}
                busyKey={busyKey}
                generating={research.isPending}
                onGenerate={() => research.mutate()}
                onApproval={(key, state) => approval.mutate({ key, state })}
              />
            </>
          ) : null}

          {view === "decisions" ? (
            <DecisionPanel
              decisions={decisions}
              busyId={busyId}
              requesting={requestDecision.isPending}
              onResolve={(decision, status, note) => resolve.mutate({ decision, status, note })}
              onRequest={(input) => requestDecision.mutate(input)}
              onLabels={(decision, labels) => setLabels.mutate({ decision, labels })}
            />
          ) : null}

          {view === "exports" ? (
            <>
              <ExportsView
                exports={exportsQuery.data?.items ?? []}
                available={exportsQuery.data?.available ?? false}
                canExport={decided > 0}
                blockedBecause={exportBlocked}
                creating={createExport.isPending}
                sendingId={sendingId}
                handingId={handingId}
                onCreate={() => createExport.mutate()}
                onMarkSent={(exportId) => markSent.mutate(exportId)}
                onHandToComms={(entry) => handToComms.mutate(entry)}
              />
              <StudioView
                subjectLabel={roadmap.subjectLabel}
                strategy={intel?.strategy ?? null}
                milestones={milestones}
                research={intel?.research ?? null}
                preview={intel?.artifacts.find((entry) => entry.kind === "preview") ?? null}
                full={intel?.artifacts.find((entry) => entry.kind === "full") ?? null}
                busy={compose.isPending || editArtifact.isPending}
                stage={studioStage}
                onCompose={(kind, replace) =>
                  compose.mutate({ kind, ...(replace ? { replace } : {}) })
                }
                onEdit={(artifact, sections) => editArtifact.mutate({ artifact, sections })}
              />
            </>
          ) : null}

          {view === "activity" ? (
            <>
              <ActivityView
                events={activityQuery.data ?? []}
                loading={activityQuery.isLoading}
                error={activityQuery.error instanceof Error ? activityQuery.error.message : null}
              />
              <WalkthroughView
                session={intel?.sessions.find((entry) => !entry.endedAt) ?? null}
                history={intel?.sessions ?? []}
                busy={walkthrough.isPending}
                onStart={() => walkthrough.mutate({ type: "start" })}
                onCapture={(kind, entryBody) =>
                  walkthrough.mutate({ type: "capture", kind, body: entryBody })
                }
                onEnd={() => walkthrough.mutate({ type: "end" })}
              />
            </>
          ) : null}
        </div>

        <aside className="space-y-4" aria-label="Roadmap actions and attention">
          <NextAttentionCard attention={attention} />
          <ActionsCard
            researching={research.isPending}
            composing={compose.isPending}
            exporting={createExport.isPending}
            canExport={decided > 0}
            exportBlockedBecause={exportBlocked}
            onResearch={() => research.mutate()}
            onCompose={() => compose.mutate({ kind: "preview" })}
            onExport={() => createExport.mutate()}
          />
          <ClientCopyCard freshness={freshness} />
          <NotesCard
            notes={notesQuery.data?.items ?? []}
            available={notesQuery.data?.available ?? false}
            saving={addNote.isPending}
            onAdd={(noteBody) => addNote.mutate(noteBody)}
          />
        </aside>
      </div>
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
