/**
 * Shared mutation-error classification for the STAGED Steward backend.
 *
 * A mutation call ends in one of three honest ways:
 * - a KNOWN durable answer from the SQL contract (validation,
 *   authorization, revision/operation/state conflicts) — safe to show as
 *   rejected/conflict, the operation is resolved;
 * - an UNKNOWN outcome: transport failure, 5xx, or a malformed response
 *   after the request was sent. The mutation may have committed. This is
 *   `uncertain` — the caller MUST keep the pending operation and offer a
 *   same-id replay, never report rejection.
 *
 * Raw internals (stack traces, PostgREST details) are never propagated for
 * uncertain outcomes.
 */

export type MutationErrorKind = "conflict" | "rejected" | "uncertain";

/** SQL errcodes raised by the reviewed Steward contracts. Anything else
    (no code, PGRST gateway codes, TypeError fetch failures, 5xx) means the
    durable outcome is unknown. */
const KNOWN_CODES: Record<string, MutationErrorKind> = {
  P0001: "rejected", // revision_conflict
  P0002: "conflict", // operation_conflict (same id, different payload)
  P0010: "rejected", // validation (evidence/reason required)
  P0030: "conflict", // state conflict (already linked/removed/in scope)
  P0031: "rejected", // removed scope item requires explicit reinstate
  P0032: "conflict", // proposal already dismissed
  P0401: "rejected", // not_authorized
  P0404: "rejected", // not_found
  P0405: "rejected", // guarded mutation path
  P0422: "rejected", // invalid input
};

export const UNCERTAIN_MUTATION_MESSAGE =
  "The request may have completed, but the response was lost. Retry replays the same operation — it never re-executes.";

export function classifyMutationError(
  error: unknown,
):
  | { kind: "conflict"; message: string }
  | { kind: "rejected"; message: string }
  | { kind: "uncertain"; message: string } {
  const code = (error as { code?: string } | null)?.code;
  const known = code ? KNOWN_CODES[code] : undefined;
  if (known) {
    const message = error instanceof Error ? error.message : "the operation was not applied";
    return { kind: known, message };
  }
  /* Message-based fallbacks for adapters that translate SQL raises into
     typed errors without preserving the errcode. */
  const message = error instanceof Error ? error.message : "";
  if (message.includes("operation_conflict")) {
    return {
      kind: "conflict",
      message: "this operation was already recorded with different inputs",
    };
  }
  if (
    message.includes("revision_conflict") ||
    message.includes("not_authorized") ||
    message.includes("evidence_required") ||
    message.includes("reason_required") ||
    message.includes("not_found") ||
    message.includes("scope_item_removed_requires_reinstate") ||
    message.includes("source_changed_since_review")
  ) {
    return { kind: "rejected", message };
  }
  if (
    message.includes("already_linked") ||
    message.includes("already_dismissed") ||
    message.includes("already_removed") ||
    message.includes("task_already_in_scope")
  ) {
    return { kind: "conflict", message };
  }
  return { kind: "uncertain", message: UNCERTAIN_MUTATION_MESSAGE };
}

/** Narrowed classification for entrypoints whose public state only
    distinguishes resolved rejections from uncertainty: a known SQL
    conflict is a resolved answer, surfaced as a rejection with its
    message. */
export function classifyMutationErrorNarrow(error: unknown): {
  kind: "rejected" | "uncertain";
  message: string;
} {
  const classified = classifyMutationError(error);
  return classified.kind === "conflict"
    ? { kind: "rejected", message: classified.message }
    : classified;
}
