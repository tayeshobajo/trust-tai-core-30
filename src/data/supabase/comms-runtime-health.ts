/**
 * Three different facts, kept apart on purpose.
 *
 * A connected mailbox does not mean the review can run. A configured model
 * does not mean any review has ever succeeded. And neither of those decides
 * whether one particular draft may leave: that is decided per draft, at the
 * approval boundary, and nothing here may stand in for it.
 *
 * Nothing in this file reads, holds or reports a credential. Configuration is
 * a boolean and a model name, never a key.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";

export interface AiRuntimeAvailability {
  /** Whether a provider is configured at all, as the server reports it. */
  configured: boolean;
  provider: string | null;
  model: string | null;
}

/** Ask the server whether a reviewing model is configured. Never a key. */
export async function aiRuntimeAvailability(): Promise<AiRuntimeAvailability> {
  const response = await fetch("/api/public/comms/review", { method: "GET" });
  if (!response.ok) {
    throw new Error("The review runtime could not be asked whether it is configured.");
  }
  const payload = (await response.json()) as Record<string, unknown>;
  return {
    configured: payload["configured"] === true,
    provider: typeof payload["provider"] === "string" ? payload["provider"] : null,
    model: typeof payload["model"] === "string" ? payload["model"] : null,
  };
}

/**
 * What actually happened when this workspace asked for a review.
 *
 * Three independent reads, because each one can fail on its own and a failed
 * read must never be reported as a fact:
 *
 *  - how many runs exist, as an exact count over the whole table, not a page;
 *  - whether any run ever completed, as an existence query over the whole
 *    table, so a success older than the most recent fifty is still found;
 *  - what the most recent attempt did.
 *
 * A null means "not known", never zero and never "never succeeded".
 */
export interface ReviewRunHealth {
  /** Exact all-time count for this workspace, or null when the read failed. */
  total: number | null;
  totalError: string | null;
  /** True/false all-time, or null when the read failed. */
  everSucceeded: boolean | null;
  successError: string | null;
  lastStatus: string | null;
  lastErrorCode: string | null;
  lastAt: string | null;
  lastError: string | null;
}

function messageOf(error: { message?: string } | null): string | null {
  if (!error) return null;
  return error.message?.trim() || "That read failed.";
}

export async function reviewRunHealth(organizationId: ID): Promise<ReviewRunHealth> {
  const [counted, succeeded, latest] = await Promise.all([
    supabase
      .from("comms_review_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabase
      .from("comms_review_runs")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("status", "complete")
      .limit(1),
    supabase
      .from("comms_review_runs")
      .select("status, error_code, started_at")
      .eq("organization_id", organizationId)
      .order("started_at", { ascending: false })
      .limit(1),
  ]);

  const latestRow = (latest.data ?? [])[0] as Record<string, unknown> | undefined;

  return {
    total: counted.error ? null : (counted.count ?? 0),
    totalError: messageOf(counted.error),
    everSucceeded: succeeded.error ? null : (succeeded.data ?? []).length > 0,
    successError: messageOf(succeeded.error),
    lastStatus:
      !latest.error && latestRow && typeof latestRow["status"] === "string"
        ? (latestRow["status"] as string)
        : null,
    lastErrorCode:
      !latest.error && latestRow && typeof latestRow["error_code"] === "string"
        ? (latestRow["error_code"] as string)
        : null,
    lastAt:
      !latest.error && latestRow && typeof latestRow["started_at"] === "string"
        ? (latestRow["started_at"] as string)
        : null,
    lastError: messageOf(latest.error),
  };
}
