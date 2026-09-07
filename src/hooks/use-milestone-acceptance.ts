/**
 * The one wiring for milestone outcomes and acceptance criteria.
 *
 * Roadmap owns this truth (Canon 17), so both the Roadmap room and the Project
 * workroom use this same hook over the same Roadmap service. There is no second
 * implementation and no project side store.
 */

import { useState } from "react";

import { roadmapIntel, type IntelContext } from "@/data/supabase/roadmap-intel-service";
import type { AcceptanceCriterion } from "@/domain/milestone-criteria";
import type { MilestoneSuccessInput } from "@/domain/milestone-success";
import type { RoadmapMilestone } from "@/domain/roadmap-intel";

export interface MilestoneAcceptance {
  error: string | null;
  onSuccess: (milestone: RoadmapMilestone, input: MilestoneSuccessInput) => void;
  onCriterionAdd: (milestone: RoadmapMilestone, text: string) => void;
  onCriterionToggle: (
    milestone: RoadmapMilestone,
    criterion: AcceptanceCriterion,
    done: boolean,
  ) => void;
  onCriterionEdit: (
    milestone: RoadmapMilestone,
    criterion: AcceptanceCriterion,
    text: string,
  ) => void;
  onCriterionRemove: (milestone: RoadmapMilestone, criterion: AcceptanceCriterion) => void;
  onCriterionMove: (
    milestone: RoadmapMilestone,
    criterion: AcceptanceCriterion,
    direction: "up" | "down",
  ) => void;
}

export function useMilestoneAcceptance({
  context,
  criteria,
  label,
  refresh,
  setBusyId,
}: {
  context: IntelContext;
  /** The checklist already read for this roadmap, used only for ordering. */
  criteria: AcceptanceCriterion[];
  label: string;
  refresh: () => void | Promise<unknown>;
  setBusyId?: (id: string | null) => void;
}): MilestoneAcceptance {
  const [error, setError] = useState<string | null>(null);

  const run = async (milestoneId: string, work: () => Promise<unknown>) => {
    setError(null);
    setBusyId?.(milestoneId);
    try {
      await work();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That change could not be saved.");
    } finally {
      setBusyId?.(null);
    }
  };

  return {
    error,
    onSuccess: (milestone, input) =>
      void run(milestone.id, () =>
        roadmapIntel.setMilestoneSuccess(context, milestone, input, label),
      ),
    onCriterionAdd: (milestone, text) =>
      void run(milestone.id, () => roadmapIntel.addCriterion(context, milestone, text, label)),
    onCriterionToggle: (milestone, criterion, done) =>
      void run(milestone.id, () => roadmapIntel.setCriterionDone(context, criterion, done, label)),
    onCriterionEdit: (milestone, criterion, text) =>
      void run(milestone.id, () => roadmapIntel.editCriterion(context, criterion, text, label)),
    onCriterionRemove: (milestone, criterion) =>
      void run(milestone.id, () => roadmapIntel.removeCriterion(context, criterion, label)),
    onCriterionMove: (milestone, criterion, direction) =>
      void run(milestone.id, () =>
        roadmapIntel.moveCriterion(
          context,
          criteria.filter((row) => row.milestoneId === milestone.id),
          criterion,
          direction,
          label,
        ),
      ),
  };
}
