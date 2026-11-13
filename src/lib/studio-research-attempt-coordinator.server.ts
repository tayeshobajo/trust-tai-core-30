/** Source-held v2 coordinator. Explicit pinned approval provisioning is required; no entrypoint auto-upgrades v1. */
import { z } from "zod";
import { type KeyObject } from "node:crypto";
import {
  digest,
  coordinatorPrompt,
  profileSchema,
  COORDINATOR,
} from "./studio-research-coordinator-contracts";
import {
  attemptBinding,
  assertAttemptCurrent,
  type AttemptApproval,
} from "./studio-research-attempt-contracts.server";
import {
  createTimedExecutionCandidate,
  createTimingRecorder,
  type TimingDependencies,
} from "./studio-research-timing-candidate.server";
import { type AttemptStore } from "./studio-research-attempt-store.server";
import { signAttemptPacket, type AdmissionV2 } from "./studio-research-attempt-callback.server";
import { type SourceEvidence } from "./studio-research-source-evidence.server";
import { type ExecutionInput } from "./studio-research-coordinator.server";
import { validateSourceReceipt } from "./studio-research-manual-test.server";
type RuntimeResult = { text: string; nativeSessionId: string; bindingDigest: string };
const ackSchema = z
  .object({
    version: z.literal(2),
    bindingDigest: z.string(),
    admissionDigest: z.string(),
    view: z.unknown(),
  })
  .strict();
