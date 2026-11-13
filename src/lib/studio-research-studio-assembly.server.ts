import { recoverReservedIntake, recoveryTransport, verifyRecoveredIssue } from "./studio-research-intake-recovery.server";
import { assertActiveSigningKey } from "./studio-research-active-signing-key.server";
import {
  trialConfigSchema,
  assertTrialScope,
  assertTrialWindow,
  type TrialConfig,
} from "./studio-research-trial.server";
import { manualActionSchema } from "@/domain/studio-manual-wire";
import { createSupabaseRouteLedger } from "./studio-research-route-ledger-supabase.server";
/** Local Studio-side assembly; deliberately not installed in application startup. */
import type { KeyObject } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeStudioResearch } from "./studio-research-access.server";
import { createCoordinatorRequestStore } from "./studio-research-coordinator-request-store.server";
import { createStudioCoordinatorHandlers } from "./studio-research-coordinator-studio.server";
import { makeRouteClient, makeRouteHandler } from "./studio-research-route-transport.server";
import { makeStudioRemoteActions } from "./studio-research-remote-actions.server";
import { makeStudioReceiptOperations } from "./studio-research-route-operations.server";
import { makeStudioCurrentMember } from "./studio-research-current-member.server";
import { makeStudioApplication } from "./studio-research-app.server";
import { prepareManualResearchRequest } from "./studio-research-manual-intake.server";
import { createResearchStore } from "./studio-research-store.server";
import { createStudioTransport } from "./studio-research-transport.server.mjs";
import { COORDINATOR } from "./studio-research-coordinator-contracts";
function assembleStudio(
  d: {
    mode: "offline-synthetic" | "linux-public-preview";
    trial?: TrialConfig;
    studioPrivateKey: KeyObject;
    coordinatorPublicKey: KeyObject;
    serviceKey: string;
    bridgeKey: string;
    client: Pick<SupabaseClient, "from">;
    fetcher: typeof fetch;
    now(): number;
  },
  authorize = authorizeStudioResearch,
) {
  if (!["offline-synthetic", "linux-public-preview"].includes(d.mode))
    throw Error("studio_assembly_unavailable");
  for (const [key, type] of [
    [d.studioPrivateKey, "private"],
    [d.coordinatorPublicKey, "public"],
  ] as const)
    if (key.type !== type || key.asymmetricKeyType !== "ed25519") throw Error("signer_invalid");
  const trial = d.mode === "linux-public-preview" ? trialConfigSchema.parse(d.trial) : undefined;
  if (trial) {
    assertActiveSigningKey(d.studioPrivateKey);
    assertActiveSigningKey(d.coordinatorPublicKey);
  }
  const scopedAuthorize: typeof authorize = async (request, org, write) => {
    const auth = await authorize(request, org, write);
    if (trial) assertTrialScope(trial, auth.user.id, org);
    return auth;
  };
  const store = createCoordinatorRequestStore(d.serviceKey, d.fetcher);
  const issuer = createStudioCoordinatorHandlers(
    {
      store,
      enabled: true,
      executionMode: d.mode,
      approvalPrivateKey: d.studioPrivateKey,
      receiptPublicKey: d.coordinatorPublicKey,
      now: d.now,
    },
    scopedAuthorize,
  );
  const send = makeRouteClient({
    sender: "studio",
    privateKey: d.studioPrivateKey,
    peerKey: d.coordinatorPublicKey,
    bridgeKey: d.bridgeKey,
    fetcher: d.fetcher,
    now: d.now,
  });
  const remote = makeStudioRemoteActions({ store, issuer, send }, scopedAuthorize);
  const bridge = createStudioTransport(
    {
      origin: "https://agents.trusttai.com",
      companyId: COORDINATOR.companyId,
      projectId: COORDINATOR.projectId,
      agentId: COORDINATOR.agentId,
      key: d.bridgeKey,
    },
    d.fetcher,
  );
  const recoveryBridge = recoveryTransport(d.bridgeKey,d.fetcher);
  const prepare = async (request: Request, input: unknown) => {
    // Intake performs its own actual-user/organization authorization before each write.
    const raw = input as { organizationId: string; requestId: string };
    const auth = await scopedAuthorize(request, raw.organizationId, true);
    const existing = await store.read(raw.organizationId,raw.requestId);
    if (trial && existing?.state === "dispatch_uncertain" && existing.intake_recovery_authorization)
      return recoverReservedIntake(input,{store,bridge:recoveryBridge,authorize:async()=>(await scopedAuthorize(request,raw.organizationId,true)).user.id,now:d.now,active:()=>assertTrialWindow(trial,d.now())});
    const storage = createResearchStore(auth.user.id, d.serviceKey, d.fetcher);
    return prepareManualResearchRequest(request, input, {
      mode: d.mode,
      ...storage,
      agent: bridge.readAgent,
      createIssue: bridge.createIssue,
      owner: async (org, id) => (await store.read(org, id))?.created_by ?? null,
      authorize: async (r, org) => ({ userId: (await scopedAuthorize(r, org, true)).user.id }),
    });
  };
  const receiptOperations = makeStudioReceiptOperations({
    handlers: issuer,
    store,
    hostKey: d.coordinatorPublicKey,
    studioKey: d.studioPrivateKey,
    now: d.now,
    currentMember: makeStudioCurrentMember(d.client),
  });
  const receiptHandler = makeRouteHandler({
    receiver: "studio",
    peerKey: d.coordinatorPublicKey,
    privateKey: d.studioPrivateKey,
    now: d.now,
    ledger: createSupabaseRouteLedger(d.serviceKey, d.fetcher),
    authenticate: async (_request, e) => {
      if (trial) assertTrialScope(trial, e.subjectId, e.organizationId, e.requestId);
      if (e.sender !== "coordinator") throw Error("sender_invalid");
    },
    authorizeCurrent: async (e) => {
      await receiptOperations({ ...e, operation: "authority" });
    },
    dispatch: receiptOperations,
  });
  const application = makeStudioApplication({ issuer, remote, prepare }, scopedAuthorize);
  return {
    // Live callbacks have moved to a separately signed boundary; no CMD fallback.
    receiptHandler: trial ? async (_request: Request) => new Response(JSON.stringify({error:"callback_relocated"}), {status:410,headers:{"Cache-Control":"no-store","Content-Type":"application/json"}}) : receiptHandler,
    application: async (request: Request, raw: unknown) => {
      if (trial) {
        const input = manualActionSchema.parse(raw);
        const auth = await scopedAuthorize(
          request,
          input.organizationId,
          input.operation !== "read" && input.operation !== "check",
        );
        assertTrialScope(trial, auth.user.id, input.organizationId, input.requestId);
        if (input.operation === "check") {
          const now = d.now();
          return { status: "available" as const, launchAllowed: Number.isFinite(now) && now >= trial.notBefore && now < trial.expiresAt };
        }
        if (["queue", "start"].includes(input.operation))
          assertTrialWindow(trial, d.now());
        if (
          input.operation === "queue" &&
          (input.approvedUrls?.length !== 1 || input.approvedUrls[0] !== trial.source)
        )
          throw Error("trial_source_rejected");
      }
      const action=manualActionSchema.parse(raw);
      if(trial && ["queue","start"].includes(action.operation) && action.requestId) {
        const row=await store.read(action.organizationId,action.requestId);
        if(row?.intake_recovery_receipt && row.state==="submitted") await verifyRecoveredIssue(row,recoveryBridge);
      }
      return application(request, raw);
    },
    receiptOperations,
  };
}

/** Explicit server composition only; application startup still supplies no configuration. */
export function assembleOfflineStudio(
  d: Omit<Parameters<typeof assembleStudio>[0], "mode"> & { mode: "offline-synthetic" },
  authorize = authorizeStudioResearch,
) {
  return assembleStudio(d, authorize);
}
export function assembleLinuxPreviewStudio(
  d: Omit<Parameters<typeof assembleStudio>[0], "mode"> & { mode: "linux-public-preview" },
  authorize = authorizeStudioResearch,
) {
  return assembleStudio(d, authorize);
}
