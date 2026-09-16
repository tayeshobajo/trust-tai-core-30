/**
 * Reading prepared work in the browser.
 *
 * Members are granted reading only on this table, so this read runs as the
 * signed-in person under RLS and always carries the workspace. A table that is
 * not there, or a read that fails, is reported as unavailable with a reason.
 * It is never shown as "nothing prepared", because nothing prepared and
 * nothing readable are different facts and lead to different actions.
 */

import type { ID } from "@/domain/entities";
import type { ModelUse, PreparationOutput, PreparationStatus } from "@/domain/preparation-jobs";
import { supabase } from "@/integrations/trust-tai/supabase";

const COLUMNS =
  "organization_id, job_id, subject_ref, input_revision, idempotency_key, trigger_event_id, status, summary, suggestions, evidence_refs, figures, owner_label, owner_membership_id, attempts, model_use, because, superseded_because, requested_by, started_at, finished_at";

export class PreparationUnavailable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "PreparationUnavailable";
  }
}

function notProvisioned(message: string): boolean {
  return /does not exist|could not find the table|schema cache/i.test(message);
}

type Row = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function toPreparationOutput(row: Row): PreparationOutput {
  return {
    key: str(row["idempotency_key"]),
    request: {
      organizationId: str(row["organization_id"]),
      jobId: str(row["job_id"]) as PreparationOutput["request"]["jobId"],
      subjectRef: str(row["subject_ref"]),
      inputRevision: str(row["input_revision"]),
      ...(row["trigger_event_id"] ? { triggerEventId: str(row["trigger_event_id"]) } : {}),
      ...(row["requested_by"] ? { requestedBy: str(row["requested_by"]) } : {}),
    },
    status: str(row["status"]) as PreparationStatus,
    summary: str(row["summary"]),
    suggestions: Array.isArray(row["suggestions"])
      ? (row["suggestions"] as unknown[]).filter((item): item is string => typeof item === "string")
      : [],
    evidenceRefs: Array.isArray(row["evidence_refs"])
      ? (row["evidence_refs"] as unknown[]).filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    figures:
      row["figures"] && typeof row["figures"] === "object"
        ? Object.fromEntries(
            Object.entries(row["figures"] as Record<string, unknown>).filter(
              (entry): entry is [string, number] => typeof entry[1] === "number",
            ),
          )
        : {},
    ownerLabel: str(row["owner_label"]),
    ...(row["owner_membership_id"] ? { ownerMembershipId: str(row["owner_membership_id"]) } : {}),
    attempts: typeof row["attempts"] === "number" ? row["attempts"] : 0,
    ...(row["model_use"] ? { modelUse: row["model_use"] as ModelUse } : {}),
    ...(row["because"] ? { because: str(row["because"]) } : {}),
    ...(row["started_at"] ? { startedAt: str(row["started_at"]) } : {}),
    ...(row["finished_at"] ? { finishedAt: str(row["finished_at"]) } : {}),
    ...(row["superseded_because"] ? { supersededBecause: str(row["superseded_because"]) } : {}),
    persisted: true,
  };
}

/** The most recent prepared record for one subject, or null if there is none. */
export async function latestPreparationFor(input: {
  organizationId: ID;
  jobId: string;
  subjectRef: string;
}): Promise<PreparationOutput | null> {
  const { data, error } = await supabase
    .from("preparation_outputs")
    .select(COLUMNS)
    .eq("organization_id", input.organizationId)
    .eq("job_id", input.jobId)
    .eq("subject_ref", input.subjectRef)
    .order("started_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new PreparationUnavailable(
      notProvisioned(error.message)
        ? "Prepared work cannot be shown yet: this workspace has no preparation records table."
        : `Prepared work could not be read: ${error.message}`,
    );
  }
  const row = (data?.[0] as Row | undefined) ?? null;
  return row ? toPreparationOutput(row) : null;
}