export function createAttemptCoordinator<P extends { bindingDigest: string }>(d: {
  approval: AttemptApproval;
  pinnedApprovalDigest: string;
  store: AttemptStore;
  signer: KeyObject;
  now(): number;
  collect(approval: AttemptApproval, signal: AbortSignal): Promise<SourceEvidence[]>;
  runtime: {
    prepare(
      input: Omit<ExecutionInput, "launchDeadline" | "completionDeadline">,
      binding: ReturnType<typeof attemptBinding>,
    ): Promise<P>;
    dispose(prepared: P): void;
    spawn: TimingDependencies<P, RuntimeResult>["spawn"];
  };
  /** Must freshly authenticate scoped host bridge, paused target, exact owned issue and current Studio approval/admission. */
  authority(
    approval: AttemptApproval,
    admissionDigest: string,
    signal: AbortSignal,
  ): Promise<{
    bindingDigest: string;
    admissionDigest: string;
    approvalDigest: string;
    checkedAt: number;
    expiresAt: number;
  }>;
  /** Signed route transport, with no retries. Implementations must honor signal. */
  callback(attemptId: string, token: string, signal: AbortSignal): Promise<unknown>;
}) {
  const a = d.approval,
    binding = attemptBinding(a);
  if (digest(a) !== d.pinnedApprovalDigest || digest(d.store.read(a.attemptId)) !== digest(a))
    throw Error("attempt_not_pinned");
  return {
    async run(invocationDeadline: number, externalSignal: AbortSignal) {
      assertAttemptCurrent(a, d.now());
      const cancel = new AbortController();
      const signal = AbortSignal.any([cancel.signal, externalSignal]);
      if (d.store.cancelled(a.attemptId)) cancel.abort();
      const poll = setInterval(() => {
        if (d.store.cancelled(a.attemptId)) cancel.abort();
      }, 25);
      let admission: AdmissionV2 | undefined;
      let admitted = false;
      const send = async (
        operation: "admission" | "result",
        result: RuntimeResult | null,
        activeSignal: AbortSignal,
      ) => {
        if (!admission || activeSignal.aborted) throw Error("attempt_callback_unavailable");
        const now = d.now(),
          expiresAt = Math.min(
            now + 30000,
            admission.totalDeadline + 5000,
            operation === "result" && result === null ? Number.MAX_SAFE_INTEGER : a.expiresAt,
            invocationDeadline,
          );
        if (expiresAt <= now) throw Error("attempt_settlement_expired");
        const token = signAttemptPacket(
          {
            domain: "studio-attempt-callback/v2",
            binding,
            issuedAt: now,
            expiresAt,
            operation,
            admission,
            result,
            tokens: d.store.tokens(a.attemptId),
          },
          d.signer,
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new AbortController();
        try {
          const ack = ackSchema.parse(
            await Promise.race([
              d.callback(a.attemptId, token, AbortSignal.any([activeSignal, timeout.signal])),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                  timeout.abort();
                  reject(Error("attempt_callback_timeout"));
                }, expiresAt - now);
              }),
            ]),
          );
          if (
            d.now() >= expiresAt ||
            activeSignal.aborted ||
            ack.bindingDigest !== digest(binding) ||
            ack.admissionDigest !== digest(admission)
          )
            throw Error("attempt_callback_unconfirmed");
          return ack.view;
        } finally {
          clearTimeout(timer);
        }
      };
      const record = createTimingRecorder(d.signer, binding, (token) =>
        d.store.append(a.attemptId, token),
      );
      const execute = createTimedExecutionCandidate({
        now: d.now,
        claim: (b) => d.store.claim(b, d.now()),
        record,
        prepare: async (activeSignal: AbortSignal) => {
          const evidence = await d.collect(a, activeSignal);
          validateSourceReceipt(a.historicalApproval, evidence);
          if (activeSignal.aborted) throw Error("attempt_cancelled");
          const prompt = coordinatorPrompt(a.historicalApproval, evidence);
          const runtime = await d.runtime.prepare(
            {
              requestId: binding.requestId,
              issueId: binding.issueId,
              runId: binding.runId,
              sessionId: a.sessionId,
              nonce: a.nonce,
              prompt,
              signal: activeSignal,
              profile: profileSchema.parse({
                primaryModel: COORDINATOR.model,
                auxiliaryModel: COORDINATOR.model,
                endpoint: COORDINATOR.endpoint,
                nativeTools: "deny",
                maxProviderRequests: null,
                maxCliJobs: 1,
                timeoutMs: 60000,
                freshSession: true,
                retries: 0,
                genericWake: false,
                runtimeLogs: false,
              }),
            },
            binding,
          );
          return { runtime, evidence, prompt };
        },
        dispose: (p) => d.runtime.dispose(p.runtime),
        admit: async (p, activeSignal, deadlines) => {
          admission = {
            evidence: p.evidence,
            promptDigest: digest(p.prompt),
            runtimeBindingDigest: p.runtime.bindingDigest,
            ...deadlines,
          };
          await send("admission", null, activeSignal);
          admitted = true;
        },
        authorize: async (_p, activeSignal) => {
          if (!admission || d.store.cancelled(a.attemptId)) throw Error("attempt_cancelled");
          const auth = await d.authority(a, digest(admission), activeSignal);
          if (
            auth.bindingDigest !== digest(binding) ||
            auth.admissionDigest !== digest(admission) ||
            d.store.cancelled(a.attemptId)
          )
            throw Error("attempt_authority_mismatch");
          return auth;
        },
        spawn: (p, activeSignal, deadlines) => d.runtime.spawn(p.runtime, activeSignal, deadlines),
      });
      try {
        const result = await execute({
          ...binding,
          policyDigest: a.policyDigest,
          approvalExpiresAt: a.expiresAt,
          invocationDeadline,
          signal,
        });
        const view = await send("result", result.value, signal);
        d.store.settle(a.attemptId, "complete", d.now());
        return view;
      } catch {
        // One failure settlement, never a retry of an ambiguous admission or result delivery.
        const tokens = d.store.tokens(a.attemptId);
        if (
          admitted &&
          tokens.some((t) => {
            try {
              return (
                JSON.parse(Buffer.from(t.split(".")[0]!, "base64url").toString()).event === "failed"
              );
            } catch {
              return false;
            }
          })
        ) {
          try {
            await send("result", null, new AbortController().signal);
          } catch {
            /* durable local uncertainty */
          }
        }
        // No second run and no implicit callback retry. Persist uncertainty even if callback cannot settle.
        if (!d.store.outcome(a.attemptId)) d.store.settle(a.attemptId, "uncertain", d.now());
        throw Error("attempt_uncertain");
      } finally {
        clearInterval(poll);
      }
    },
    cancel() {
      d.store.cancel(a.attemptId, d.now());
    },
  };
}
