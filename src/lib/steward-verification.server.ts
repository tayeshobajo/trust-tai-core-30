/**
 * STAGED — NOT WIRED TO ANY ROUTE. Atomic evidence-backed verification and
 * reopen for canonical Steward board tasks.
 *
 * Application-side half of the UNAPPLIED proposal in
 * `docs/proposed/steward-backend/002_atomic_verification.up.sql`. One RPC
 * performs authority + expected-revision check + evidence receipt + audit +
 * status update in a single transaction; any failure rolls back everything.
 * The legacy best-effort `completeTask` path is never used for canonical
 * board work.
 */

import { classifyMutationError } from "./steward-mutation-outcome";

export interface TaskReceipt {
  id: string;
  organizationId: string;
  taskId: string;
  operationId: string;
  /** Durable event kind — verify receipts and reopen receipts must never
      be rendered as the same thing. */
  kind: "verify" | "reopen";
  note: string;
  actorId: string;
  createdAt: string;
  /** The task revision recorded with the receipt — verified credit exists
      only while this equals the task's CURRENT revision. */
  taskRevisionAfter: number;
}

export interface VerificationTaskState {
  id: string;
  status: "open" | "complete";
  revision: number;
  completionEvidence: string | null;
  completedAt: string | null;
  completedBy: string | null;
}

export class RevisionConflictError extends Error {
  readonly code = "P0001";
  constructor(message = "task changed since you loaded it; reload and retry") {
    super(message);
    this.name = "RevisionConflictError";
  }
}

export class EvidenceRequiredError extends Error {
  readonly code = "P0010";
  constructor(message = "a substantive evidence note (at least 10 characters) is required") {
    super(message);
    this.name = "EvidenceRequiredError";
  }
}

/** Minimal repository contract over the proposed SQL functions. */
export interface VerificationRepository {
  verifyTask(input: {
    orgId: string;
    taskId: string;
    expectedRevision: number;
    operationId: string;
    note: string;
    actorId: string;
  }): Promise<{ task: VerificationTaskState | null; receipt: TaskReceipt; replayed: boolean }>;
  reopenTask(input: {
    orgId: string;
    taskId: string;
    expectedRevision: number;
    operationId: string;
    reason: string;
    actorId: string;
  }): Promise<{ task: VerificationTaskState | null; replayed: boolean }>;
}

export type VerificationResult =
  | {
      kind: "verified";
      task: VerificationTaskState | null;
      receipt: TaskReceipt;
      replayed: boolean;
    }
  | { kind: "revision_conflict"; message: string }
  | { kind: "evidence_required"; message: string }
  | { kind: "rejected"; message: string }
  /* Transport/5xx/malformed-response ambiguity AFTER the request was sent:
     the mutation may have committed. The caller keeps the pending
     operation and retries with the SAME id — never reports rejection. */
  | { kind: "uncertain"; message: string };

/** Verify a canonical task atomically. Duplicate operations replay the
 *  existing receipt instead of double-recording. */
export async function verifyCanonicalTask(
  repo: VerificationRepository,
  input: {
    orgId: string;
    taskId: string;
    expectedRevision: number;
    operationId: string;
    note: string;
    actorId: string;
  },
): Promise<VerificationResult> {
  if (input.note.trim().length < 10) {
    return { kind: "evidence_required", message: "evidence note must be at least 10 characters" };
  }
  try {
    const { task, receipt, replayed } = await repo.verifyTask(input);
    return { kind: "verified", task, receipt, replayed };
  } catch (error) {
    return mapVerificationError(error);
  }
}

export type ReopenResult =
  | { kind: "reopened"; task: VerificationTaskState | null; replayed: boolean }
  | { kind: "revision_conflict"; message: string }
  | { kind: "evidence_required"; message: string }
  | { kind: "rejected"; message: string }
  | { kind: "uncertain"; message: string };

/** Reopen a canonical task atomically. All prior evidence and audit rows
 *  are preserved; the reopen itself is appended to the same audit trail. */
export async function reopenCanonicalTask(
  repo: VerificationRepository,
  input: {
    orgId: string;
    taskId: string;
    expectedRevision: number;
    operationId: string;
    reason: string;
    actorId: string;
  },
): Promise<ReopenResult> {
  if (input.reason.trim().length < 10) {
    return { kind: "evidence_required", message: "reopen reason must be at least 10 characters" };
  }
  try {
    const { task, replayed } = await repo.reopenTask(input);
    return { kind: "reopened", task, replayed };
  } catch (error) {
    return mapVerificationError(error);
  }
}

function mapVerificationError(error: unknown): {
  kind: "revision_conflict" | "evidence_required" | "rejected" | "uncertain";
  message: string;
} {
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : "verification failed";
  if (code === "P0001" || error instanceof RevisionConflictError)
    return { kind: "revision_conflict", message };
  if (code === "P0010" || error instanceof EvidenceRequiredError)
    return { kind: "evidence_required", message };
  /* Known SQL contract answers (authorization, not-found, operation
     conflict) are resolved rejections; anything else — transport loss,
     5xx, malformed response after send — is UNCERTAIN: the mutation may
     have committed, so the caller keeps the pending operation for a
     same-id replay instead of reporting rejection. */
  const classified = classifyMutationError(error);
  if (classified.kind === "uncertain") return classified;
  return { kind: "rejected", message: classified.message };
}
