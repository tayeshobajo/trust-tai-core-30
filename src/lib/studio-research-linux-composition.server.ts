/** Explicit one-preview host composition. No application registration, ambient credentials or host mutations. */
import { createPublicKey, sign } from "node:crypto";
import {
  createManualResearchComposition,
  type CompositionDeps,
} from "./studio-research-composition.server";
import {
  createLinuxPreviewExecutor,
  inspectProtectedLinuxExecutable,
  type LinuxPreviewSetup,
} from "./studio-research-linux-runtime.server";
import {
  COORDINATOR,
  LINUX_PREVIEW_POLICY_SHA256,
  profileSchema,
  digest,
} from "./studio-research-coordinator-contracts";
import type { ExecutionInput } from "./studio-research-coordinator.server";
export async function createLinuxPublicPreviewComposition(
  d: Omit<CompositionDeps, "mode" | "runtime" | "runtimePublicKey"> &
    LinuxPreviewSetup & {
      completionDeadline(): number;
      trackRuntime?(
        handle: Awaited<ReturnType<ReturnType<typeof createLinuxPreviewExecutor>["start"]>>,
      ): void;
    },
) {
  const executor = createLinuxPreviewExecutor({
    providerKey: d.providerKey,
    authorizeCurrent: d.authorizeCurrent,
    ...(d.shutdownSignal ? { shutdownSignal: d.shutdownSignal } : {}),
  });
  let active:
    { input: ExecutionInput; handle: Awaited<ReturnType<typeof executor.start>> } | undefined;
  return createManualResearchComposition({
    ...d,
    mode: "linux-public-preview",
    runtimePublicKey: createPublicKey(d.hostPrivateKey),
    runtime: {
      async inspectPolicy() {
        inspectProtectedLinuxExecutable();
        const body = Buffer.from(
          JSON.stringify({
            domain: "studio-runtime-policy/v1",
            policyDigest: LINUX_PREVIEW_POLICY_SHA256,
            mode: "linux-public-preview",
            issuedAt: d.now(),
            expiresAt: d.now() + 5000,
          }),
        );
        return (
          body.toString("base64url") +
          "." +
          sign(null, body, d.hostPrivateKey).toString("base64url")
        );
      },
      async profile() {
        return profileSchema.parse({
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
        });
      },
      async start(input) {
        const boundedInput = {
          ...input,
          completionDeadline: Math.min(input.completionDeadline, d.completionDeadline()),
        };
        const handle = await executor.start(boundedInput);
        active = { input: boundedInput, handle };
        d.trackRuntime?.(handle);
        return handle;
      },
      async stopExact(command) {
        const job = d.store.read(command.requestId);
        if (
          !active ||
          !job ||
          job.approvalDigest !== command.approvalDigest ||
          digest({
            requestId: active.input.requestId,
            runId: active.input.runId,
            sessionId: active.input.sessionId,
            nonce: active.input.nonce,
          }) !==
            digest({
              requestId: command.requestId,
              runId: command.runId,
              sessionId: command.sessionId,
              nonce: command.nonce,
            })
        )
          throw Error("stop_binding_invalid");
        await active.handle.stop();
        // Existing acknowledgement means fully stopped. Process-group evidence cannot establish it.
        throw Error("stop_scope_unconfirmed");
      },
    },
  });
}
