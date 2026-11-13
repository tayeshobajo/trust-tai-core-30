import { it, expect, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { loadStudioAttemptAssembly } from "./studio-research-attempt-startup.server";
import {
  loadCallbackStartup,
  CALLBACK_CONFIG_LABEL,
  CALLBACK_PRIVATE_KEY_LABEL,
} from "./studio-research-callback-startup.server";
import { TIMING_POLICY_DIGEST } from "./studio-research-timing-candidate.server";
it("CMD v2 remains unavailable without its separate exact pinned config", () => {
  const assemble = vi.fn();
  expect(loadStudioAttemptAssembly({}, assemble)).toBeUndefined();
  const pair = generateKeyPairSync("ed25519");
  const config = {
    version: 2,
    enabled: true,
    policyDigest: TIMING_POLICY_DIGEST,
    attemptId: "11111111-1111-4111-8111-111111111111",
    approvalDigest: "a".repeat(64),
    coordinatorPublicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }),
  };
  const env = {
    STUDIO_RESEARCH_ATTEMPT_CONFIG: JSON.stringify(config),
    STUDIO_RESEARCH_SIGNING_PRIVATE_KEY: pair.privateKey.export({
      type: "pkcs8",
      format: "pem",
    }) as string,
    TRUST_TAI_SUPABASE_SERVICE_KEY: "synthetic",
    PAPERCLIP_STUDIO_BRIDGE_KEY: "pcp_synthetic",
  };
  loadStudioAttemptAssembly(env, assemble);
  expect(assemble).toHaveBeenCalledOnce();
  for (const mutation of [
    { version: 1 },
    { policyDigest: "b".repeat(64) },
    { approvalDigest: "invalid" },
    { attemptId: undefined },
  ])
    expect(
      loadStudioAttemptAssembly(
        { ...env, STUDIO_RESEARCH_ATTEMPT_CONFIG: JSON.stringify({ ...config, ...mutation }) },
        assemble,
      ),
    ).toBeUndefined();
  expect(assemble).toHaveBeenCalledOnce();
});
it("callback v2 startup selects only its separately pinned assembly and never the v1 handler", () => {
  const keys = Array.from({ length: 3 }, () => generateKeyPairSync("ed25519")),
    legacy = vi.fn(),
    attempt = vi.fn();
  const config = {
    version: 2,
    enabled: true,
    attemptId: "11111111-1111-4111-8111-111111111111",
    approvalDigest: "a".repeat(64),
    studioPublicKeyPem: keys[1]!.publicKey.export({ type: "spki", format: "pem" }),
    hostPublicKeyPem: keys[2]!.publicKey.export({ type: "spki", format: "pem" }),
  };
  const env: Record<string, string> = {
    [CALLBACK_CONFIG_LABEL]: JSON.stringify(config),
    [CALLBACK_PRIVATE_KEY_LABEL]: keys[0]!.privateKey.export({
      type: "pkcs8",
      format: "pem",
    }) as string,
    SUPABASE_SERVICE_ROLE_KEY: "synthetic",
  };
  loadCallbackStartup(
    (k) => env[k],
    vi.fn(),
    () => 1000,
    legacy,
    attempt,
  );
  expect(legacy).not.toHaveBeenCalled();
  expect(attempt).toHaveBeenCalledOnce();
  expect(attempt.mock.calls[0]![0]).toMatchObject({
    attemptId: config.attemptId,
    approvalDigest: config.approvalDigest,
  });
});
