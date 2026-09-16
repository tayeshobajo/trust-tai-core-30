/**
 * Where prepared work is actually kept (server only).
 *
 * This is the real adapter behind `PreparationStore`. Until now only the
 * in-memory sandbox implemented it, so nothing prepared could survive a
 * request. It writes two tables and nothing else:
 *
 *   preparation_outputs   one row per workspace, job, subject and revision,
 *   preparation_attempts  one row per attempt, kept for ever, so a retry adds
 *                         to the history instead of erasing what went wrong.
 *
 * Authority, exactly: every statement here runs with the server's own
 * credentials, and every statement carries the organization as an explicit
 * filter. This module never decides who the caller is. The runner proves that
 * first, and refuses before this file is reached. There is no browser
 * fallback: without service credentials, writing fails loudly.
 *
 * Claiming is a compare and swap. The insert takes an unclaimed subject; the
 * update takes a subject back only when the row still looks exactly as it did
 * when the decision was made. Two events arriving together therefore leave one
 * winner, and the loser is told so rather than calling the model as well.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { claimDecision } from "@/domain/preparation-claim";
import type { ModelUse, PreparationOutput, PreparationRequest } from "@/domain/preparation-jobs";
import type { PreparationStatus } from "@/domain/preparation-jobs";
import type { ClaimInput, ClaimResult, PreparationStore } from "@/lib/preparation-runner.server";
import { trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";

const OUTPUTS = "preparation_outputs";
const ATTEMPTS = "preparation_attempts";

type Row = Record<string, unknown>;

export class PreparationStoreUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreparationStoreUnavailable";
  }
}

/** Server credentials only. Members are granted SELECT; they never write here. */
export function preparationWriter(): SupabaseClient {
  const key =
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) {
    throw new PreparationStoreUnavailable(
      "Preparation is not configured on the server, so nothing was prepared and nothing was recorded.",
    );
  }
  return createClient(trustTaiSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function figures(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "number") out[name] = entry;
  }
  return out;
}

/** The table is not there, or a column is not. A gap, never a refusal. */
export function missingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42703" || code === "42P01") return true;
  return /does not exist/i.test(error.message ?? "");
}

function isConflict(error: { code?: string } | null): boolean {
  return (error?.code ?? "") === "23505";
}

function toOutput(row: Row): PreparationOutput {
  const request: PreparationRequest = {
    organizationId: str(row["organization_id"]),
    jobId: str(row["job_id"]) as PreparationRequest["jobId"],
    subjectRef: str(row["subject_ref"]),
    inputRevision: str(row["input_revision"]),
    ...(row["trigger_event_id"] ? { triggerEventId: str(row["trigger_event_id"]) } : {}),
    ...(row["requested_by"] ? { requestedBy: str(row["requested_by"]) } : {}),
  };
  return {
    key: str(row["idempotency_key"]),
    request,
    status: str(row["status"]) as PreparationStatus,
    summary: str(row["summary"]),
    suggestions: strings(row["suggestions"]),
    evidenceRefs: strings(row["evidence_refs"]),
    figures: figures(row["figures"]),
    ownerLabel: str(row["owner_label"]),
    ...(row["owner_membership_id"] ? { ownerMembershipId: str(row["owner_membership_id"]) } : {}),
    attempts: num(row["attempts"]),
    ...(row["attempt_id"] ? { attemptId: str(row["attempt_id"]) } : {}),
    ...(row["lease_until"] ? { leaseUntil: str(row["lease_until"]) } : {}),
    ...(row["model_use"] ? { modelUse: row["model_use"] as ModelUse } : {}),
    ...(row["because"] ? { because: str(row["because"]) } : {}),
    ...(row["started_at"] ? { startedAt: str(row["started_at"]) } : {}),
    ...(row["finished_at"] ? { finishedAt: str(row["finished_at"]) } : {}),
    ...(row["superseded_because"] ? { supersededBecause: str(row["superseded_because"]) } : {}),
    persisted: true,
  };
}

function startOfDayIso(nowIso: string): string {
  return `${nowIso.slice(0, 10)}T00:00:00.000Z`;
}

/**
 * The real store. `now` is injected so a worker and a test agree about what
 * "today" means without either of them reaching for a clock of its own.
 */
