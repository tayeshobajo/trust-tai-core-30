/**
 * STAGED — NOT WIRED TO ANY ROUTE. Canonical Steward preparation runner.
 *
 * This module is the application-side half of the UNAPPLIED proposal in
 * `docs/proposed/steward-backend/001_canonical_runs.up.sql`. It must not be
 * imported by any route or client-reachable module until the SQL patch has
 * been reviewed, applied, and granted — the UI keeps its exact disabled
 * state until then.
 *
 * Boundaries enforced here:
 * - The legacy agent runner (`steward-agent-runner.server.ts`) completes
 *   agent-assigned tasks and must NEVER touch canonical human board work.
 *   This runner never writes `steward_tasks` status, evidence, or receipts.
 * - Human accountable owner and executing assistant are distinct fields on
 *   every run; the executor is always the assistant, never the person.
 * - Transcript suggestions are never orders: only the explicit action
 *   allowlist and caller-selected input refs enter a run.
 * - No arbitrary URL fetching: input refs are identifiers resolved by the
 *   repository against existing stored rows, never fetched from the network.
 */

import { createHash } from "node:crypto";

/** Actions the canonical runner may execute. Mirrors the SQL CHECK list. */
export const CANONICAL_RUN_ACTIONS = [
  "prepare_brief",
  "prepare_handoff",
  "draft_roadmap",
  "review_output",
] as const;
export type CanonicalRunAction = (typeof CANONICAL_RUN_ACTIONS)[number];

export type CanonicalRunStatus = "queued" | "running" | "complete" | "failed";

export interface CanonicalRunInputRef {
  /** Kind of stored input, e.g. "transcript" | "task_notes" | "artifact". */
  kind: string;
  /** Identifier of an existing stored row — never a URL to fetch. */
  id: string;
  /** Revision of the input at selection time; snapshotted immutably. */
  revision: number;
}

export interface CanonicalRun {
  id: string;
  organizationId: string;
  taskId: string;
  action: CanonicalRunAction;
  clientOperationId: string;
  requestDigest: string;
  inputSnapshot: { action: CanonicalRunAction; inputRefs: CanonicalRunInputRef[] };
  status: CanonicalRunStatus;
  artifactText: string | null;
  artifactDigest: string | null;
  evidenceRefs: string[];
  /** The accountable human who requested the run. */
  requestedBy: string;
  attempts: number;
  maxAttempts: number;
  failureReason: string | null;
}

export class OperationConflictError extends Error {
  readonly code = "P0002";
  constructor(message: string) {
    super(message);
    this.name = "OperationConflictError";
  }
}

/** Minimal repository contract over the proposed SQL functions. */
export interface CanonicalRunRepository {
  requestRun(input: {
    orgId: string;
    taskId: string;
    action: CanonicalRunAction;
    operationId: string;
    digest: string;
    snapshot: CanonicalRun["inputSnapshot"];
    actorId: string;
  }): Promise<CanonicalRun>;
  claimRun(runId: string, actorId: string, leaseSeconds?: number): Promise<CanonicalRun | null>;
  completeRun(input: {
    runId: string;
    actorId: string;
    artifactText: string;
    artifactDigest: string;
    evidenceRefs: string[];
  }): Promise<CanonicalRun>;
  failRun(runId: string, actorId: string, reason: string): Promise<CanonicalRun>;
  /** Resolve a selected input ref to stored content; null if inaccessible. */
  readInput(
    ref: CanonicalRunInputRef,
    orgId: string,
    actorId: string,
  ): Promise<{ content: string; revision: number } | null>;
}

/**
 * Provider contract. The real provider is injected at the staged entrypoint;
 * tests must use a fake. No provider call happens without a won claim.
 */
export interface CanonicalRunProvider {
  generate(input: {
    action: CanonicalRunAction;
    taskTitle: string;
    inputs: { kind: string; content: string; revision: number }[];
  }): Promise<{ text: string }>;
}

export function digestRequest(input: {
  action: CanonicalRunAction;
  inputRefs: CanonicalRunInputRef[];
}): string {
  const stable = JSON.stringify({
    action: input.action,
    inputRefs: [...input.inputRefs]
      .map((r) => ({ kind: r.kind, id: r.id, revision: r.revision }))
      .sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id)),
  });
  return createHash("sha256").update(stable).digest("hex");
}

