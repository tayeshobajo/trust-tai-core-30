import { sign, type KeyObject } from "node:crypto";
import type { Job } from "./studio-research-coordinator-store.server";
function signed(key: KeyObject, payload: unknown) {
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519")
    throw Error("signer_unavailable");
  const b = Buffer.from(JSON.stringify(payload));
  return b.toString("base64url") + "." + sign(null, b, key).toString("base64url");
}
export function signCoordinatorReceipt(
  key: KeyObject,
  job: Job,
  stage: "admission" | "result",
  now: number,
) {
  return signed(key, {
    issuer: "studio-coordinator-receipt",
    audience: "studio-existing-request",
    stage,
    issuedAt: now,
    expiresAt: now + 60000,
    job,
  });
}
