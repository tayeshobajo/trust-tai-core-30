/** Separate explicit configuration; never falls back from legacy approval/configuration. */
import { z } from "zod";
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
) {
  try {
    const raw = env["STUDIO_RESEARCH_ATTEMPT_CONFIG"];
    if (!raw || raw.length > 8000) return undefined;
    const c = studioAttemptConfigSchema.parse(JSON.parse(raw));
    const pem = env["STUDIO_RESEARCH_SIGNING_PRIVATE_KEY"],
      serviceKey = env["TRUST_TAI_SUPABASE_SERVICE_KEY"] ?? env["SUPABASE_SERVICE_ROLE_KEY"],
      bridgeKey = env["PAPERCLIP_STUDIO_BRIDGE_KEY"];
    if (!pem || pem.length > 2000 || !serviceKey || !bridgeKey?.startsWith("pcp_"))
      return undefined;
    return assemble({
      attemptId: c.attemptId,
      approvalDigest: c.approvalDigest,
      studioPrivateKey: createPrivateKey(pem),
      coordinatorPublicKey: createPublicKey(c.coordinatorPublicKeyPem),
      serviceKey,
      bridgeKey,
      fetcher: fetch,
      now: Date.now,
    });
  } catch {
    return undefined;
  }
}
export async function studioAttemptApplication(request: Request, raw: unknown) {
  if (classifyStudioPreviewOrigin(request) !== "production") throw Error("attempt_unavailable");
  const application = loadStudioAttemptAssembly();
  if (!application) throw Error("attempt_unavailable");
  return application(request, raw);
}
