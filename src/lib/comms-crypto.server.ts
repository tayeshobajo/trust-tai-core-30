/**
 * Token encryption at rest (server only).
 *
 * OAuth refresh tokens never sit in the database in readable form, and they
 * never reach the browser. They are sealed here with AES-GCM under
 * `COMMS_TOKEN_ENC_KEY`, a server-only secret, and only the server can open
 * them again. What is stored, and what any client could ever read back, is
 * ciphertext.
 */

const ENC_PREFIX = "v1";

function keyMaterial(): string {
  const raw = process.env["COMMS_TOKEN_ENC_KEY"];
  if (!raw || raw.length < 16) {
    throw new Error("Token encryption is not configured on the server.");
  }
  return raw;
}

async function aesKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyMaterial()));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Seal a secret. Returns `v1.<iv>.<ciphertext>`, safe to store. */
export async function sealSecret(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(),
    new TextEncoder().encode(plaintext),
  );
  return `${ENC_PREFIX}.${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
}

/** Open a sealed secret. Throws when the key changed or the value is not ours. */
export async function openSecret(sealed: string): Promise<string> {
  const parts = sealed.split(".");
  if (parts.length !== 3 || parts[0] !== ENC_PREFIX) {
    throw new Error("That stored credential is not readable.");
  }
  const iv = fromBase64(parts[1]!);
  const payload = fromBase64(parts[2]!);
  const opened = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(), payload);
  return new TextDecoder().decode(opened);
}

/* ------------------------------------------------------------ OAuth state */

function stateSecret(): string {
  const raw = process.env["COMMS_OAUTH_STATE_SECRET"];
  if (!raw || raw.length < 16) {
    throw new Error("OAuth state signing is not configured on the server.");
  }
  return raw;
}

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(stateSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toBase64(new Uint8Array(signature)).replace(/=+$/, "");
}

export interface OAuthState {
  organizationId: string;
  returnTo: string;
  issuedAt: number;
}

/** Sign the round trip so a callback cannot be forged or replayed later. */
export async function signState(state: OAuthState): Promise<string> {
  const payload = toBase64(new TextEncoder().encode(JSON.stringify(state)));
  return `${payload}.${await hmac(payload)}`;
}

/** Verify a returned state. Null when tampered with, malformed, or stale. */
export async function readState(
  value: string,
  maxAgeMs = 15 * 60 * 1000,
): Promise<OAuthState | null> {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  if ((await hmac(payload)) !== signature) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64(payload))) as OAuthState;
    if (!parsed?.organizationId) return null;
    if (Date.now() - Number(parsed.issuedAt ?? 0) > maxAgeMs) return null;
    return parsed;
  } catch {
    return null;
  }
}
