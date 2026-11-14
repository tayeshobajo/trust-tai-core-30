/** CMD v2 adapter: current user authorization precedes every signed remote action. No approval minting. */
import { attemptActionSchema, attemptViewSchema } from "../domain/studio-attempt-wire";
import { authorizeStudioResearch } from "./studio-research-access.server";
import { attemptBinding, assertAttemptCurrent } from "./studio-research-attempt-contracts.server";
import { type AttemptCallbackRepository } from "./studio-research-attempt-callback.server";
import { type makeRouteClient } from "./studio-research-route-transport.server";
import { COORDINATOR, digest } from "./studio-research-coordinator-contracts";
export function makeStudioAttemptApplication(d: {
  attemptId: string;
  approvalDigest: string;
  repository: AttemptCallbackRepository;
  remote: ReturnType<typeof makeRouteClient>;
  now(): number;
  authorize?: typeof authorizeStudioResearch;
}) {
  return async (request: Request, raw: unknown) => {
    const input = attemptActionSchema.parse(raw);
    if (request.method !== "POST" || input.organizationId !== COORDINATOR.organizationId)
      throw Error("attempt_request_rejected");
    const auth = await (d.authorize ?? authorizeStudioResearch)(
      request,
      input.organizationId,
      input.operation !== "read",
    );
    const { approval } = await d.repository.read(input.attemptId),
      binding = attemptBinding(approval);
    if (
      input.attemptId !== d.attemptId ||
      digest(approval) !== d.approvalDigest ||
      auth.user.id !== approval.subjectId ||
      binding.requestId !== input.requestId ||
      binding.organizationId !== input.organizationId
    )
      throw Error("attempt_owner_mismatch");
    if (input.operation === "start") assertAttemptCurrent(approval, d.now());
    const view = attemptViewSchema.parse(
      await d.remote({
        companyId: COORDINATOR.companyId,
        projectId: COORDINATOR.projectId,
        agentId: COORDINATOR.agentId,
        organizationId: COORDINATOR.organizationId,
        subjectId: approval.subjectId,
        requestId: binding.requestId,
        issueId: binding.issueId,
        approvalDigest: binding.approvalDigest,
        operation: input.operation === "start" ? "run" : input.operation,
        payload: { version: 2, attemptId: approval.attemptId },
      }),
    );
    if (
      view.requestId !== input.requestId ||
      view.attemptId !== input.attemptId ||
      view.priorRunId !== approval.priorRunId
    )
      throw Error("attempt_view_mismatch");
    const persisted = await d.repository.read(input.attemptId);
    if (digest(persisted.approval) !== d.approvalDigest) throw Error("attempt_owner_mismatch");
    const callbackStatus =
      persisted.state.terminal ??
      (persisted.state.cancelled
        ? "cancel_requested"
        : persisted.state.admission
          ? "admitted"
          : "approved");
    const checkedAt = d.now();
    if (!Number.isSafeInteger(checkedAt) || checkedAt < 0) throw Error("attempt_clock_invalid");
    const untouched =
      view.status === "approved" &&
      view.receiptCount === 0 &&
      view.phase === null &&
      view.stopEvidence === "not_attempted" &&
      persisted.state.revision === 0 &&
      persisted.state.admission === null &&
      persisted.state.tokens.length === 0 &&
      persisted.state.terminal === null &&
      !persisted.state.cancelled &&
      persisted.state.packetDigests.length === 0 &&
      persisted.state.result === null;
    const reason =
      checkedAt >= approval.expiresAt
        ? "expired"
        : checkedAt < approval.approvedAt
          ? "not_yet_valid"
          : !auth.access.canWork
            ? "access_denied"
            : !untouched
              ? "attempt_not_untouched"
              : "eligible";
    const launchEligibility = {
      eligible: reason === "eligible",
      checkedAt,
      expiresAt: approval.expiresAt,
      ttlMs: reason === "eligible" ? approval.expiresAt - checkedAt : 0,
      reason,
    };
    const { brief: _remoteBrief, launchEligibility: _remoteEligibility, ...receiptView } = view;
    return attemptViewSchema.parse({
      ...receiptView,
      callbackStatus,
      launchEligibility,
      ...(persisted.state.terminal === "ready" && persisted.state.result
        ? { brief: persisted.state.result }
        : {}),
    });
  };
}
