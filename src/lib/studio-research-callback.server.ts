import { assertActiveSigningKey } from "./studio-research-active-signing-key.server";
/** Callback-only composition. No ambient credentials, approval issuer or provider access. */
import { createPublicKey, type KeyObject } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createCoordinatorRequestStore,
  type CoordinatorRequestStore,
} from "./studio-research-coordinator-request-store.server";
import { createSupabaseRouteLedger } from "./studio-research-route-ledger-supabase.server";
import { createStudioReceiptReceiver } from "./studio-research-receipt-receiver.server";
import { makeStudioReceiptOperations } from "./studio-research-route-operations.server";
import { makeStudioCurrentMember } from "./studio-research-current-member.server";
import {
  makeRouteHandler,
  ROUTES,
  type RouteLedger,
} from "./studio-research-route-transport.server";
import {
  assertTrialApproval,
  assertTrialScope,
  trialConfigSchema,
  type TrialConfig,
} from "./studio-research-trial.server";

export function createCallbackHandler(d: {
  callbackPrivateKey: KeyObject;
  studioPublicKey: KeyObject;
  hostPublicKey: KeyObject;
  trial: TrialConfig;
  store: CoordinatorRequestStore;
  ledger: RouteLedger;
  currentMember(subject: string, organization: string): Promise<void>;
  now(): number;
}) {
  const trial = trialConfigSchema.parse(d.trial);
  for (const [key, type] of [
    [d.callbackPrivateKey, "private"],
    [d.studioPublicKey, "public"],
    [d.hostPublicKey, "public"],
  ] as const)
    if (key.type !== type || key.asymmetricKeyType !== "ed25519")
      throw Error("callback_key_invalid");
  for (const key of [d.callbackPrivateKey, d.studioPublicKey, d.hostPublicKey]) assertActiveSigningKey(key);
  const callback = createPublicKey(d.callbackPrivateKey).export({ type: "spki", format: "der" });
  if (
    [d.studioPublicKey, d.hostPublicKey].some((k) =>
      callback.equals(k.export({ type: "spki", format: "der" })),
    )
  )
    throw Error("callback_key_not_separate");
  // No approvalPrivateKey is supplied and no approve/run operation is exported.
  const receiver = createStudioReceiptReceiver({
    store: d.store,
    enabled: true,
    receiptPublicKey: d.hostPublicKey,
    now: d.now,
  });
  const operations = makeStudioReceiptOperations({
    handlers: { receive: receiver },
    store: d.store,
    hostKey: d.hostPublicKey,
    studioKey: d.callbackPrivateKey,
    now: d.now,
    currentMember: d.currentMember,
  });
  return makeRouteHandler({
    receiver: "studio",
    callbackEndpoint: ROUTES.callback,
    peerKey: d.hostPublicKey,
    privateKey: d.callbackPrivateKey,
    now: d.now,
    ledger: d.ledger,
    authenticate: async (_request, e) => {
      assertTrialScope(trial, e.subjectId, e.organizationId, e.requestId);
      if (e.sender !== "coordinator" || !["authority", "admission", "result"].includes(e.operation))
        throw Error("callback_operation_invalid");
    },
    authorizeCurrent: async (e) => {
      const owned = await operations({ ...e, operation: "authority" });
      if (!("approval" in owned)) throw Error("callback_authority_invalid");
      assertTrialApproval(trial, owned.approval);
      // Authority remains readable for cancellation/settlement. Effects reject revoked work.
      if (e.operation !== "authority" && owned.revoked) throw Error("callback_revoked");
      // Admission is a launch effect; results/authority may settle after the trial window.
      if (e.operation === "admission" && (d.now() < trial.notBefore || d.now() >= trial.expiresAt))
        throw Error("trial_expired");
    },
    dispatch: operations,
  });
}

/** Explicit service assembly for future reviewed deployment; never reads environment variables. */
export function assembleSupabaseCallback(d: {
  callbackPrivateKey: KeyObject;
  studioPublicKey: KeyObject;
  hostPublicKey: KeyObject;
  trial: TrialConfig;
  serviceKey: string;
  fetcher: typeof fetch;
  now(): number;
}) {
  // Validate trust before constructing even an inert privileged client.
  for (const key of [d.callbackPrivateKey, d.studioPublicKey, d.hostPublicKey]) assertActiveSigningKey(key);
  const origin = "https://okydosoacqdnursmmenf.supabase.co";
  const client = createClient(origin, d.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: d.fetcher },
  });
  return createCallbackHandler({
    ...d,
    store: createCoordinatorRequestStore(d.serviceKey, d.fetcher, origin),
    ledger: createSupabaseRouteLedger(d.serviceKey, d.fetcher),
    currentMember: makeStudioCurrentMember(client as Pick<SupabaseClient, "from">),
  });
}
