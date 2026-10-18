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
    /** The explicit replay signal is the ONLY reliable way to distinguish
     *  a replayed run from a fresh one — row content cannot. */
  }): Promise<{ run: CanonicalRun; replayed: boolean }>;
  claimRun(runId: string, actorId: string, leaseSeconds?: number): Promise<CanonicalRun | null>;
  completeRun(input: {
    runId: string;
    claimToken: string;
    artifactText: string;
    evidenceRefs: string[];
  }): Promise<CanonicalRun>;
  failRun(input: { runId: string; claimToken: string; reason: string }): Promise<CanonicalRun>;
  /**
   * Terminal UNCERTAIN transition: the provider outcome is unknown (the
   * call may still have completed server-side), so the run is failed
   * permanently — never requeued. A deliberate new operation UUID is the
   * only way to rerun.
   */
  markRunUncertain(input: {
    runId: string;
    claimToken: string;
    reason: string;
  }): Promise<CanonicalRun>;
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
    inputs: { kind: string; id: string; content: string; revision: number }[];
  }): Promise<{ text: string; evidenceRefs: string[] }>;
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
    const { run, replayed } = await repo.requestRun({
      orgId: input.orgId,
      taskId: input.taskId,
      action: input.action,
      operationId: input.operationId,
      digest,
      inputRefs: input.inputRefs,
      snapshot,
      actorId: input.actorId,
    });
    return { kind: replayed ? "replayed" : "queued", run };
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

/**
 * Fail-closed worker-caller authorization, decided from rows fetched
 * through the caller's OWN RLS-scoped client (so a foreign run is
 * indistinguishable from a nonexistent one). The admin repository
 * validates the run's ORIGINAL requester, not the endpoint caller — this
 * check is what stops an authenticated user from triggering and reading
 * another org's run/artifact by supplying an arbitrary runId. Returns
 * null when authorized, else a denial reason that never discloses whether
 * the run exists.
 */
// Mirrors the SQL authority rules in 001_canonical_runs.up.sql exactly:
// private.steward_user_can_write (active membership + write role) AND
// business-visibility task AND private.steward_user_has_task_authority
// (creator, current owner, or org admin; NULL-safe). Personal tasks are
// out of pilot scope and fail closed for everyone, including the owner.
const WORKER_WRITE_ROLES = new Set([
  "owner",
  "admin",
  "leadership",
  "project_lead",
  "client_support",
  "team_member",
  "member",
]);
const WORKER_ADMIN_ROLES = new Set(["owner", "admin"]);

export function authorizeRunWorkerCaller(input: {
  run: { organizationId: string; taskId: string } | null;
  membership: { status: string; role: string } | null;
  task: { taskVisibility: string; ownerUserId: string | null; createdBy: string | null } | null;
  callerId: string;
}): string | null {
  const denied = "this run is not available to you";
  if (!input.run) return denied;
  const membership = input.membership;
  if (!membership || membership.status !== "active" || !WORKER_WRITE_ROLES.has(membership.role)) {
    return denied;
  }
  const task = input.task;
  if (!task || task.taskVisibility !== "business") return denied;
  const isAdmin = WORKER_ADMIN_ROLES.has(membership.role);
  if (task.createdBy !== input.callerId && task.ownerUserId !== input.callerId && !isAdmin) {
    return denied;
  }
  return null;
}

/**
 * Full worker-endpoint authorization: performs the three RLS-scoped reads
 * with the ACTUAL column names (steward_tasks.task_visibility, not
 * "visibility") and composes authorizeRunWorkerCaller. A foreign or
 * nonexistent runId is indistinguishable — RLS returns nothing and the
 * caller learns only "not available to you". No privileged client is
 * touched before this returns null.
 */
export async function authorizeWorkerEndpoint(
  rls: {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => {
              maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
            };
            maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
          };
          maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
        };
      };
    };
  },
  input: { runId: string; callerId: string },
): Promise<{ run: { organizationId: string; taskId: string } } | { denial: string }> {
  const { data: run } = await rls
    .from("steward_canonical_runs")
    .select("id, organization_id, task_id")
    .eq("id", input.runId)
    .maybeSingle();
  if (!run) return { denial: "this run is not available to you" };
  const organizationId = run["organization_id"] as string;
  const taskId = run["task_id"] as string;
  const { data: membership } = await rls
    .from("organization_memberships")
    .select("status, role")
    .eq("organization_id", organizationId)
    .eq("user_id", input.callerId)
    .maybeSingle();
  const { data: task } = await rls
    .from("steward_tasks")
    .select("task_visibility, owner_user_id, created_by")
    .eq("organization_id", organizationId)
    .eq("id", taskId)
    .maybeSingle();
  const denial = authorizeRunWorkerCaller({
    run: { organizationId, taskId },
    membership: membership
      ? { status: membership["status"] as string, role: membership["role"] as string }
      : null,
    task: task
      ? {
          taskVisibility: task["task_visibility"] as string,
          ownerUserId: (task["owner_user_id"] as string | null) ?? null,
          createdBy: (task["created_by"] as string | null) ?? null,
        }
      : null,
    callerId: input.callerId,
  });
  if (denial) return { denial };
  return { run: { organizationId, taskId } };
}

export type ExecuteCanonicalRunResult =
  | { kind: "complete"; run: CanonicalRun }
  | { kind: "not_claimed" }
  | { kind: "failed"; run: CanonicalRun }
  | { kind: "uncertain"; run: CanonicalRun };

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

  try {
    // The task title is mutable and read AFTER the snapshot was frozen; it
    // is prompt context only, never evidence. Read it inside the guarded
    // section so a read failure finalizes the run honestly instead of
    // escaping as an unhandled rejection that leaves the lease running.
    const taskTitle = await repo.readTaskTitle(claimed.taskId, claimed.organizationId, input.actorId);
    if (!taskTitle) {
      const run = await repo.failRun({
        runId: claimed.id,
        claimToken,
        reason: "task became inaccessible",
      });
      return { kind: "failed", run };
    }

    const output = await provider.generate({
      action: claimed.action,
      taskTitle,
      inputs: claimed.inputSnapshot.map((s) => ({
        kind: s.kind,
        id: s.id,
        content: s.content,
        revision: s.revision,
      })),
    });
    // Persist EXACTLY the cited subset the provider returned — never all
    // inputs as if cited. The provider rejects empty/invalid citations, so
    // output.evidenceRefs is a validated non-empty subset at this point.
    const run = await repo.completeRun({
      runId: claimed.id,
      claimToken,
      artifactText: output.text,
      evidenceRefs: output.evidenceRefs,
    });
    return { kind: "complete", run };
  } catch (error) {
    const reason = (error instanceof Error ? error.message : "provider failure").slice(0, 480);
    // Uncertain outcomes (timeout/abort — the call may still have
    // completed) are TERMINAL: persist honestly, never auto-retry. Only a
    // deliberate new operation UUID can rerun.
    if (error instanceof Error && error.name === "ProviderOutcomeUncertainError") {
      const run = await repo.markRunUncertain({ runId: claimed.id, claimToken, reason });
      return { kind: "uncertain", run };
    }
    const run = await repo.failRun({ runId: claimed.id, claimToken, reason });
    return { kind: "failed", run };
  }
}
