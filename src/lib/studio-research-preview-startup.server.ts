import { trialConfigSchema } from "./studio-research-trial.server";
/** Server-only preview startup. Configuration and secret values are read only on invocation. */
import { createPrivateKey, createPublicKey } from "node:crypto";
import { Buffer } from "node:buffer";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { assembleLinuxPreviewStudio } from "./studio-research-studio-assembly.server";
import { LINUX_PREVIEW_POLICY_SHA256 } from "./studio-research-coordinator-contracts";
export const studioPreviewConfig = z
  .object({
    version: z.literal(2),
    mode: z.literal("linux-public-preview"),
    enabled: z.literal(true),
    policyDigest: z.literal(LINUX_PREVIEW_POLICY_SHA256),
    trial: trialConfigSchema,
    coordinatorPublicKeyPem: z.string().min(40).max(1000),
  })
  .strict();
/** The deployment platform's existing server environment is the secret accessor; never browser inputs. */
export function loadStudioPreviewAssembly(
  env: Record<string, string | undefined> = process.env,
  assemble = assembleLinuxPreviewStudio,
  report: (stage: string) => void = () => {},
) {
  let stage = "config_missing";
  const unavailable = () => { report(stage); return undefined; };
  try {
    const raw = env["STUDIO_RESEARCH_PREVIEW_CONFIG"];
    if (!raw) return unavailable();
    stage = "config_invalid";
    const config = studioPreviewConfig.parse(JSON.parse(raw));
    const privatePem = env["STUDIO_RESEARCH_SIGNING_PRIVATE_KEY"];
    const serviceKey = env["TRUST_TAI_SUPABASE_SERVICE_KEY"] ?? env["SUPABASE_SERVICE_ROLE_KEY"];
    const bridgeKey = env["PAPERCLIP_STUDIO_BRIDGE_KEY"];
    stage = !privatePem ? "signer_missing" : !serviceKey ? "database_credential_missing" : !bridgeKey ? "bridge_credential_missing" : "bridge_credential_format";
    if (!privatePem || !serviceKey || !bridgeKey?.startsWith("pcp_")) return unavailable();
    stage = "private_key_envelope_invalid";
    if (!/^-----BEGIN PRIVATE KEY-----[\s\S]*-----END PRIVATE KEY-----\s*$/.test(privatePem)) return unavailable();
    // Some secure single-line inputs remove PEM line breaks. Decode the exact
    // PKCS#8 body strictly; this changes formatting tolerance, never key identity.
    const body = privatePem.replace(/^-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----\s*$/, "").replace(/[ \t\r\n]/g, "");
    stage = "private_key_encoding_invalid";
    if (privatePem.length > 2000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return unavailable();
    const der = Buffer.from(body, "base64");
    if (der.toString("base64") !== body) return unavailable();
    stage = "private_key_parse_failed";
    const studioPrivateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    stage = "public_key_parse_failed";
    const coordinatorPublicKey = createPublicKey(config.coordinatorPublicKeyPem);
    stage = "signing_identity_invalid";
    if (
      studioPrivateKey.asymmetricKeyType !== "ed25519" ||
      coordinatorPublicKey.asymmetricKeyType !== "ed25519"
    )
      return unavailable();
    stage = "assembly_failed";
    const client = createClient("https://okydosoacqdnursmmenf.supabase.co", serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return assemble({
      mode: "linux-public-preview",
      trial: config.trial,
      studioPrivateKey,
      coordinatorPublicKey,
      serviceKey,
      bridgeKey,
      client,
      fetcher: fetch,
      now: Date.now,
    });
  } catch (error) {
    if (stage === "private_key_parse_failed" || stage === "public_key_parse_failed") {
      const code = (error as { code?: unknown })?.code;
      if (typeof code === "string" && ["ERR_OSSL_UNSUPPORTED", "ERR_OSSL_ASN1_HEADER_TOO_LONG", "ERR_INVALID_ARG_VALUE", "ERR_NOT_IMPLEMENTED"].includes(code)) stage += `_${code}`;
    }
    return unavailable();
  }
}
