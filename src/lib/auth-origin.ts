/**
 * Where auth is allowed to send someone back to.
 *
 * Two separate questions, both answered here so no auth flow invents its own:
 *
 *  1. WHICH ORIGIN. Browser-initiated auth returns to the origin the person is
 *     actually using, but only when that origin is one we trust. Anything else
 *     (an unknown host, or a server with no browser context) falls back to the
 *     canonical production origin. The Lovable preview host is trusted for
 *     preview use, it is never the canonical app URL.
 *
 *  2. WHICH PATH. A returnTo value is attacker-controlled. Only a same-origin
 *     absolute path survives sanitisation, so no auth link can become an open
 *     redirect.
 */

/** The production home of Trust Tai OS. Never a preview URL. */
export const CANONICAL_APP_ORIGIN = "https://cmd.trusttai.com";

/** Where a completed sign-in lands before it restores the deep link. */
export const AUTH_CALLBACK_PATH = "/auth/callback";

function readEnvOrigin(): string | null {
  const value = (import.meta.env as Record<string, string | undefined>)["VITE_APP_URL"];
  const text = (value ?? "").trim().replace(/\/+$/, "");
  if (!text) return null;
  try {
    return new URL(text).origin;
  } catch {
    return null;
  }
}

/** Hosts we are willing to return a session to. */
export function isTrustedAuthOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:" && host !== "localhost" && host !== "127.0.0.1") return false;
  if (host === "cmd.trusttai.com") return true;
  if (host === "localhost" || host === "127.0.0.1") return true;
  // Preview and published Lovable hosts, so preview keeps working from preview.
  if (host === "lovable.app" || host.endsWith(".lovable.app")) return true;
  const configured = readEnvOrigin();
  if (configured && configured === url.origin) return true;
  return false;
}

/**
 * The origin auth should return to.
 * `currentOrigin` is the browser's origin, or a request origin on the server.
 */
export function resolveAuthOrigin(currentOrigin?: string | null): string {
  const candidate = (currentOrigin ?? "").trim();
  if (candidate && isTrustedAuthOrigin(candidate)) return new URL(candidate).origin;
  return readEnvOrigin() ?? CANONICAL_APP_ORIGIN;
}

/** The origin of the browser this code is running in, if any. */
export function browserOrigin(): string | null {
  if (typeof window === "undefined") return null;
  return window.location.origin;
}

/**
 * A safe same-origin return path. Anything absolute, protocol-relative,
 * backslash-smuggled, or otherwise off-origin collapses to "/".
 */
export function sanitizeReturnPath(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  const value = raw.trim();
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f]/.test(value)) return "/";
  // Reject anything that parses as an absolute URL with its own origin.
  try {
    const url = new URL(value, CANONICAL_APP_ORIGIN);
    if (url.origin !== CANONICAL_APP_ORIGIN) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

/** The full URL Supabase should send the person back to after auth. */
export function authRedirectUrl(returnPath: unknown, currentOrigin?: string | null): string {
  const origin = resolveAuthOrigin(currentOrigin ?? browserOrigin());
  const path = sanitizeReturnPath(returnPath);
  return `${origin}${AUTH_CALLBACK_PATH}?redirect=${encodeURIComponent(path)}`;
}

/** The sign-in URL used in invitation email copy. */
export function signInUrlFor(email: string, currentOrigin?: string | null): string {
  const origin = resolveAuthOrigin(currentOrigin ?? browserOrigin());
  return `${origin}/auth?email=${encodeURIComponent(email)}`;
}
