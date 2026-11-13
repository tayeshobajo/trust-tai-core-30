/** Explicit v2 source entrypoint. The installed v3 bootstrap remains unchanged until separately deployed. */
import { z } from "zod";
import { createPublicKey, type KeyObject } from "node:crypto";
import {
  type RouteLedger,
  type RouteEnvelope,
  makeRouteClient,
  ROUTES,
} from "../../../src/lib/studio-research-route-transport.server";
import { makeHostAdmittedRoutePlugin } from "./host-admitted-routes";
import { AttemptStore } from "../../../src/lib/studio-research-attempt-store.server";
import { createAttemptCoordinator } from "../../../src/lib/studio-research-attempt-coordinator.server";
import { createLinuxTimingAdapter } from "../../../src/lib/studio-research-linux-runtime.server";
import {
  attemptBinding,
  assertAttemptCurrent,
} from "../../../src/lib/studio-research-attempt-contracts.server";
import {
  initialAttemptState,
  projectAttempt,
} from "../../../src/lib/studio-research-attempt-callback.server";
import { createPublicSourceReader } from "../../../src/lib/studio-research-public-source.server";
import { digest } from "../../../src/lib/studio-research-coordinator-contracts";
import { TIMING_POLICY_DIGEST } from "../../../src/lib/studio-research-timing-candidate.server";
export const timingPreviewConfigSchema = z
  .object({
    version: z.literal(4),
    policyDigest: z.literal(TIMING_POLICY_DIGEST),
    attemptId: z.string().uuid(),
    approvalDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export function attemptInvocationDeadline(routeExpiry: number, hostExpiry: number) {
  z.number().int().nonnegative().parse(routeExpiry);
  z.number().int().nonnegative().parse(hostExpiry);
  return Math.min(routeExpiry, hostExpiry);
}
export function makeTimingPreview(d: {
  config: unknown;
  store: AttemptStore;
  ledger: RouteLedger;
  studioKey: KeyObject;
  callbackKey: KeyObject;
  privateKey: KeyObject;
  providerKey(): Promise<string>;
  fetcher: typeof fetch;
  now(): number;
  shutdownSignal: AbortSignal;
  /** Must revalidate the exact host admission/key/paused agent/owned issue, including immediately before spawn. */
  hostAdmissionExpiresAt: number;
  revalidateHost(e: RouteEnvelope): Promise<void>;
}) {
  const config = timingPreviewConfigSchema.parse(d.config),
    approval = d.store.read(config.attemptId),
    binding = attemptBinding(approval);
  if (config.approvalDigest !== digest(approval)) throw Error("attempt_pin_mismatch");
  const hostPublicKey = createPublicKey(d.privateKey),
    reader = createPublicSourceReader();
  const send = makeRouteClient({
    sender: "coordinator",
    privateKey: d.privateKey,
    peerKey: d.callbackKey,
    callbackEndpoint: ROUTES.callback,
    now: d.now,
    fetcher: d.fetcher,
  });
  const payloadSchema = z
    .object({ version: z.literal(2), attemptId: z.literal(config.attemptId) })
    .strict();
  const check = (e: RouteEnvelope) => {
    payloadSchema.parse(e.payload);
    if (
      !["run", "read", "cancel"].includes(e.operation) ||
      e.requestId !== binding.requestId ||
      e.issueId !== binding.issueId ||
      e.subjectId !== binding.subjectId ||
      e.approvalDigest !== binding.approvalDigest
    )
      throw Error("attempt_route_binding");
  };
  const view = () => {
    const outcome = d.store.outcome(approval.attemptId);
    return projectAttempt(
      approval,
      {
        ...initialAttemptState(),
        tokens: d.store.tokens(approval.attemptId),
        cancelled: d.store.cancelled(approval.attemptId),
        terminal: outcome === "complete" ? "ready" : outcome,
      },
      hostPublicKey,
    );
  };
  const authority = async (
    e: RouteEnvelope,
    admissionDigest: string | null,
    signal: AbortSignal = d.shutdownSignal,
  ) => {
    const reply = z
      .object({
        version: z.literal(2),
        bindingDigest: z.string(),
        admissionDigest: z.string().nullable(),
        approvalDigest: z.string(),
        checkedAt: z.number().int(),
        expiresAt: z.number().int(),
      })
      .strict()
      .parse(
        await send(
          {
            ...e,
            operation: "authority",
            payload: {
              version: 2,
              attemptId: approval.attemptId,
              admissionDigest,
              action: e.operation,
            },
          },
          { signal, deadline: Math.min(e.expiresAt, d.hostAdmissionExpiresAt) },
        ),
      );
    await d.revalidateHost(e);
    if (
      e.expiresAt <= d.now() ||
      reply.bindingDigest !== digest(binding) ||
      reply.approvalDigest !== digest(approval) ||
      reply.admissionDigest !== admissionDigest
    )
      throw Error("attempt_authority_mismatch");
    return reply;
  };
  return makeHostAdmittedRoutePlugin({
    peerKey: d.studioKey,
    privateKey: d.privateKey,
    now: d.now,
    ledger: d.ledger,
    authorizeCurrent: async (e) => {
      check(e);
      await authority(e, null);
    },
    dispatch: async (e) => {
      check(e);
      if (e.operation === "cancel") {
        d.store.cancel(approval.attemptId, d.now());
        return view();
      }
      if (e.operation === "read") return view();
      assertAttemptCurrent(approval, d.now());
      const coordinator = createAttemptCoordinator<
        Awaited<ReturnType<ReturnType<typeof createLinuxTimingAdapter>["prepare"]>>
      >({
        approval,
        pinnedApprovalDigest: config.approvalDigest,
        store: d.store,
        signer: d.privateKey,
        now: d.now,
        runtime: createLinuxTimingAdapter({
          providerKey: d.providerKey,
          shutdownSignal: d.shutdownSignal,
        }),
        collect: async (a, signal) => {
          if (signal.aborted) throw Error("attempt_cancelled");
          return reader(
            a.historicalApproval.approvedUrls,
            a.historicalApproval.approvedUrls,
            signal,
          );
        },
        authority: async (_a, admissionDigest, signal) => {
          if (signal.aborted) throw Error("attempt_cancelled");
          const a = await authority(e, admissionDigest, signal);
          if (!a.admissionDigest) throw Error("attempt_admission_missing");
          return { ...a, admissionDigest: a.admissionDigest };
        },
        callback: async (_id, token, signal) => {
          if (signal.aborted) throw Error("attempt_cancelled");
          // Stage is signed inside the packet; callback cross-checks it against the outer operation.
          const packet = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString());
          return send(
            {
              ...e,
              operation: packet.operation,
              payload: { version: 2, attemptId: approval.attemptId, receipt: token },
            },
            { signal, deadline: Math.min(e.expiresAt, d.hostAdmissionExpiresAt) },
          );
        },
      });
      await coordinator.run(
        attemptInvocationDeadline(e.expiresAt, d.hostAdmissionExpiresAt),
        d.shutdownSignal,
      );
      return view();
    },
  });
}