export function digestArtifact(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface RequestCanonicalRunInput {
  orgId: string;
  taskId: string;
  taskTitle: string;
  action: CanonicalRunAction;
  /** Client-generated unique operation UUID. Retries reuse it; a deliberate
   *  rerun uses a NEW UUID. */
  operationId: string;
  inputRefs: CanonicalRunInputRef[];
  actorId: string;
}

export type RequestCanonicalRunResult =
  | { kind: "queued"; run: CanonicalRun }
  | { kind: "replayed"; run: CanonicalRun }
  | { kind: "conflict"; message: string }
  | { kind: "rejected"; message: string };

/**
 * Stage 1: register the run. Same operation + same payload replays the
 * existing run; same operation + changed payload conflicts; a new operation
 * is a deliberate rerun. Inaccessible inputs are rejected before any row is
 * created.
 */
export async function requestCanonicalRun(
  repo: CanonicalRunRepository,
  input: RequestCanonicalRunInput,
): Promise<RequestCanonicalRunResult> {
  if (!CANONICAL_RUN_ACTIONS.includes(input.action)) {
    return { kind: "rejected", message: `action not allowed: ${input.action}` };
  }
  for (const ref of input.inputRefs) {
    const resolved = await repo.readInput(ref, input.orgId, input.actorId);
    if (!resolved) {
      return { kind: "rejected", message: `input not accessible: ${ref.kind}:${ref.id}` };
    }
    if (resolved.revision !== ref.revision) {
      return {
        kind: "rejected",
        message: `input ${ref.kind}:${ref.id} changed since selection (revision ${ref.revision} → ${resolved.revision}); reselect to rerun`,
      };
    }
  }
  const digest = digestRequest({ action: input.action, inputRefs: input.inputRefs });
  const snapshot = { action: input.action, inputRefs: input.inputRefs };
  try {
    const run = await repo.requestRun({
      orgId: input.orgId,
      taskId: input.taskId,
      action: input.action,
      operationId: input.operationId,
      digest,
      snapshot,
      actorId: input.actorId,
    });
    return { kind: run.status === "queued" && run.attempts === 0 ? "queued" : "replayed", run };
  } catch (error) {
    if (error instanceof OperationConflictError || (error as { code?: string }).code === "P0002") {
      return {
        kind: "conflict",
        message: "this operation was already requested with different inputs",
      };
    }
    throw error;
  }
}

export type ExecuteCanonicalRunResult =
  | { kind: "complete"; run: CanonicalRun }
  | { kind: "not_claimed" }
  | { kind: "failed"; run: CanonicalRun };

/**
 * Stage 2: claim and execute. Losing a claim is a normal outcome (another
 * worker holds it). Provider failure marks the run failed-or-requeued per
 * the SQL attempt budget; the lease guarantees no run strands in `running`.
 * The task row is never touched.
 */
export async function executeCanonicalRun(
  repo: CanonicalRunRepository,
  provider: CanonicalRunProvider,
  input: { runId: string; actorId: string; taskTitle: string },
): Promise<ExecuteCanonicalRunResult> {
  const claimed = await repo.claimRun(input.runId, input.actorId);
  if (!claimed) return { kind: "not_claimed" };

  const inputs: { kind: string; content: string; revision: number }[] = [];
  for (const ref of claimed.inputSnapshot.inputRefs) {
    const resolved = await repo.readInput(ref, claimed.organizationId, input.actorId);
    if (!resolved) {
      const run = await repo.failRun(
        claimed.id,
        input.actorId,
        `input became inaccessible: ${ref.kind}:${ref.id}`,
      );
      return { kind: "failed", run };
    }
    inputs.push({ kind: ref.kind, content: resolved.content, revision: resolved.revision });
  }

  try {
    const output = await provider.generate({
      action: claimed.action,
      taskTitle: input.taskTitle,
      inputs,
    });
    const run = await repo.completeRun({
      runId: claimed.id,
      actorId: input.actorId,
      artifactText: output.text,
      artifactDigest: digestArtifact(output.text),
      evidenceRefs: claimed.inputSnapshot.inputRefs.map((r) => `${r.kind}:${r.id}@${r.revision}`),
    });
    return { kind: "complete", run };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "provider failure";
    const run = await repo.failRun(claimed.id, input.actorId, reason.slice(0, 500));
    return { kind: "failed", run };
  }
}
