/**
 * What a workspace has actually switched on (server only).
 *
 * Nothing is on by default, and a policy that cannot be read is not treated as
 * permission. An absent row means every job is off, which is the same answer
 * the contract gives when nobody has decided yet. An unreadable row is a
 * refusal with a reason, never an empty policy that quietly allows the
 * defaults through.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PREPARATION_POLICY_DEFAULT,
  type PreparationJobId,
  type PreparationPolicy,
} from "@/domain/preparation-jobs";
import {
  missingSchema,
  preparationWriter,
  PreparationStoreUnavailable,
} from "@/lib/preparation-store.server";

const POLICY = "preparation_policy";

const JOB_IDS: PreparationJobId[] = [
  "enquiry_qualification_packet",
  "conversation_summary",
  "milestone_status_draft",
];

function enabledJobs(value: unknown): PreparationJobId[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PreparationJobId =>
    JOB_IDS.includes(item as PreparationJobId),
  );
}

/**
 * Read the policy for one workspace. `configuredKeys` is what the workspace
 * genuinely has set up, passed in by the caller that knows: the policy row
 * records the switches, not whether a provider exists.
 */
export async function loadPreparationPolicy(input: {
  organizationId: string;
  configuredKeys: string[];
  db?: SupabaseClient;
}): Promise<PreparationPolicy> {
  const db = input.db ?? preparationWriter();
  const { data, error } = await db
    .from(POLICY)
    .select("enabled_jobs, stop_switch, per_job_daily_limit, workspace_daily_limit")
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  if (error && missingSchema(error)) {
    throw new PreparationStoreUnavailable(
      "Preparation settings cannot be read yet: the settings table is not in this database.",
    );
  }
  if (error) {
    throw new PreparationStoreUnavailable(
      `Preparation settings could not be read: ${error.message}`,
    );
  }
  if (!data) {
    // Nobody has decided anything here, so nothing runs.
    return { ...PREPARATION_POLICY_DEFAULT, configuredKeys: input.configuredKeys };
  }

  const row = data as Record<string, unknown>;
  return {
    enabledJobs: enabledJobs(row["enabled_jobs"]),
    stopSwitch: row["stop_switch"] === true,
    perJobDailyLimit:
      typeof row["per_job_daily_limit"] === "number"
        ? row["per_job_daily_limit"]
        : PREPARATION_POLICY_DEFAULT.perJobDailyLimit,
    workspaceDailyLimit:
      typeof row["workspace_daily_limit"] === "number"
        ? row["workspace_daily_limit"]
        : PREPARATION_POLICY_DEFAULT.workspaceDailyLimit,
    configuredKeys: input.configuredKeys,
  };
}
