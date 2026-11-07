/** Server-only preview startup. Configuration and secret values are read only on invocation. */
import { createPrivateKey, createPublicKey } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { assembleLinuxPreviewStudio } from "./studio-research-studio-assembly.server";
import { LINUX_PREVIEW_POLICY_SHA256 } from "./studio-research-coordinator-contracts";
export const studioPreviewConfig = z
  .object({
    version: z.literal(1),
    mode: z.literal("linux-public-preview"),
    enabled: z.literal(true),
    policyDigest: z.literal(LINUX_PREVIEW_POLICY_SHA256),
    coordinatorPublicKeyPem: z.string().min(40).max(1000),
  })
  .strict();
/** The deployment platform's existing server environment is the secret accessor; never browser inputs. */
export function loadStudioPreviewAssembly(
  env: Record<string, string | undefined> = process.env,
  assemble = assembleLinuxPreviewStudio,
) {
  try {
    const raw = env["STUDIO_RESEARCH_PREVIEW_CONFIG"];
    if (!raw) return undefined;
    const config = studioPreviewConfig.parse(JSON.parse(raw));
    const privatePem = env["STUDIO_RESEARCH_SIGNING_PRIVATE_KEY"];
    const serviceKey = env["TRUST_TAI_SUPABASE_SERVICE_KEY"] ?? env["SUPABASE_SERVICE_ROLE_KEY"];
    const bridgeKey = env["PAPERCLIP_STUDIO_BRIDGE_KEY"];
    if (!privatePem || !serviceKey || !bridgeKey?.startsWith("pcp_")) return undefined;
    const studioPrivateKey = createPrivateKey(privatePem),
      coordinatorPublicKey = createPublicKey(config.coordinatorPublicKeyPem);
    if (
      studioPrivateKey.asymmetricKeyType !== "ed25519" ||
      coordinatorPublicKey.asymmetricKeyType !== "ed25519"
    )
      return undefined;
    const client = createClient("https://okydosoacqdnursmmenf.supabase.co", serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return assemble({
      mode: "linux-public-preview",
      studioPrivateKey,
      coordinatorPublicKey,
      serviceKey,
      bridgeKey,
      client,
      fetcher: fetch,
      now: Date.now,
    });
  } catch {
    return undefined;
  }
}
