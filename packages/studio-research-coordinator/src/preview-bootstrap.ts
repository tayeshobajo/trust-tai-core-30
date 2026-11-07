import {
  definePlugin,
  type PluginContext,
  type PluginApiRequestInput,
} from "@paperclipai/plugin-sdk";
import { z } from "zod";
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { lstatSync, openSync, closeSync, constants } from "node:fs";
import { CoordinatorStore } from "../../../src/lib/studio-research-coordinator-store.server";
import { createRouteLedger } from "../../../src/lib/studio-research-route-ledger-node.server";
import {
  makeRouteClient,
  type RouteEnvelope,
} from "../../../src/lib/studio-research-route-transport.server";
import { createLinuxPublicPreviewComposition } from "../../../src/lib/studio-research-linux-composition.server";
import {
  createRoutePrincipalRegistry,
  makeCoordinatorOperations,
} from "../../../src/lib/studio-research-route-operations.server";
import { verifySignedJson } from "../../../src/lib/studio-research-coordinator-authority.server";
import {
  COORDINATOR,
  approvalSchema,
  digest,
  LINUX_PREVIEW_POLICY_SHA256,
} from "../../../src/lib/studio-research-coordinator-contracts";
import { createPublicSourceReader } from "../../../src/lib/studio-research-public-source.server";
import { makeHostAdmittedRoutePlugin, type HostAdmission } from "./host-admitted-routes";
const secretRef = z
  .object({
    type: z.literal("secret_ref"),
    secretId: z.string().uuid(),
    version: z.number().int().positive(),
  })
  .strict();
export const previewWorkerConfig = z
  .object({
    version: z.literal(1),
    mode: z.literal("linux-public-preview"),
    enabled: z.literal(true),
    policyDigest: z.literal(LINUX_PREVIEW_POLICY_SHA256),
    studioPublicKeyPem: z.string().min(40).max(1000),
    hostSigningKey: secretRef,
    providerKey: secretRef,
  })
  .strict();
const STATE = "/home/paperclip/.local/share/trusttai-studio-research";
function openState() {
  const stat = lstatSync(STATE);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid?.()
  )
    throw Error("private_state_unavailable");
  const store = new CoordinatorStore(STATE + "/coordinator.sqlite");
  const path = STATE + "/nonces.sqlite";
  try {
    const s = lstatSync(path);
    if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077) !== 0 || s.uid !== process.getuid?.())
      throw Error("nonce_storage_invalid");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    closeSync(openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600));
  }
  const db = new DatabaseSync(path);
  return {
    store,
    ledger: createRouteLedger(db),
    close() {
      store.close();
      db.close();
    },
  };
}
const ownedSchema = z
  .object({
    approval: z.unknown(),
    state: z.enum(["approved", "running", "ready", "cancelled"]),
    revoked: z.boolean(),
    admission: z.unknown().optional(),
    resultDigest: z.string().nullable().optional(),
  })
  .strict();
