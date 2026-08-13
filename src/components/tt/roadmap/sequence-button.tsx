/**
 * Scout → Roadmap and Comms → Roadmap handoff.
 *
 * One action, one guarantee: a subject has at most one roadmap. The service
 * looks for an existing roadmap for this client, prospect or relationship
 * before drafting a new one, so pressing this twice opens the same roadmap
 * rather than creating a second path.
 *
 * Context is not re-typed here. The roadmap is drafted from what the shared
 * tables already hold about the subject; this button only carries the subject
 * and the objective across the room boundary.
 */

import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";

import { TTButton } from "@/components/tt/primitives";
import { roadmapService, type RoadmapContext } from "@/data/supabase/roadmap-service";
import type { ID } from "@/domain/entities";
import type { RoadmapSubjectKind } from "@/domain/roadmap";

export interface SequenceSubject {
  kind: RoadmapSubjectKind;
  id: ID;
  label: string;
}

export function SequenceInRoadmap({
  subject,
  objective,
  context,
  label = "Sequence in Roadmap",
}: {
  subject: SequenceSubject;
  objective: string;
  context: RoadmapContext;
  label?: string;
}) {
  const navigate = useNavigate();

  const sequence = useMutation({
    mutationFn: () =>
      roadmapService.create({ subject: { kind: subject.kind, id: subject.id }, objective }, context),
    onSuccess: (detail) =>
      navigate({ to: "/modules/roadmap/$roadmapId", params: { roadmapId: detail.roadmap.id } }),
  });

  return (
    <div className="flex flex-col items-start gap-1">
      <TTButton
        variant="secondary"
        disabled={sequence.isPending}
        onClick={() => sequence.mutate()}
      >
        {sequence.isPending ? "Opening the roadmap…" : label}
      </TTButton>
      {sequence.error ? (
        <p role="alert" className="text-sm text-destructive">
          {sequence.error instanceof Error
            ? sequence.error.message
            : "That roadmap could not be opened."}
        </p>
      ) : null}
    </div>
  );
}
