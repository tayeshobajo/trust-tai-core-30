/**
 * Execution ownership backfill, the one place persisted rows are corrected.
 *
 * Reads every milestone in the organization, reads it through the ownership
 * law, and writes back only what the law changes: the room named in a
 * boundary sentence, and open execution links pointing at the wrong room.
 * Settled links are left alone; they are history.
 */

import { guardRoomWrites } from "@/lib/room-authority";
import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type { ExecutionRoom } from "@/domain/execution-ownership";
import {
  planOwnershipBackfill,
  type BackfillLink,
  type BackfillMilestone,
  type OwnershipBackfillPlan,
} from "@/domain/execution-ownership-backfill";

import { supabaseActivity } from "./activities";
import { assertOk } from "./roadmap-schema";

export interface OwnershipBackfillContext {
  organizationId: ID;
  userId: ID;
}

export interface OwnershipBackfillResult {
  plan: OwnershipBackfillPlan;
  boundariesWritten: number;
  linksWritten: number;
}

type Row = Record<string, unknown>;

const LINK_STATUSES = ["requested", "accepted", "in_progress", "complete", "withdrawn"] as const;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function room(value: unknown): ExecutionRoom {
  return value === "ops" || value === "studio" ? value : "projects";
}

function linkStatus(value: unknown): BackfillLink["status"] {
  return (LINK_STATUSES as readonly string[]).includes(String(value))
    ? (String(value) as BackfillLink["status"])
    : "requested";
}

/** Missing table means the correlation layer is not deployed here. */
function missingTable(error: { message?: string } | null): boolean {
  return Boolean(error?.message && /does not exist|schema cache/i.test(error.message));
}

const ownershipBackfillRaw = {
  /** Read-only: what the law would change, with nothing written. */
  async plan(context: OwnershipBackfillContext): Promise<OwnershipBackfillPlan> {
    const milestones = await supabase
      .from("roadmap_milestones")
      .select("id, roadmap_id, name, what_we_build, execution_boundary")
      .eq("organization_id", context.organizationId);
    assertOk(milestones.error);

    const rows: BackfillMilestone[] = ((milestones.data ?? []) as Row[]).map((row) => ({
      id: String(row["id"]),
      roadmapId: String(row["roadmap_id"]),
      name: text(row["name"]),
      whatWeBuild: text(row["what_we_build"]),
      executionBoundary: text(row["execution_boundary"]),
    }));

    const links = await supabase
      .from("roadmap_execution_links")
      .select("id, milestone_id, owning_app, status")
      .eq("organization_id", context.organizationId);
    const linkRows: BackfillLink[] = missingTable(links.error)
      ? []
      : (assertOk(links.error),
        ((links.data ?? []) as Row[]).map((row) => ({
          id: String(row["id"]),
          milestoneId: String(row["milestone_id"]),
          owningApp: room(row["owning_app"]),
          status: linkStatus(row["status"]),
        })));

    return planOwnershipBackfill(rows, linkRows);
  },

  /** Apply the plan. Idempotent: a second run writes nothing. */
  async apply(context: OwnershipBackfillContext): Promise<OwnershipBackfillResult> {
    const plan = await ownershipBackfillRaw.plan(context);
    const at = new Date().toISOString();
    let boundariesWritten = 0;
    let linksWritten = 0;

    for (const change of plan.changes) {
      if (change.boundaryChanged) {
        const { error } = await supabase
          .from("roadmap_milestones")
          .update({ execution_boundary: change.boundaryAfter, updated_at: at })
          .eq("id", change.milestoneId)
          .eq("organization_id", context.organizationId);
        assertOk(error);
        boundariesWritten += 1;
      }
      if (change.linkChanged && change.linkId && change.linkOwnerAfter) {
        const { error } = await supabase
          .from("roadmap_execution_links")
          .update({ owning_app: change.linkOwnerAfter, updated_at: at })
          .eq("id", change.linkId)
          .eq("organization_id", context.organizationId);
        assertOk(error);
        linksWritten += 1;
      }
    }

    if (boundariesWritten > 0 || linksWritten > 0) {
      try {
        await supabaseActivity.record({
          organizationId: context.organizationId,
          name: "roadmap.decided",
          subject: { type: "roadmap", id: "execution-ownership", label: "Execution ownership" },
          summary: `Corrected execution ownership on ${boundariesWritten} milestone ${
            boundariesWritten === 1 ? "boundary" : "boundaries"
          } and ${linksWritten} open ${linksWritten === 1 ? "handoff" : "handoffs"}.`,
          payload: { boundariesWritten, linksWritten, frozen: plan.counts.frozen },
          provenance: {
            appId: "roadmap",
            actor: { type: "user", id: context.userId },
            observedAt: at,
            confidence: "observed",
          },
          occurredAt: at,
        });
      } catch {
        // The correction matters more than its footnote.
      }
    }

    return { plan, boundariesWritten, linksWritten };
  },
};

export const ownershipBackfill = guardRoomWrites("roadmap", "Roadmap", ownershipBackfillRaw, [
  "plan",
]);