export function preparationStore(deps: {
  db?: SupabaseClient;
  now?: () => Date;
} = {}): PreparationStore {
  const db = deps.db ?? preparationWriter();
  const now = deps.now ?? (() => new Date());

  async function readRow(key: string, organizationId: string): Promise<Row | null> {
    const { data, error } = await db
      .from(OUTPUTS)
      .select("*")
      .eq("organization_id", organizationId)
      .eq("idempotency_key", key)
      .maybeSingle();
    if (error && missingSchema(error)) {
      throw new PreparationStoreUnavailable(
        "Prepared work cannot be stored yet: the preparation tables are not in this database.",
      );
    }
    if (error) {
      throw new PreparationStoreUnavailable(`Prepared work could not be read: ${error.message}`);
    }
    return (data as Row | null) ?? null;
  }

  return {
    async load(key, organizationId) {
      const row = await readRow(key, organizationId);
      return row ? toOutput(row) : null;
    },

    async claim(input: ClaimInput): Promise<ClaimResult> {
      const base = {
        organization_id: input.request.organizationId,
        job_id: input.request.jobId,
        subject_ref: input.request.subjectRef,
        input_revision: input.request.inputRevision,
        idempotency_key: input.key,
        trigger_event_id: input.request.triggerEventId ?? null,
        requested_by: input.request.requestedBy ?? null,
        owner_label: input.ownerLabel,
      };

      // The unclaimed case: one insert, and the unique key settles a tie.
      const inserted = await db
        .from(OUTPUTS)
        .insert({
          ...base,
          status: "running",
          attempts: 1,
          attempt_id: input.attemptId,
          lease_until: input.leaseUntil,
          started_at: input.nowIso,
        })
        .select("*")
        .maybeSingle();

      if (inserted.error && missingSchema(inserted.error)) {
        throw new PreparationStoreUnavailable(
          "Prepared work cannot be stored yet: the preparation tables are not in this database.",
        );
      }
      if (!inserted.error && inserted.data) {
        await recordAttempt(db, input, 1);
        return { claimed: true, output: toOutput(inserted.data as Row), because: "Claimed." };
      }
      if (inserted.error && !isConflict(inserted.error)) {
        throw new PreparationStoreUnavailable(
          `Prepared work could not be started: ${inserted.error.message}`,
        );
      }

      // Somebody has been here before. The same rule as the sandbox decides.
      const row = await readRow(input.key, input.request.organizationId);
      if (!row) {
        return { claimed: false, output: null, because: "This record moved while it was read." };
      }
      const existing = toOutput(row);
      const decision = claimDecision({
        existing: {
          status: existing.status,
          attempts: existing.attempts,
          leaseUntil: existing.leaseUntil ?? null,
          attemptId: existing.attemptId ?? null,
          supersededBecause: existing.supersededBecause ?? null,
        },
        nowIso: input.nowIso,
        maxAttempts: input.maxAttempts,
      });
      if (decision.act !== "claim") {
        return { claimed: false, output: existing, because: decision.because };
      }

      /* Compare and swap: take it back only if it still looks exactly as it
         did when the decision above was made. */
      let take = db
        .from(OUTPUTS)
        .update({
          status: "running",
          attempts: decision.attempts,
          attempt_id: input.attemptId,
          lease_until: input.leaseUntil,
          started_at: input.nowIso,
          finished_at: null,
          because: null,
        })
        .eq("organization_id", input.request.organizationId)
        .eq("idempotency_key", input.key)
        .eq("attempts", existing.attempts)
        .eq("status", existing.status);
      take = existing.attemptId ? take.eq("attempt_id", existing.attemptId) : take;
      const taken = await take.select("*").maybeSingle();
      if (taken.error || !taken.data) {
        return {
          claimed: false,
          output: existing,
          because: "Another attempt picked this up first.",
        };
      }
      await recordAttempt(db, input, decision.attempts);
      return { claimed: true, output: toOutput(taken.data as Row), because: decision.because };
    },

    async complete(output, attemptId) {
      const patch: Row = {
        status: output.status,
        summary: output.summary,
        suggestions: output.suggestions,
        evidence_refs: output.evidenceRefs,
        figures: output.figures,
        owner_label: output.ownerLabel,
        owner_membership_id: output.ownerMembershipId ?? null,
        model_use: output.modelUse ?? null,
        because: output.because ?? null,
        finished_at: output.finishedAt ?? new Date(now().getTime()).toISOString(),
        lease_until: null,
      };
      const { data, error } = await db
        .from(OUTPUTS)
        .update(patch)
        .eq("organization_id", output.request.organizationId)
        .eq("idempotency_key", output.key)
        .eq("attempt_id", attemptId)
        .select("*")
        .maybeSingle();
      if (error && missingSchema(error)) {
        throw new PreparationStoreUnavailable(
          "Prepared work cannot be stored yet: the preparation tables are not in this database.",
        );
      }
      if (error) {
        throw new PreparationStoreUnavailable(`This could not be saved: ${error.message}`);
      }
      if (!data) {
        throw new PreparationStoreUnavailable(
          "This attempt no longer holds the record, so nothing was saved over it.",
        );
      }
      await db
        .from(ATTEMPTS)
        .update({
          status: output.status,
          because: output.because ?? null,
          model_use: output.modelUse ?? null,
          finished_at: patch["finished_at"],
        })
        .eq("organization_id", output.request.organizationId)
        .eq("attempt_id", attemptId);
      return toOutput(data as Row);
    },

    /**
     * Attempts, not records: a retry costs what a retry costs. Counting the
     * output rows would let a retried job run free.
     */
    async countToday(organizationId, jobId) {
      let query = db
        .from(ATTEMPTS)
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .gte("started_at", startOfDayIso(now().toISOString()));
      if (jobId) query = query.eq("job_id", jobId);
      const { count, error } = await query;
      if (error && missingSchema(error)) {
        throw new PreparationStoreUnavailable(
          "Preparation limits cannot be checked yet: the attempt table is not in this database.",
        );
      }
      if (error) {
        throw new PreparationStoreUnavailable(
          `Preparation limits could not be read: ${error.message}`,
        );
      }
      return count ?? 0;
    },
  };
}

/** One row per attempt, written as the attempt starts. History, not state. */
async function recordAttempt(db: SupabaseClient, input: ClaimInput, attemptNumber: number) {
  const { error } = await db.from(ATTEMPTS).insert({
    organization_id: input.request.organizationId,
    job_id: input.request.jobId,
    subject_ref: input.request.subjectRef,
    input_revision: input.request.inputRevision,
    idempotency_key: input.key,
    attempt_id: input.attemptId,
    attempt_number: attemptNumber,
    trigger_event_id: input.request.triggerEventId ?? null,
    requested_by: input.request.requestedBy ?? null,
    status: "running",
    started_at: input.nowIso,
  });
  if (error && missingSchema(error)) {
    throw new PreparationStoreUnavailable(
      "Prepared work cannot be stored yet: the attempt table is not in this database.",
    );
  }
  if (error) {
    throw new PreparationStoreUnavailable(`This attempt could not be recorded: ${error.message}`);
  }
}
