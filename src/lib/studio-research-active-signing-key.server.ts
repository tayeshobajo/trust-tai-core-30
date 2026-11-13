/** Active trust must never accept the publicly reproducible inert diagnostic identity. */
import { createPublicKey, type KeyObject } from "node:crypto";
import { Buffer } from "node:buffer";
const diagnosticSpki = Buffer.from(
  "302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  "hex",
);
export function assertActiveSigningKey(key: KeyObject): void {
  if (!["public", "private"].includes(key.type) || key.asymmetricKeyType !== "ed25519")
    throw Error("active_signing_key_invalid");
  const publicKey = key.type === "private" ? createPublicKey(key) : key;
  if (publicKey.export({ type: "spki", format: "der" }).equals(diagnosticSpki))
    throw Error("diagnostic_identity_forbidden");
}
