import { it, expect, vi } from "vitest";
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { assertActiveSigningKey } from "./studio-research-active-signing-key.server";
import { createCallbackHandler } from "./studio-research-callback.server";
import { assembleLinuxPreviewStudio } from "./studio-research-studio-assembly.server";
import { trialConfigSchema, TRIAL_POLICY_SHA256 } from "./studio-research-trial.server";
import { STUDIO_TRIAL_REQUEST_ID, STUDIO_TRIAL_SOURCE } from "@/domain/studio-research-trial";
const diagnostic = createPrivateKey({
  type: "pkcs8",
  format: "der",
  key: Buffer.from(
    "302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    "hex",
  ),
});
const diagnosticPublic = createPublicKey(diagnostic);
const trial = trialConfigSchema.parse({
  policyDigest: TRIAL_POLICY_SHA256,
  requestId: STUDIO_TRIAL_REQUEST_ID,
  source: STUDIO_TRIAL_SOURCE,
  subjectId: "11111111-1111-4111-8111-111111111111",
  notBefore: 1000,
  expiresAt: 61000,
});
function formattedPublic() {
  const pem = diagnosticPublic.export({ type: "spki", format: "pem" }).toString();
  return createPublicKey("\n" + pem.replace(/\n/g, "\r\n") + "\n");
}
it("rejects diagnostic private/public identity by canonical bytes, including PEM variants", () => {
  for (const key of [
    diagnostic,
    diagnosticPublic,
    formattedPublic(),
    createPrivateKey("\n" + diagnostic.export({ type: "pkcs8", format: "pem" }).toString() + "\n"),
  ])
    expect(() => assertActiveSigningKey(key)).toThrow("diagnostic_identity_forbidden");
  const fresh = generateKeyPairSync("ed25519");
  expect(() => assertActiveSigningKey(fresh.privateKey)).not.toThrow();
  expect(() => assertActiveSigningKey(fresh.publicKey)).not.toThrow();
});
it.each(["callbackPrivateKey", "studioPublicKey", "hostPublicKey"] as const)(
  "rejects diagnostic identity in active callback %s before service access",
  (role) => {
    const callback = generateKeyPairSync("ed25519"),
      studio = generateKeyPairSync("ed25519"),
      host = generateKeyPairSync("ed25519");
    const access = vi.fn(() => {
      throw Error("service_access_forbidden");
    });
    const deps = {
      callbackPrivateKey: callback.privateKey,
      studioPublicKey: studio.publicKey,
      hostPublicKey: host.publicKey,
      trial,
      store: new Proxy({}, { get: access }) as never,
      ledger: new Proxy({}, { get: access }) as never,
      currentMember: async () => {
        access();
      },
      now: () => 2000,
    };
    deps[role] = role === "callbackPrivateKey" ? diagnostic : formattedPublic();
    expect(() => createCallbackHandler(deps)).toThrow("diagnostic_identity_forbidden");
    expect(access).not.toHaveBeenCalled();
  },
);
it.each(["studioPrivateKey", "coordinatorPublicKey"] as const)(
  "rejects diagnostic identity in active Studio %s before service access",
  (role) => {
    const studio = generateKeyPairSync("ed25519"),
      host = generateKeyPairSync("ed25519");
    const access = vi.fn(() => {
      throw Error("service_access_forbidden");
    });
    const deps = {
      mode: "linux-public-preview" as const,
      trial,
      studioPrivateKey: studio.privateKey,
      coordinatorPublicKey: host.publicKey,
      serviceKey: "synthetic",
      bridgeKey: "pcp_synthetic",
      client: { from: access } as never,
      fetcher: access as never,
      now: () => 2000,
    };
    deps[role] = role === "studioPrivateKey" ? diagnostic : formattedPublic();
    expect(() => assembleLinuxPreviewStudio(deps)).toThrow("diagnostic_identity_forbidden");
    expect(access).not.toHaveBeenCalled();
  },
);
