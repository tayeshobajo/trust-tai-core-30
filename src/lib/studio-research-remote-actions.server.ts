/** Studio-side browser request adapter. Unregistered, no environment credentials or default transport. */
import { z } from "zod";
import { authorizeStudioResearch } from "./studio-research-access.server";
import { COORDINATOR, approvalSchema, digest } from "./studio-research-coordinator-contracts";
import type { createStudioCoordinatorHandlers } from "./studio-research-coordinator-studio.server";
import type { CoordinatorRequestStore } from "./studio-research-coordinator-request-store.server";
import type { makeRouteClient } from "./studio-research-route-transport.server";
const command = z
  .object({
    operation: z.enum(["run", "read", "cancel", "review", "reconcile"]),
    organizationId: z.literal(COORDINATOR.organizationId),
    requestId: z.string().uuid(),
    review: z
      .object({
        decision: z.enum(["use", "edit", "save", "skip"]),
        editedText: z.string().max(5000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export function makeStudioRemoteActions(
  d: {
    store: CoordinatorRequestStore;
    issuer: ReturnType<typeof createStudioCoordinatorHandlers>;
    send: ReturnType<typeof makeRouteClient>;
  },
  authorize = authorizeStudioResearch,
) {
  return async (request: Request, raw: unknown) => {
    if (request.method !== "POST") throw Error("method_invalid");
    const c = command.parse(raw);
    if ((c.operation === "review") !== Boolean(c.review)) throw Error("review_invalid");
    const auth = await authorize(request, c.organizationId, c.operation !== "read");
    const row = await d.store.read(c.organizationId, c.requestId);
    if (!row || row.created_by !== auth.user.id) throw Error("request_not_owned");
    const a = approvalSchema.parse(row.coordinator_approval);
    if (
      a.approvedBy !== auth.user.id ||
      a.request.organizationId !== c.organizationId ||
      a.request.requestId !== c.requestId ||
      digest(a) !== row.coordinator_approval_digest
    )
      throw Error("approval_mismatch");
    let payload: unknown = c.review ?? {};
    if (c.operation === "run") {
      const grant = await d.issuer.approve(request, {
        organizationId: c.organizationId,
        requestId: c.requestId,
        approvedUrls: a.approvedUrls,
      });
      if (digest(grant.approval) !== digest(a)) throw Error("approval_changed");
      payload = { approval: a, grant: grant.attestation };
    }
    // No browser credentials, cookie, Supabase JWT, or raw user-selected route enters send().
    return d.send({
      companyId: COORDINATOR.companyId,
      projectId: COORDINATOR.projectId,
      agentId: COORDINATOR.agentId,
      organizationId: c.organizationId,
      subjectId: auth.user.id,
      requestId: c.requestId,
      issueId: a.issueId,
      approvalDigest: digest(a),
      operation: c.operation,
      payload,
    });
  };
}
