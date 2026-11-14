/** Separate explicit configuration; never falls back from legacy approval/configuration. */
import { z } from "zod";
import { Buffer } from "node:buffer";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { assembleStudioAttempt } from "./studio-research-studio-assembly.server";
import { TIMING_POLICY_DIGEST } from "./studio-research-timing-candidate.server";
import { classifyStudioPreviewOrigin } from "./studio-research-preview-origin.server";
export const studioAttemptConfigSchema = z
  .object({
    version: z.literal(2),
    enabled: z.literal(true),
    policyDigest: z.literal(TIMING_POLICY_DIGEST),
    attemptId: z.string().uuid(),
    approvalDigest: z.string().regex(/^[a-f0-9]{64}$/),
    coordinatorPublicKeyPem: z.string().min(40).max(1000),
  })
  .strict();
export function loadStudioAttemptAssembly(
  env: Record<string, string | undefined> = process.env,
  assemble = assembleStudioAttempt,
  report: (stage: AttemptStartupDiagnostic) => void = () => {},
) {
  let stage: AttemptStartupDiagnostic = "attempt_config_missing";
  const unavailable = () => { report(stage); return undefined; };
  try {
    const raw = env["STUDIO_RESEARCH_ATTEMPT_CONFIG"];
    if (!raw) return unavailable();
    stage = "attempt_config_invalid";
    if (raw.length > 8000) return unavailable();
    const c = studioAttemptConfigSchema.parse(JSON.parse(raw));
    const pem = env["STUDIO_RESEARCH_SIGNING_PRIVATE_KEY"],
      serviceKey = env["TRUST_TAI_SUPABASE_SERVICE_KEY"] ?? env["SUPABASE_SERVICE_ROLE_KEY"],
      bridgeKey = env["PAPERCLIP_STUDIO_BRIDGE_KEY"];
    stage = "attempt_credentials_unavailable";
    if (!pem || !serviceKey || !bridgeKey?.startsWith("pcp_")) return unavailable();
    stage = "attempt_private_key_invalid";
    // Match the existing Studio loader: strict PKCS#8 decoding also accepts
    // line breaks removed by single-line secret inputs, without changing identity.
    if (pem.length > 2000 || !/^-----BEGIN PRIVATE KEY-----[\s\S]*-----END PRIVATE KEY-----\s*$/.test(pem)) return unavailable();
    const body = pem.replace(/^-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----\s*$/, "").replace(/[ \t\r\n]/g, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return unavailable();
    const der = Buffer.from(body, "base64");
    if (der.toString("base64") !== body) return unavailable();
    const studioPrivateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    stage = "attempt_public_key_invalid";
    const coordinatorPublicKey = createPublicKey(c.coordinatorPublicKeyPem);
    stage = "attempt_assembly_failed";
    return assemble({
      attemptId: c.attemptId,
      approvalDigest: c.approvalDigest,
      studioPrivateKey,
      coordinatorPublicKey,
      serviceKey,
      bridgeKey,
      fetcher: fetch,
      now: Date.now,
    });
  } catch {
    return unavailable();
  }
}
export const ATTEMPT_STARTUP_DIAGNOSTICS = [
  "attempt_origin_rejected", "attempt_config_missing", "attempt_config_invalid",
  "attempt_credentials_unavailable", "attempt_private_key_invalid",
  "attempt_public_key_invalid", "attempt_assembly_failed",
] as const;
export type AttemptStartupDiagnostic = typeof ATTEMPT_STARTUP_DIAGNOSTICS[number];
export async function studioAttemptApplication(request: Request, raw: unknown) {
  if (classifyStudioPreviewOrigin(request) !== "production") throw Error("attempt_origin_rejected");
  let diagnostic: AttemptStartupDiagnostic = "attempt_assembly_failed";
  const application = loadStudioAttemptAssembly(process.env, assembleStudioAttempt, (stage) => { diagnostic = stage; });
  if (!application) throw Error(diagnostic);
  return application(request, raw);
}
