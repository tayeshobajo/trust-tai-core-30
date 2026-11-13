/** V2 callback route assembly, using the existing signed transport with its own durable nonce ledger. */
import { z } from "zod";
import { type KeyObject } from "node:crypto";
import {
  makeRouteHandler,
  ROUTES,
  type RouteEnvelope,
  type RouteLedger,
} from "./studio-research-route-transport.server";
import {
  createAttemptCallback,
  packetV2Schema,
  type AttemptCallbackRepository,
} from "./studio-research-attempt-callback.server";
import {
  attemptBinding,
  assertAttemptCurrent,
  type AttemptApproval,
} from "./studio-research-attempt-contracts.server";
import { digest } from "./studio-research-coordinator-contracts";
import { verifySignedJson } from "./studio-research-coordinator-authority.server";
const authorityPayload = z
  .object({
    version: z.literal(2),
    attemptId: z.string().uuid(),
    admissionDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    action: z.enum(["run", "read", "cancel"]),
  })
  .strict();
const receiptPayload = z
  .object({ version: z.literal(2), attemptId: z.string().uuid(), receipt: z.string().max(190000) })
  .strict();
export function makeAttemptCallbackRoutes(d: {
  repository: AttemptCallbackRepository;
  ledger: RouteLedger;
  hostKey: KeyObject;
  privateKey: KeyObject;
  now(): number;
  /** Existing backend membership/work-access and root request ownership checks, including revocation. */
  authorizeCurrent(approval: AttemptApproval, work: boolean): Promise<void>;
}) {
  const payload = (e: RouteEnvelope) =>
    e.operation === "authority"
      ? authorityPayload.parse(e.payload)
      : receiptPayload.parse(e.payload);
  const owned = async (e: RouteEnvelope) => {
    const p = payload(e),
      row = await d.repository.read(p.attemptId),
      b = attemptBinding(row.approval);
    if (
      e.requestId !== b.requestId ||
      e.issueId !== b.issueId ||
      e.subjectId !== b.subjectId ||
      e.approvalDigest !== b.approvalDigest
    )
      throw Error("attempt_route_binding");
    await d.authorizeCurrent(
      row.approval,
      e.operation !== "authority" || !("action" in p) || p.action !== "read",
    );
    return row;
  };
  const callback = createAttemptCallback({
    repository: d.repository,
    peerKey: d.hostKey,
    now: d.now,
    authorizeCurrent: (a) => d.authorizeCurrent(a, true),
  });
  return makeRouteHandler({
    receiver: "studio",
    callbackEndpoint: ROUTES.callback,
    peerKey: d.hostKey,
    privateKey: d.privateKey,
    now: d.now,
    ledger: d.ledger,
    authenticate: async () => {}, // Exact host signature is verified by makeRouteHandler before this hook.
    authorizeCurrent: async (e) => {
      await owned(e);
    },
    dispatch: async (e) => {
      const row = await owned(e);
      if (e.operation === "authority") {
        const p = authorityPayload.parse(e.payload);
        if (p.action === "cancel") {
          if (!d.repository.cancel) throw Error("attempt_cancel_unavailable");
          await d.repository.cancel(p.attemptId);
        }
        if (p.action === "run") {
          assertAttemptCurrent(row.approval, d.now());
          if (row.state.cancelled || row.state.terminal) throw Error("attempt_not_current");
        }
        if (
          p.admissionDigest !== null &&
          (p.action !== "run" ||
            !row.state.admission ||
            digest(row.state.admission) !== p.admissionDigest)
        )
          throw Error("attempt_admission_mismatch");
        return {
          version: 2,
          bindingDigest: digest(attemptBinding(row.approval)),
          admissionDigest: p.admissionDigest,
          approvalDigest: digest(row.approval),
          checkedAt: d.now(),
          expiresAt: row.approval.expiresAt,
        };
      }
      const p = receiptPayload.parse(e.payload),
        packet = packetV2Schema.parse(verifySignedJson(d.hostKey, p.receipt));
      if (packet.operation !== e.operation) throw Error("attempt_stage_mismatch");
      return callback(p.attemptId, p.receipt);
    },
  });
}
