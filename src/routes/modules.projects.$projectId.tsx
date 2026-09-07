/**
 * The delivery room for one approved roadmap milestone.
 *
 * It answers four things without scrolling: what we are building, why we are
 * building it, what is happening now, and what is stopping it from moving.
 * The chain Company → Roadmap → Milestone → Project → Delivery → Outcome stays
 * visible, because execution without lineage is just activity.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { EmptyState, TTButton } from "@/components/tt/primitives";
import { LaunchOpsButton } from "@/components/tt/ops/launch-ops";
import { RouteWork } from "@/components/tt/projects/route-work";
import {
  OutcomeStrip,
  PROJECT_TABS,
  ProjectIdentityHeader,
  ProjectTabs,
  UtilityRow,
  type ProjectTab,
} from "@/components/tt/projects/detail/frame";
import { OverviewTab } from "@/components/tt/projects/detail/overview";
import { AssetsTab, ContextTab, KnowledgeTab } from "@/components/tt/projects/detail/intelligence";
import { DetailRail } from "@/components/tt/projects/detail/rail";
import { ManageProjectPanel } from "@/components/tt/projects/detail/manage-panel";
import {
  ActivityTab,
  BlockersTab,
  DecisionsTab,
  FilesTab,
  WorkTab,
} from "@/components/tt/projects/detail/sections";
import { buildProjectContextPacket, contextHealth } from "@/data/projects/context-packet";
import { projectSuggestions } from "@/data/projects/suggestions";
import { projectIntelligence } from "@/data/supabase/project-intelligence";
import type { AssetType } from "@/domain/project-intelligence";
import {
  completionModel,
  healthSignals,
  needsJudgment,
  peopleOnProject,
} from "@/data/projects/detail-projection";
import { buildProjectRow, lineageSourcesFrom } from "@/data/projects/index-projection";
import { projectDelivery, type DeliveryContext } from "@/data/supabase/project-delivery";
import { readRoadmapBrand } from "@/data/supabase/roadmap-brand";
import { roadmapService } from "@/data/supabase/roadmap-service";
import { roadmapIntel, type IntelContext } from "@/data/supabase/roadmap-intel-service";
import { approvalsService } from "@/data/supabase/approvals-service";
import { ProjectRoadmapTab } from "@/components/tt/projects/detail/roadmap";
import { ProjectApprovals } from "@/components/tt/projects/detail/approvals";
import { linkableRoadmaps } from "@/domain/project-roadmap-link";
import type { ManualMilestoneInput } from "@/domain/milestone-create";
import type { OutcomeMetricInput } from "@/domain/milestone-metric";
import type { MilestoneStatus, RoadmapMilestone } from "@/domain/roadmap-intel";

import { supabaseActivity } from "@/data/supabase/activities";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { projectsService, type ProjectsContext } from "@/data/supabase/projects-service";
import { checkOwnerAssignment, isOpenProject } from "@/domain/projects";

import type { ProjectFileKind, WorkItemStatus } from "@/domain/project-delivery";
import { workspaceAccess, type WorkspaceIdentity } from "@/lib/workspace";
import {
  ChatTab,
  type ChatEntry,
  type ProjectChatAnswer,
  type ProposalState,
} from "@/components/tt/projects/detail/chat";
import {
  alreadyApplied,
  prepareProposal,
  receiptFor,
  staleReason,
  type ChatChangeIntent,
  type OtherRoom,
} from "@/domain/project-chat-proposal";

import { listMembers } from "@/data/supabase/settings-service";
import { supabase } from "@/integrations/trust-tai/supabase";

export const Route = createFileRoute("/modules/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Delivery room · Projects · Trust Tai OS" },
      {
        name: "description",
        content:
          "One approved milestone in delivery: outcome, current work, blockers, decisions and lineage back to the roadmap.",
      },
      { property: "og:title", content: "Delivery room · Projects · Trust Tai OS" },
      {
        property: "og:description",
        content:
          "One approved milestone in delivery: outcome, current work, blockers, decisions and lineage back to the roadmap.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProjectRoute,
});

function ProjectRoute() {
  const { projectId } = Route.useParams();
  return (
    <WorkspaceGate appId="projects">
      {(identity) => (
        <AppShell identity={identity}>
          <DeliveryRoom identity={identity} projectId={projectId} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function DeliveryRoom({ identity, projectId }: { identity: WorkspaceIdentity; projectId: string }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ProjectTab>("overview");
  const [updating, setUpdating] = useState(false);
  /** Set after a save lands, so a change visibly confirms instead of just vanishing. */
  const [savedLabel, setSavedLabel] = useState<string | null>(null);

  const [fileError, setFileError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  // The conversation is session scoped, and the panel says so. Proposals live
  // here too: they are a reading of a message, never a store.
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  const org = identity.organizationId;
  const projectsContext: ProjectsContext = {
    organizationId: org,
    userId: identity.userId,
    userLabel: identity.name,
  };

  const projectQuery = useQuery({
    queryKey: ["projects", "detail", projectId, org],
    queryFn: () => projectsService.get(projectId, org),
    retry: false,
  });
  const allProjectsQuery = useQuery({
    queryKey: ["projects", "list", org],
    queryFn: () => projectsService.list(org),
    retry: false,
  });
  const roadmapsQuery = useQuery({
    queryKey: ["projects", "roadmaps", org],
    queryFn: () => roadmapService.list(org),
    retry: false,
  });
  const stagesQuery = useQuery({
    queryKey: ["projects", "stages", org],
    queryFn: () => roadmapService.stagesByRoadmap(org),
    retry: false,
  });

  const project = projectQuery.data ?? null;

  const delivery: DeliveryContext = {
    organizationId: org,
    projectId,
    projectName: project?.name ?? "Project",
    userId: identity.userId,
    userLabel: identity.name,
  };

  const enabled = Boolean(project);
  const workQuery = useQuery({
    queryKey: ["delivery", "work", projectId, org],
    queryFn: () => projectDelivery.listWork(delivery),
    enabled,
    retry: false,
  });
  const blockersQuery = useQuery({
    queryKey: ["delivery", "blockers", projectId, org],
    queryFn: () => projectDelivery.listBlockers(delivery),
    enabled,
    retry: false,
  });
  const decisionsQuery = useQuery({
    queryKey: ["delivery", "decisions", projectId, org],
    queryFn: () => projectDelivery.listDecisions(delivery),
    enabled,
    retry: false,
  });
  const filesQuery = useQuery({
    queryKey: ["delivery", "files", projectId, org],
    queryFn: () => projectDelivery.listFiles(delivery),
    enabled,
    retry: false,
  });
  const activityQuery = useQuery({
    queryKey: ["delivery", "activity", projectId, org],
    queryFn: () =>
      supabaseActivity.list({
        organizationId: org,
        subjectType: "project",
        subjectId: projectId,
        limit: 40,
      }),
    enabled,
    retry: false,
  });

  const thinkingQuery = useQuery({
    queryKey: ["delivery", "thinking", projectId, org],
    queryFn: () => projectIntelligence.listThinking(delivery),
    enabled,
    retry: false,
  });
  const knowledgeQuery = useQuery({
    queryKey: ["delivery", "knowledge", projectId, org],
    queryFn: () => projectIntelligence.listKnowledge(delivery),
    enabled,
    retry: false,
  });
  const assetsQuery = useQuery({
    queryKey: ["delivery", "assets", projectId, org],
    queryFn: () => projectIntelligence.listAssets(delivery),
    enabled,
    retry: false,
  });
  const connectionsQuery = useQuery({
    queryKey: ["delivery", "connections", projectId, org],
    queryFn: () => projectIntelligence.listConnections(delivery),
    enabled,
    retry: false,
  });
  // Who this work can be handed to: active members of this workspace, read
  // under the signed-in person's own access. Never a free text name.
  const membersQuery = useQuery({
    queryKey: ["delivery", "members", org],
    queryFn: () => listMembers(org),
    retry: false,
  });
  const assignableMembers = useMemo(
    () =>
      (membersQuery.data ?? [])
        .filter((member) => member.status === "active")
        .map((member) => ({ userId: member.userId, name: member.name || member.email })),
    [membersQuery.data],
  );

  const roadmaps = roadmapsQuery.data ?? [];
  const row = useMemo(
    () =>
      project
        ? buildProjectRow(project, lineageSourcesFrom(roadmaps, stagesQuery.data ?? {}))
        : null,
    [project, roadmaps, stagesQuery.data],
  );

  const roadmap = row?.lineage.roadmapId
    ? (roadmaps.find((entry) => entry.id === row.lineage.roadmapId) ?? null)
    : null;

  /**
   * Roadmap truth, read where the work is. Milestone writes below all call the
   * Roadmap service: Projects never stores a milestone of its own.
   */
  const intelContext: IntelContext = {
    organizationId: org,
    userId: identity.userId,
    userLabel: identity.name,
  };
  const intelQuery = useQuery({
    queryKey: ["roadmap", "intel", roadmap?.id ?? "none"],
    queryFn: () => roadmapIntel.load(roadmap!.id),
    enabled: Boolean(roadmap),
    retry: false,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const refreshRoadmap = async () => {
    await queryClient.invalidateQueries({ queryKey: ["roadmap"] });
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  const linkRoadmap = useMutation({
    mutationFn: async (roadmapId: string) => {
      setLinkError(null);
      const chosen = roadmaps.find((entry) => entry.id === roadmapId);
      if (!project || !chosen) throw new Error("That roadmap could not be read.");
      return projectsService.linkRoadmap(project, chosen, projectsContext);
    },
    onSuccess: refreshRoadmap,
    onError: (cause) =>
      setLinkError(cause instanceof Error ? cause.message : "That roadmap could not be linked."),
  });

  const milestoneCreate = useMutation({
    mutationFn: async (input: ManualMilestoneInput) => {
      setCreateError(null);
      if (!roadmap) throw new Error("No roadmap is linked to this project.");
      return roadmapIntel.createManualMilestone(
        intelContext,
        roadmap.id,
        roadmap.subjectLabel,
        input,
        intelQuery.data?.milestones ?? [],
      );
    },
    onSuccess: refreshRoadmap,
    onError: (cause) =>
      setCreateError(cause instanceof Error ? cause.message : "The milestone could not be saved."),
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
        roadmap?.subjectLabel ?? "This roadmap",
        note || undefined,
      );
    },
    onSettled: () => setBusyId(null),
    onSuccess: refreshRoadmap,
  });

  const milestoneMetric = useMutation({
    mutationFn: async ({
      milestone,
      metric,
    }: {
      milestone: RoadmapMilestone;
      metric: OutcomeMetricInput | null;
    }) => {
      setBusyId(milestone.id);
      return roadmapIntel.setMilestoneMetric(
        intelContext,
        milestone,
        metric,
        roadmap?.subjectLabel ?? "This roadmap",
      );
    },
    onSettled: () => setBusyId(null),
    onSuccess: refreshRoadmap,
  });

  const linkCandidates = useMemo(
    () => (project ? linkableRoadmaps(project, roadmaps) : []),
    [project, roadmaps],
  );

  /** Decisions Approvals is holding for this work. Read only, decided there. */
  const approvalsQuery = useQuery({
    queryKey: ["delivery", "approvals", projectId, org],
    queryFn: () =>
      approvalsService.listForEntities({ organizationId: org, userId: identity.userId }, [
        projectId,
        ...(roadmap ? [roadmap.id] : []),
      ]),
    enabled,
    retry: false,
  });

  const brandQuery = useQuery({

    queryKey: ["delivery", "brand", roadmap?.id ?? "none"],
    queryFn: () => (roadmap ? readRoadmapBrand(roadmap) : Promise.resolve(null)),
    enabled: Boolean(roadmap),
    retry: false,
  });

  const items = workQuery.data ?? [];
  const blockers = blockersQuery.data ?? [];
  const decisions = decisionsQuery.data ?? [];
  const files = filesQuery.data ?? [];
  const thinking = thinkingQuery.data ?? [];
  const knowledge = knowledgeQuery.data ?? [];
  const assets = assetsQuery.data ?? [];
  const connections = connectionsQuery.data ?? [];

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["delivery"] });
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  const mutate = useMutation({
    mutationFn: async (run: () => Promise<unknown>) => run(),
    onSuccess: refresh,
  });

  const updateProject = useMutation({
    mutationFn: (changes: Parameters<typeof projectsService.update>[1]) => {
      if (!project) throw new Error("This project is no longer readable.");
      return projectsService.update(project, changes, projectsContext);
    },
    onMutate: () => setSavedLabel(null),
    onSuccess: async () => {
      setSavedLabel("Saved.");
      await refresh();
    },
  });

  const entryId = () => `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /**
   * One message. "ask" answers from this project's packet. "change" reads the
   * message and prepares a bounded proposal. Both are read only: the endpoint
   * reads under the caller's own session and writes nothing, so every real
   * change still goes through the Projects service after a person approves.
   */
  const sendChat = useMutation({
    mutationFn: async ({
      message,
      pasted,
      mode,
      pendingId,
    }: {
      message: string;
      pasted: string;
      mode: "ask" | "change";
      pendingId: string;
    }) => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Your session expired. Sign in again to ask.");
      const response = await fetch("/api/public/projects/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organization_id: org,
          project_id: projectId,
          question: message,
          pasted,
          mode: mode === "change" ? "prepare" : "ask",
          members: assignableMembers.map((member) => member.name),
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) throw new Error(String(body["error"] ?? "This project could not answer."));
      return { body, mode, message, pendingId };
    },
    onSuccess: ({ body, mode, message, pendingId }) => {
      const resolve = (entry: ChatEntry): ChatEntry => {
        if (mode === "ask") {
          return {
            ...entry,
            pending: false,
            answer: body as unknown as ProjectChatAnswer,
          };
        }
        const kind = String(body["kind"] ?? "unclear");
        const because = String(body["because"] ?? "").trim();
        if (kind === "other_room") {
          return {
            ...entry,
            pending: false,
            room: body["room"] as OtherRoom,
            text: because || "That truth belongs to another room.",
          };
        }
        if (kind !== "change" || !project) {
          return {
            ...entry,
            pending: false,
            text:
              because ||
              "That is not a change Projects can make from here. Say what should change, and what it should say.",
          };
        }
        const intent: ChatChangeIntent = {
          action: String(body["action"] ?? "") as ChatChangeIntent["action"],
          ...(body["value"] ? { value: String(body["value"]) } : {}),
          ...(Array.isArray(body["items"]) ? { items: body["items"] as string[] } : {}),
          ...(body["source"]
            ? { source: body["source"] as NonNullable<ChatChangeIntent["source"]> }
            : {}),
          ...(body["reason"] ? { reason: String(body["reason"]) } : {}),
        };
        // An owner is a member of this workspace, resolved here against the
        // people this person can actually see. Never a name the model invented.
        if (intent.action === "owner") {
          const wanted = (intent.value ?? "").trim().toLowerCase();
          const match = assignableMembers.find(
            (member) => member.name.trim().toLowerCase() === wanted,
          );
          if (!match) {
            return {
              ...entry,
              pending: false,
              text: `Nobody in this workspace is called "${intent.value ?? ""}". Hand it to someone who is a member, or invite them first.`,
            };
          }
          intent.owner = { userId: match.userId, label: match.name };
        }
        const prepared = prepareProposal(project, intent, message);
        if (!prepared.ok) {
          return {
            ...entry,
            pending: false,
            text: prepared.because,
            ...(prepared.room ? { room: prepared.room } : {}),
          };
        }
        return { ...entry, pending: false, proposal: prepared.proposal, proposalState: "open" };
      };
      setChatEntries((entries) =>
        entries.map((entry) => (entry.id === pendingId ? resolve(entry) : entry)),
      );
    },
    onError: (cause: unknown, variables) => {
      setChatError(cause instanceof Error ? cause.message : "This project could not answer.");
      setChatEntries((entries) => entries.filter((entry) => entry.id !== variables.pendingId));
    },
  });

  const onSendChat = (message: string, pasted: string, mode: "ask" | "change") => {
    setChatError(null);
    const pendingId = entryId();
    setChatEntries((entries) => [
      ...entries,
      { id: entryId(), role: "you", text: message, ...(pasted ? { pasted } : {}) },
      { id: pendingId, role: "project", pending: true },
    ]);
    sendChat.mutate({ message, pasted, mode, pendingId });
  };

  const settle = (id: string, state: ProposalState, outcome: string) =>
    setChatEntries((entries) =>
      entries.map((entry) =>
        entry.id === id ? { ...entry, proposalState: state, outcome } : entry,
      ),
    );

  /**
   * The only place Chat writes. It re-reads the project first, refuses a
   * proposal prepared against truth that has since moved, and does nothing at
   * all if the record already says what was proposed.
   */
  const approveProposal = async (id: string) => {
    const entry = chatEntries.find((candidate) => candidate.id === id);
    const proposal = entry?.proposal;
    if (!proposal || entry?.proposalState !== "open" || applying) return;
    setApplying(id);
    setChatError(null);
    try {
      const fresh = await projectsService.get(projectId, org);
      if (!fresh) throw new Error("This project is no longer readable.");
      const stale = staleReason(proposal, fresh);
      if (stale) {
        settle(id, "stale", stale);
        return;
      }
      if (alreadyApplied(proposal, fresh)) {
        settle(id, "applied", "The record already says this. Nothing was written twice.");
        return;
      }
      if (proposal.source) {
        await projectIntelligence.addThinking(proposal.source, delivery);
      } else if (proposal.changes) {
        await projectsService.update(fresh, proposal.changes, projectsContext);
      }
      await refresh();
      settle(id, "applied", receiptFor(proposal));
    } catch (cause) {
      settle(
        id,
        "open",
        cause instanceof Error ? cause.message : "That change could not be recorded.",
      );
      setChatError(cause instanceof Error ? cause.message : "That change could not be recorded.");
    } finally {
      setApplying(null);
    }
  };

  if (projectQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Reading this work…</p>;
  }

  if (projectQuery.isError || !project || !row) {
    return (
      <EmptyState
        title="That project could not be read."
        belongsHere="Delivery lives in the shared Trust Tai backend, read under your own access."
        whyItMatters={
          projectQuery.error instanceof Error
            ? projectQuery.error.message
            : "It may have been closed, or it belongs to another organization."
        }
        action={
          <TTButton asChild variant="secondary">
            <Link to="/modules/projects">Back to Projects</Link>
          </TTButton>
        }
      />
    );
  }

  const siblings = (allProjectsQuery.data ?? []).filter(
    (entry) => entry.origin.subjectLabel === project.origin.subjectLabel,
  );
  const position = siblings.findIndex((entry) => entry.id === project.id);
  const previous =
    position > 0 && siblings[position - 1]
      ? { id: siblings[position - 1]!.id, name: siblings[position - 1]!.name }
      : null;
  const next =
    position >= 0 && siblings[position + 1]
      ? { id: siblings[position + 1]!.id, name: siblings[position + 1]!.name }
      : null;

  const completion = completionModel(project, items, row.lineage.milestoneName);
  const packet = buildProjectContextPacket({
    project,
    ...(row.lineage.company ? { company: row.lineage.company } : {}),
    roadmap: {
      ...(row.lineage.roadmapId ? { roadmapId: row.lineage.roadmapId } : {}),
      ...(row.lineage.milestoneId ? { milestoneId: row.lineage.milestoneId } : {}),
      ...(row.lineage.milestoneName ? { milestoneName: row.lineage.milestoneName } : {}),
    },
    knowledge,
    decisions,
    blockers,
    work: items,
    assets,
    connections,
    thinking,
  });
  const health = contextHealth(
    packet,
    assets.some((asset) => asset.assetType === "mockup"),
  );
  const suggestions = projectSuggestions({ packet, work: items, assets, dismissed });
  const attention = needsJudgment(project, items, blockers, decisions);
  const busy = mutate.isPending || updateProject.isPending;
  const error = mutate.error ?? updateProject.error;
  const errorMessage = fileError
    ? fileError
    : error
      ? error instanceof Error
        ? error.message
        : "That change could not be saved."
      : null;

  /**
   * Older tabs are now sections. Opening one opens the surface that owns it and
   * scrolls to it, so nothing that used to be reachable became unreachable.
   */
  const openTab = (section: ProjectSection) => {
    setTab(surfaceForSection(section));
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      document.getElementById(sectionAnchor(section))?.scrollIntoView({ behavior: "smooth" });
    });
  };


  return (
    <div className="space-y-6">
      <UtilityRow row={row} previous={previous} next={next} />

      <ProjectIdentityHeader
        row={row}
        brand={brandQuery.data ?? null}
        updatedLabel={new Date(project.updatedAt).toLocaleDateString()}
        busy={busy}
        savedLabel={updating ? null : savedLabel}
        onRename={(name) => updateProject.mutate({ name })}
        onUpdate={() => {
          setSavedLabel(null);
          setUpdating((open) => !open);
        }}
      />

      {updating ? (
        <ManageProjectPanel
          project={project}
          busy={busy}
          savedLabel={savedLabel}
          onUpdate={(changes) => updateProject.mutate(changes)}
        />
      ) : null}

      <OutcomeStrip outcome={completion.outcome} />

      <ProjectTabs
        tab={tab}
        counts={{
          overview: blockers.filter((entry) => entry.status === "open").length,
          roadmap: intelQuery.data?.milestones.length ?? 0,
          files: files.length + assets.length,
        }}

        onChange={setTab}
      />

      {errorMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {tab === "overview" ? (
            <div className="space-y-6">
              <OverviewTab
                project={project}
                lineage={row.lineage}
                items={items}
                blockers={blockers}
                completion={completion}
                onOpenTab={openTab}
              />
              <ProjectApprovals requests={approvalsQuery.data ?? []} />
            </div>
          ) : null}

          {tab === "roadmap" ? (
            <ProjectRoadmapTab
              roadmap={roadmap}
              milestones={intelQuery.data?.milestones ?? []}
              loading={intelQuery.isLoading}
              candidates={linkCandidates}
              linking={linkRoadmap.isPending}
              linkError={linkError}
              busyId={busyId}
              creating={milestoneCreate.isPending}
              createError={createError}
              onLink={(roadmapId) => linkRoadmap.mutate(roadmapId)}
              onCreate={(input) => milestoneCreate.mutate(input)}
              onStatus={(milestone, status, note) =>
                milestoneStatus.mutate({ milestone, status, note })
              }
              onMetric={(milestone, metric) => milestoneMetric.mutate({ milestone, metric })}
            />
          ) : null}



          {tab === "context" ? (
            <ContextTab
              packet={packet}
              health={health}
              suggestions={suggestions}
              thinking={thinking}
              connections={connections}
              busy={busy}
              onAddThinking={(input) =>
                mutate.mutate(() => projectIntelligence.addThinking(input, delivery))
              }
              onPrimaryThinking={(source) =>
                mutate.mutate(() => projectIntelligence.markPrimaryThinking(source, delivery))
              }
              onRemoveThinking={(source) =>
                mutate.mutate(() => projectIntelligence.removeThinking(source, delivery))
              }
              onImportThinking={(source, text) =>
                mutate.mutate(() => projectIntelligence.importThinking(source, text, delivery))
              }

              onAddConnection={(input) =>
                mutate.mutate(() => projectIntelligence.addConnection(input, delivery))
              }
              onRemoveConnection={(connection) =>
                mutate.mutate(() => projectIntelligence.removeConnection(connection, delivery))
              }
              onDismissSuggestion={(id) => setDismissed((current) => [...current, id])}
            />
          ) : null}

          {tab === "knowledge" ? (
            <KnowledgeTab
              knowledge={knowledge}
              busy={busy}
              onAdd={(input) =>
                mutate.mutate(() => projectIntelligence.addKnowledge(input, delivery))
              }
              onConfirm={(item) =>
                mutate.mutate(() =>
                  projectIntelligence.setKnowledgeReview(item, "confirmed", delivery),
                )
              }
              onSupersede={(item) =>
                mutate.mutate(() =>
                  projectIntelligence.setKnowledgeReview(item, "superseded", delivery),
                )
              }
            />
          ) : null}

          {tab === "assets" ? (
            <AssetsTab
              assets={assets}
              items={items}
              busy={busy}
              onUpload={(file, assetType: AssetType, workItemId) =>
                mutate.mutate(() =>
                  projectIntelligence.uploadAsset(
                    file,
                    { assetType, ...(workItemId ? { workItemId } : {}) },
                    delivery,
                  ),
                )
              }
              onStatus={(asset, status) =>
                mutate.mutate(() => projectIntelligence.setAssetStatus(asset, status, delivery))
              }
              onOpen={(asset, download) => {
                setFileError(null);
                const linked = files.find((entry) => entry.id === asset.fileId);
                if (!linked) {
                  setFileError("That asset file is no longer readable.");
                  return;
                }
                void projectDelivery
                  .fileUrl(linked, download)
                  .then((url) => window.open(url, "_blank", "noopener,noreferrer"))
                  .catch((cause: unknown) => {
                    setFileError(
                      cause instanceof Error ? cause.message : "That asset could not be opened.",
                    );
                  });
              }}
            />
          ) : null}

          {tab === "work" ? (
            <div className="space-y-5">
              <WorkTab
                items={items}
                busy={busy}
                onAdd={(title) =>
                  mutate.mutate(() =>
                    projectDelivery.addWork({ title, sequence: items.length }, delivery),
                  )
                }
                onMove={(item, status: WorkItemStatus) =>
                  mutate.mutate(() => projectDelivery.moveWork(item, status, delivery))
                }
              />
              {isOpenProject(project) ? (
                <>
                  <section aria-label="Technical stewardship" className="tt-surface space-y-3 p-6">
                    <p className="tt-eyebrow">Ops</p>
                    <p className="max-w-reading text-[15px] text-foreground">
                      Ops runs the technical work for this project. Your session is handed over
                      securely and this project&apos;s id travels with it.
                    </p>
                    <LaunchOpsButton
                      variant="secondary"
                      label="Open in Ops"
                      organizationId={org}
                      returnContext="project"
                      canonicalProjectId={project.id}
                    />
                  </section>
                  <RouteWork
                    project={project}
                    context={projectsContext}
                    access={workspaceAccess(identity)}
                  />
                </>
              ) : null}
            </div>
          ) : null}

          {tab === "blockers" ? (
            <BlockersTab
              items={items}
              blockers={blockers}
              busy={busy}
              onRaise={(input) =>
                mutate.mutate(() => projectDelivery.raiseBlocker(input, delivery))
              }
              onResolve={(blocker, resolution, resumeWork) =>
                mutate.mutate(async () => {
                  const saved = await projectDelivery.resolveBlocker(blocker, resolution, delivery);
                  // Clearing a blocker may put its work item back in motion. Roadmap
                  // truth is untouched: only the delivery record moves.
                  const linked = blocker.workItemId
                    ? items.find((entry) => entry.id === blocker.workItemId)
                    : undefined;
                  if (resumeWork && linked && linked.status === "blocked") {
                    await projectDelivery.moveWork(linked, "in_progress", delivery);
                  }
                  return saved;
                })
              }
            />
          ) : null}

          {tab === "decisions" ? (
            <DecisionsTab
              items={items}
              decisions={decisions}
              busy={busy}
              onAsk={(input) => mutate.mutate(() => projectDelivery.askDecision(input, delivery))}
              onAnswer={(decision, answer) =>
                mutate.mutate(() => projectDelivery.answerDecision(decision, answer, delivery))
              }
            />
          ) : null}

          {tab === "files" ? (
            <FilesTab
              items={items}
              files={files}
              busy={busy}
              onUpload={(file, kind: ProjectFileKind, workItemId) =>
                mutate.mutate(() =>
                  projectDelivery.uploadFile(
                    file,
                    { kind, ...(workItemId ? { workItemId } : {}) },
                    delivery,
                  ),
                )
              }
              onOpen={(file, download) => {
                setFileError(null);
                void projectDelivery
                  .fileUrl(file, download)
                  .then((url) => {
                    if (download) {
                      const anchor = document.createElement("a");
                      anchor.href = url;
                      anchor.download = file.name;
                      anchor.rel = "noopener";
                      document.body.appendChild(anchor);
                      anchor.click();
                      anchor.remove();
                      return;
                    }
                    window.open(url, "_blank", "noopener,noreferrer");
                  })
                  .catch((cause: unknown) => {
                    setFileError(
                      cause instanceof Error ? cause.message : "That file could not be opened.",
                    );
                  });
              }}
            />
          ) : null}

          {tab === "activity" ? <ActivityTab events={activityQuery.data ?? []} /> : null}

          {tab === "chat" ? (
            <ChatTab
              projectName={project.name}
              entries={chatEntries}
              pending={sendChat.isPending}
              applying={applying}
              error={chatError}
              onSend={onSendChat}
              onApprove={(id) => void approveProposal(id)}
              onDiscard={(id) => settle(id, "discarded", "Discarded. Nothing was changed.")}
            />
          ) : null}
        </div>

        <DetailRail
          ownerLabel={row.ownerLabel}
          owner={{
            userId: project.ownerUserId ?? null,
            label: project.ownerLabel ?? row.ownerLabel,
          }}
          members={assignableMembers}
          unassignRefusal={
            checkOwnerAssignment(project, {}).ok ? null : checkOwnerAssignment(project, {}).because
          }
          onAssign={(nextOwner) => updateProject.mutate(nextOwner)}
          attention={attention}

          signals={healthSignals(project, items, blockers)}
          people={peopleOnProject(project, items)}
          lineage={row.lineage}
          busy={busy}
          onOpenTab={openTab}
          onAddWork={() => setTab("work")}
          onRaiseBlocker={() => setTab("blockers")}
          onAskDecision={() => setTab("decisions")}
          onComplete={() => updateProject.mutate({ state: "delivered" })}
        />
      </div>

      <p className="text-[13px] text-muted-foreground">
        {PROJECT_TABS.length} sections, one record. Everything here is written to the shared
        activity stream so Pulse and Ask Trust Tai read the same truth.
      </p>
    </div>
  );
}
