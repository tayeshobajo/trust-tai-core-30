/**
 * Approved milestones waiting for delivery, read across every roadmap.
 *
 * Projects needs one honest list: what a person has already approved upstream
 * and has not yet started here. This reads roadmap truth only, it never
 * approves anything, and it never writes.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type { RoadmapMilestone } from "@/domain/roadmap-intel";

import { MILESTONE_COLUMNS, toMilestone, type Row } from "./roadmap-intel-schema";

/** Every approved milestone this organization can read, newest first. */
export async function listApprovedMilestones(organizationId: ID): Promise<RoadmapMilestone[]> {
  const { data, error } = await supabase
    .from("roadmap_milestones")
    .select(MILESTONE_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("status", "approved")
    .order("recommended_sequence", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(toMilestone);
}
