/**
 * STAGED — NOT WIRED TO ANY ROUTE. Canonical Steward preparation runner.
 *
 * Application-side half of the UNAPPLIED proposal in
 * `docs/proposed/steward-backend/001_canonical_runs.up.sql`. Must not be
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
 * - The snapshot persists the RESOLVED content and its digest at request
 *   time; execution reads the snapshot, never the mutable source row.
 * - Claim/complete/fail are fenced by a unique claim token issued by the
 *   database: a stale worker cannot complete a reclaimed run.
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
  /** Kind of stored input, e.g. "transcript" | "task_notes". */
  kind: string;
  /** Identifier of an existing stored row — never a URL to fetch. */
  id: string;
}

/** Immutable snapshot entry: resolved content + digest, pinned at request. */
export interface CanonicalRunInputSnapshotEntry {
  kind: string;
  id: string;
  revision: number;
  content: string;
  contentDigest: string;
}

export interface CanonicalRun {
  id: string;
  organizationId: string;
  taskId: string;
  action: CanonicalRunAction;
  clientOperationId: string;
  requestDigest: string;
  inputSnapshot: CanonicalRunInputSnapshotEntry[];
  status: CanonicalRunStatus;
  artifactText: string | null;
  artifactDigest: string | null;
  evidenceRefs: string[];
  /** The accountable human who requested the run. */
  requestedBy: string;
  attempts: number;
  maxAttempts: number;
  failureReason: string | null;
  /** Fencing token for the current claim; null unless running. */
  claimToken: string | null;
  claimVersion: number;
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
    /** Caller-selected refs — the SQL function resolves and snapshots the
     *  content server-side from these; the Supabase adapter sends ONLY
     *  these. */
    inputRefs: CanonicalRunInputRef[];
    /** Pre-resolved snapshot for repositories that do their own resolution
     *  (in-memory test repos); the Supabase adapter ignores it because the
     *  SQL function snapshots server-side. */
    snapshot?: CanonicalRunInputSnapshotEntry[];
    actorId: string;
  }): Promise<CanonicalRun>;
  claimRun(runId: string, actorId: string, leaseSeconds?: number): Promise<CanonicalRun | null>;
  completeRun(input: {
    runId: string;
    claimToken: string;
    artifactText: string;
    evidenceRefs: string[];
  }): Promise<CanonicalRun>;
  failRun(input: { runId: string; claimToken: string; reason: string }): Promise<CanonicalRun>;
  /** Resolve a selected input ref to stored content; null if inaccessible. */
  readInput(
    ref: CanonicalRunInputRef,
    orgId: string,
    actorId: string,
  ): Promise<{ content: string; revision: number } | null>;
  /** Server-resolved task title; the caller never supplies it. */
  readTaskTitle(taskId: string, orgId: string, actorId: string): Promise<string | null>;
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

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Request digest binds org, task, requester, action and the full input
 * identity (kind, id, revision, content digest) — a reused operation UUID
 * with any changed element conflicts instead of silently replaying.
 */
export function digestRequest(input: {
  orgId: string;
  taskId: string;
  requesterId: string;
  action: CanonicalRunAction;
  inputs: CanonicalRunInputSnapshotEntry[];
}): string {
  const stable = JSON.stringify({
    orgId: input.orgId,
    taskId: input.taskId,
    requesterId: input.requesterId,
    action: input.action,
    inputs: [...input.inputs]
      .map((r) => ({
        kind: r.kind,
        id: r.id,
        revision: r.revision,
        contentDigest: r.contentDigest,
      }))
      .sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id)),
  });
  return sha256(stable);
}

export function digestArtifact(text: string): string {
  return sha256(text);
}

export interface RequestCanonicalRunInput {
  orgId: string;
  taskId: string;
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
 * Stage 1: register the run. Every selected input is resolved server-side
 * and its content + digest persisted in the immutable snapshot; inaccessible
 * or empty inputs are rejected before any row is created. Same operation +
 * same payload replays; changed payload conflicts; new operation = rerun.
 */
export async function requestCanonicalRun(
  repo: CanonicalRunRepository,
  input: RequestCanonicalRunInput,
): Promise<RequestCanonicalRunResult> {
  if (!CANONICAL_RUN_ACTIONS.includes(input.action)) {
    return { kind: "rejected", message: `action not allowed: ${input.action}` };
  }
  if (input.inputRefs.length === 0) {
    return { kind: "rejected", message: "at least one input is required" };
  }
  const snapshot: CanonicalRunInputSnapshotEntry[] = [];
  for (const ref of input.inputRefs) {
    const resolved = await repo.readInput(ref, input.orgId, input.actorId);
    if (!resolved) {
      return { kind: "rejected", message: `input not accessible: ${ref.kind}:${ref.id}` };
    }
    if (resolved.content.trim().length === 0) {
      return { kind: "rejected", message: `input is empty: ${ref.kind}:${ref.id}` };
    }
    snapshot.push({
      kind: ref.kind,
      id: ref.id,
      revision: resolved.revision,
      content: resolved.content,
      contentDigest: sha256(resolved.content),
    });
  }
  const digest = digestRequest({
    orgId: input.orgId,
    taskId: input.taskId,
    requesterId: input.actorId,
    action: input.action,
    inputs: snapshot,
  });
  try {
    const run = await repo.requestRun({
      orgId: input.orgId,
      taskId: input.taskId,
      action: input.action,
      operationId: input.operationId,
      digest,
      inputRefs: input.inputRefs,
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
 * Stage 2: claim and execute. The provider receives ONLY the immutable
 * snapshot content recorded at request time — the mutable source rows are
 * never re-read, so a later edit cannot silently change what a run saw.
 * Completion and failure are fenced by the claim token: a stale worker's
 * write is rejected by the database. The task row is never touched.
 */
export async function executeCanonicalRun(
  repo: CanonicalRunRepository,
  provider: CanonicalRunProvider,
  input: { runId: string; actorId: string },
): Promise<ExecuteCanonicalRunResult> {
  const claimed = await repo.claimRun(input.runId, input.actorId);
  if (!claimed || !claimed.claimToken) return { kind: "not_claimed" };
  const claimToken = claimed.claimToken;

  const taskTitle = await repo.readTaskTitle(claimed.taskId, claimed.organizationId, input.actorId);
  if (!taskTitle) {
    const run = await repo.failRun({
      runId: claimed.id,
      claimToken,
      reason: "task became inaccessible",
    });
    return { kind: "failed", run };
  }

  try {
    const output = await provider.generate({
      action: claimed.action,
      taskTitle,
      inputs: claimed.inputSnapshot.map((s) => ({
        kind: s.kind,
        content: s.content,
        revision: s.revision,
      })),
    });
    const run = await repo.completeRun({
      runId: claimed.id,
      claimToken,
      artifactText: output.text,
      evidenceRefs: claimed.inputSnapshot.map((s) => `${s.kind}:${s.id}@${s.revision}`),
    });
    return { kind: "complete", run };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "provider failure";
    const run = await repo.failRun({ runId: claimed.id, claimToken, reason: reason.slice(0, 500) });
    return { kind: "failed", run };
  }
}