type Dependencies = {
  openState: typeof openState;
  compose: typeof createLinuxPublicPreviewComposition;
  sourceReader: ReturnType<typeof createPublicSourceReader>;
  fetcher: typeof fetch;
  now: () => number;
};
/** Production defaults are concrete. Injection exists solely for inert local contract tests. */
export function makePreviewWorker(dependencies: Partial<Dependencies> = {}) {
  const d: Dependencies = {
    openState,
    compose: createLinuxPublicPreviewComposition,
    sourceReader: createPublicSourceReader(),
    fetcher: fetch,
    now: Date.now,
    ...dependencies,
  };
  const activeStops = new Set<() => Promise<boolean>>();
  const shutdown = new AbortController();
  const inFlight = new Set<Promise<unknown>>();
  let ctx: PluginContext | undefined;
  let state: ReturnType<typeof openState> | undefined;
  return definePlugin({
    async setup(context) {
      ctx = context;
    },
    async onShutdown() {
      ctx = undefined;
      shutdown.abort();
      await Promise.allSettled([...activeStops].map((stop) => stop()));
      await Promise.allSettled([...inFlight]);
      state?.close();
      state = undefined;
    },
    async onHealth() {
      return {
        status: "degraded",
        message: "Explicit preview configuration required; no automatic jobs.",
      };
    },
    async onApiRequest(input: PluginApiRequestInput) {
      const pending = handleApiRequest(input);
      inFlight.add(pending);
      try {
        return await pending;
      } finally {
        inFlight.delete(pending);
      }
    },
  });
  async function handleApiRequest(input: PluginApiRequestInput) {
    const unavailable = {
      status: 503,
      headers: { "Cache-Control": "no-store" },
      body: { error: "runtime_unavailable" },
    };
    if (!ctx || shutdown.signal.aborted || input.companyId !== COORDINATOR.companyId)
      return unavailable;
    try {
      const host = (
        ctx as unknown as { studioResearch?: { revalidate(a: HostAdmission): Promise<unknown> } }
      ).studioResearch;
      const admission = (input as PluginApiRequestInput & { studioAdmission?: HostAdmission })
        .studioAdmission;
      if (!host || !admission) return unavailable;
      await host.revalidate(admission);
      const config = previewWorkerConfig.parse(await ctx.config.get(COORDINATOR.companyId));
      const studioKey = createPublicKey(config.studioPublicKeyPem);
      if (studioKey.asymmetricKeyType !== "ed25519") throw Error("studio_key_invalid");
      const signed = z
        .object({ token: z.string().max(190000) })
        .strict()
        .parse(input.body);
      const verified = z
        .object({
          sender: z.literal("studio"),
          requestId: z.literal(admission.requestId),
          issueId: z.literal(admission.issueId),
          operation: z.literal(admission.operation),
          expiresAt: z.number(),
        })
        .passthrough()
        .parse(verifySignedJson(studioKey, signed.token));
      if (verified.expiresAt <= d.now()) throw Error("signed_invocation_expired");
      const resolve = (path: "hostSigningKey" | "providerKey") =>
        ctx!.secrets.resolve(config[path], { companyId: COORDINATOR.companyId, configPath: path });
      // Resolve on invocation; never retain secret values in worker-global state.
      const privateKey = createPrivateKey(await resolve("hostSigningKey"));
      if (privateKey.asymmetricKeyType !== "ed25519") throw Error("host_key_invalid");
      state ??= d.openState();
      let current: RouteEnvelope | undefined;
      const requireCurrent = () => {
        if (!current || current.expiresAt <= d.now()) throw Error("invocation_expired");
        return current;
      };
      const send = makeRouteClient({
        sender: "coordinator",
        privateKey,
        peerKey: studioKey,
        now: d.now,
        fetcher: d.fetcher,
      });
      const remote = async (operation: "authority" | "admission" | "result", payload: unknown) => {
        const e = requireCurrent();
        return send({ ...e, operation, payload });
      };
      const loadOwned = async (org: string, id: string) => {
        const e = requireCurrent();
        if (e.organizationId !== org || e.requestId !== id) throw Error("ownership_binding");
        const owned = ownedSchema.parse(await remote("authority", {}));
        const approval = approvalSchema.parse(owned.approval);
        if (
          digest(approval) !== e.approvalDigest ||
          approval.approvedBy !== e.subjectId ||
          approval.issueId !== e.issueId
        )
          throw Error("current_approval_mismatch");
        return {
          approval,
          state: owned.state,
          revoked: owned.revoked,
          ...(owned.admission === undefined ? {} : { admission: owned.admission }),
          ...(owned.resultDigest == null ? {} : { resultDigest: owned.resultDigest }),
        };
      };
      const principals = createRoutePrincipalRegistry(d.now);
      const composition = await d.compose({
        store: state.store,
        now: d.now,
        authorize: principals.authorize,
        readApproved: loadOwned,
        reader: d.sourceReader,
        grantPublicKey: studioKey,
        hostPrivateKey: privateKey,
        ackPublicKey: studioKey,
        authorizeCurrent: async (i) => {
          const e = requireCurrent();
          if (i.requestId !== e.requestId || i.issueId !== e.issueId) throw Error("launch_binding");
          const owned = await loadOwned(e.organizationId, e.requestId);
          if (owned.revoked || owned.state !== "running") throw Error("launch_revoked");
          await host.revalidate(admission);
          requireCurrent();
        },
        providerKey: () => resolve("providerKey"),
        shutdownSignal: shutdown.signal,
        // Recheck remote membership/revocation before each receipt effect.
        exchange: async (kind, receipt) => {
          const e = requireCurrent();
          const owned = await loadOwned(e.organizationId, e.requestId);
          if (owned.revoked || owned.state === "cancelled") throw Error("receipt_revoked");
          await host.revalidate(admission);
          return z
            .object({ ack: z.string() })
            .strict()
            .parse(await remote(kind, { receipt })).ack;
        },
        completionDeadline: () => requireCurrent().expiresAt - 5000,
        trackRuntime: (handle) => {
          activeStops.add(handle.stop);
          handle.completion.finally(() => activeStops.delete(handle.stop)).catch(() => {});
        },
      });
      if (!composition.available) return unavailable;
      const operations = makeCoordinatorOperations({
        composition,
        principals,
        loadApproval: async (id) => (await loadOwned(COORDINATOR.organizationId, id)).approval,
      });
      const plugin = makeHostAdmittedRoutePlugin({
        peerKey: studioKey,
        privateKey,
        now: d.now,
        ledger: state.ledger,
        authorizeCurrent: async (e) => {
          current = e;
          const owned = await loadOwned(e.organizationId, e.requestId);
          if (owned.revoked && !["read", "cancel"].includes(e.operation)) throw Error("revoked");
        },
        dispatch: operations,
      });
      await plugin.definition.setup(ctx);
      return await plugin.definition.onApiRequest!(input);
    } catch {
      return unavailable;
    }
  }
}
