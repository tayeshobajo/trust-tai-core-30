/** Future activation only. Caller supplies a label-only accessor; no ambient reads at import. */
import { createPrivateKey, createPublicKey } from "node:crypto";
import { z } from "zod";
import { assembleSupabaseCallback, assembleSupabaseAttemptCallback } from "./studio-research-callback.server";
import { assertActiveSigningKey } from "./studio-research-active-signing-key.server";
import { trialConfigSchema } from "./studio-research-trial.server";
export const CALLBACK_CONFIG_LABEL = "STUDIO_RESEARCH_CALLBACK_CONFIG";
export const CALLBACK_PRIVATE_KEY_LABEL = "STUDIO_RESEARCH_CALLBACK_SIGNING_PRIVATE_KEY";
export const callbackConfigSchema = z.object({
  version: z.literal(1), enabled: z.literal(true), trial: trialConfigSchema,
  studioPublicKeyPem: z.string().min(40).max(1000).regex(/^-----BEGIN PUBLIC KEY-----[\s\S]*-----END PUBLIC KEY-----\s*$/),
  hostPublicKeyPem: z.string().min(40).max(1000).regex(/^-----BEGIN PUBLIC KEY-----[\s\S]*-----END PUBLIC KEY-----\s*$/),
}).strict();
export const callbackAttemptConfigSchema = callbackConfigSchema.omit({ version: true, trial: true }).extend({
  version: z.union([z.literal(2), z.literal(3)]), attemptId: z.string().uuid(), approvalDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
/** SUPABASE_SERVICE_ROLE_KEY is platform-injected project authority; never copy a CMD key. */
export function loadCallbackStartup(
  get: (label: string) => string | undefined,
  fetcher: typeof fetch,
  now = Date.now,
  assemble = assembleSupabaseCallback,
  assembleAttempt = assembleSupabaseAttemptCallback,
) {
  try {
    const raw = get(CALLBACK_CONFIG_LABEL);
    if (!raw || raw.length > 8000) return undefined;
    const config = z.union([callbackConfigSchema, callbackAttemptConfigSchema]).parse(JSON.parse(raw));
    const pem = get(CALLBACK_PRIVATE_KEY_LABEL);
    if (!pem || pem.length > 2000) return undefined;
    const callbackPrivateKey = createPrivateKey(pem);
    const studioPublicKey = createPublicKey(config.studioPublicKeyPem);
    const hostPublicKey = createPublicKey(config.hostPublicKeyPem);
    for (const key of [callbackPrivateKey, studioPublicKey, hostPublicKey]) assertActiveSigningKey(key);
    const identities = [createPublicKey(callbackPrivateKey), studioPublicKey, hostPublicKey]
      .map(k => k.export({type:"spki",format:"der"}).toString("hex"));
    if (new Set(identities).size !== 3) return undefined;
    // Validate config/trust before even accessing the injected privileged credential.
    const serviceKey = get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey || serviceKey.length > 16000) return undefined;
    if (config.version !== 1) return assembleAttempt({storageVersion:config.version,callbackPrivateKey,studioPublicKey,hostPublicKey,attemptId:config.attemptId,approvalDigest:config.approvalDigest,serviceKey,fetcher,now});
    return assemble({callbackPrivateKey, studioPublicKey, hostPublicKey, trial:config.trial,
      serviceKey, fetcher, now});
  } catch { return undefined; }
}
