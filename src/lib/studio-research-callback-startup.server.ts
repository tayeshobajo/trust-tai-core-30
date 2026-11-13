/** Future activation only. Caller supplies a label-only accessor; no ambient reads at import. */
import { createPrivateKey, createPublicKey } from "node:crypto";
import { z } from "zod";
import { assembleSupabaseCallback } from "./studio-research-callback.server";
import { assertActiveSigningKey } from "./studio-research-active-signing-key.server";
import { trialConfigSchema } from "./studio-research-trial.server";
export const CALLBACK_CONFIG_LABEL = "STUDIO_RESEARCH_CALLBACK_CONFIG";
export const CALLBACK_PRIVATE_KEY_LABEL = "STUDIO_RESEARCH_CALLBACK_SIGNING_PRIVATE_KEY";
export const callbackConfigSchema = z.object({
  version: z.literal(1), enabled: z.literal(true), trial: trialConfigSchema,
  studioPublicKeyPem: z.string().min(40).max(1000).regex(/^-----BEGIN PUBLIC KEY-----[\s\S]*-----END PUBLIC KEY-----\s*$/),
  hostPublicKeyPem: z.string().min(40).max(1000).regex(/^-----BEGIN PUBLIC KEY-----[\s\S]*-----END PUBLIC KEY-----\s*$/),
}).strict();
/** SUPABASE_SERVICE_ROLE_KEY is platform-injected project authority; never copy a CMD key. */
export function loadCallbackStartup(
  get: (label: string) => string | undefined,
  fetcher: typeof fetch,
  now = Date.now,
  assemble = assembleSupabaseCallback,
) {
  try {
    const raw = get(CALLBACK_CONFIG_LABEL);
    if (!raw || raw.length > 8000) return undefined;
    const config = callbackConfigSchema.parse(JSON.parse(raw));
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
    return assemble({callbackPrivateKey, studioPublicKey, hostPublicKey, trial:config.trial,
      serviceKey, fetcher, now});
  } catch { return undefined; }
}
