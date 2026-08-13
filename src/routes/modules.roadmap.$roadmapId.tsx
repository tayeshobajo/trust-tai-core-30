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
import { TierChip } from "@/components/tt/roadmap/tier";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { roadmapService, type RoadmapContext } from "@/data/supabase/roadmap-service";
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
  component: RoadmapDetailRoute,
});

function RoadmapDetailRoute() {
  const { roadmapId } = Route.useParams();
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <RoadmapWorkspace identity={identity} roadmapId={roadmapId} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function RoadmapWorkspace({
  identity,
  roadmapId,
}: {
  identity: WorkspaceIdentity;
  roadmapId: string;
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
