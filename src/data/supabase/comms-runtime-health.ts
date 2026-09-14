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

import { assertOk } from "./comms-schema";

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

export interface ReviewRunHealth {
  /** Runs recorded for this workspace, ever. Zero is a fact, not an error. */
  total: number;
  lastStatus: string | null;
  lastErrorCode: string | null;
  lastAt: string | null;
  /** True when at least one run finished successfully. */
  everSucceeded: boolean;
}

/**
 * What actually happened when this workspace asked for a review. This is the
 * only honest evidence that the AI works here: configuration is a promise,
 * a completed run is a result.
 */
export async function reviewRunHealth(organizationId: ID): Promise<ReviewRunHealth> {
  const { data, error } = await supabase
    .from("comms_review_runs")
    .select("status, error_code, started_at")
    .eq("organization_id", organizationId)
    .order("started_at", { ascending: false })
    .limit(50);
  assertOk(error);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const first = rows[0];
  return {
    total: rows.length,
    lastStatus: first && typeof first["status"] === "string" ? (first["status"] as string) : null,
    lastErrorCode:
      first && typeof first["error_code"] === "string" ? (first["error_code"] as string) : null,
    lastAt:
      first && typeof first["started_at"] === "string" ? (first["started_at"] as string) : null,
    everSucceeded: rows.some((row) => row["status"] === "complete"),
  };
}
