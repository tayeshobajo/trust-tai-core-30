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
    const callbackStatus =
      persisted.state.terminal ??
      (persisted.state.cancelled
        ? "cancel_requested"
        : persisted.state.admission
          ? "admitted"
          : "approved");
    const { brief: _remoteBrief, ...receiptView } = view;
    return attemptViewSchema.parse({ ...receiptView, callbackStatus, ...(persisted.state.terminal === "ready" && persisted.state.result ? { brief: persisted.state.result } : {}) });
  };
}
