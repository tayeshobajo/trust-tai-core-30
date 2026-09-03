/**
 * Roadmap → Projects, in one action.
 *
 * The guarantee is the same as every other room boundary in Trust Tai: a
 * milestone has at most one project. Pressing this twice opens the same work
 * rather than starting a second one. A milestone that is not Decided is
 * refused here with the reason, out loud, instead of silently doing nothing.
 */

import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";

import { TTButton } from "@/components/tt/primitives";
import { projectFromMilestone } from "@/data/projects-handoff";
import { projectsService, type ProjectsContext } from "@/data/supabase/projects-service";
import type { RoadmapMilestone } from "@/domain/roadmap-intel";

export function StartInProjects({
  milestone,
  subjectLabel,
  context,
}: {
  milestone: RoadmapMilestone;
  subjectLabel: string;
  context: ProjectsContext;
}) {
  const navigate = useNavigate();
  const handoff = projectFromMilestone(milestone, subjectLabel);

  const start = useMutation({
    mutationFn: async () => {
      if (!handoff.ok) throw new Error(handoff.because);
      return projectsService.start(handoff.input, context);
    },
    onSuccess: (project) =>
      navigate({ to: "/modules/projects/$projectId", params: { projectId: project.id } }),
  });

  if (!handoff.ok) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        Not ready for Projects. {handoff.because}
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-col items-start gap-1">
      <TTButton size="sm" disabled={start.isPending} onClick={() => start.mutate()}>
        {start.isPending ? "Opening delivery…" : "Start in Projects"}
      </TTButton>
      {start.error ? (
        <p role="alert" className="text-sm text-destructive">
          {start.error instanceof Error ? start.error.message : "That work could not be started."}
        </p>
      ) : null}
    </div>
  );
}
