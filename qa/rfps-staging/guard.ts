/** Test-only boundary. Never imported by the normal CMD application. */
export const PRODUCTION_REF = "okydosoacqdnursmmenf";
export interface StagingConfig {
  url: string;
  key: string;
  origin: string;
  projectRef: string;
}
export function stagingConfig(env: Record<string, string | undefined>): StagingConfig {
  const target = env["VITE_RFP_STAGING_PROJECT_REF"];
  const raw = env["VITE_RFP_STAGING_URL"];
  const key = env["VITE_RFP_STAGING_PUBLISHABLE_KEY"];
  if (!target || !raw || !key)
    throw new Error(
      "Staging is disabled: explicitly provide the test project reference, URL and publishable key. There is no production fallback.",
    );
  if (target === PRODUCTION_REF)
    throw new Error("Production is forbidden in the RFP staging harness.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid staging URL.");
  }
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname))
    throw new Error("Staging URL must be an origin without credentials, path, query or fragment.");
  if (target === "local") {
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !["http:", "https:"].includes(url.protocol)
    )
      throw new Error("Local staging must use an explicit loopback origin.");
  } else if (
    !/^[a-z]{20}$/.test(target) ||
    url.protocol !== "https:" ||
    url.hostname !== `${target}.supabase.co` ||
    url.port
  ) {
    throw new Error("Hosted staging URL must exactly match the non-production project reference.");
  }
  // Only opaque publishable keys are accepted; never service-role JWTs or secret keys.
  if (
    !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) ||
    key === "sb_publishable_uARvNwZli88tfhOHBwFTsQ_JUpQo-UL"
  )
    throw new Error(
      "Use only the staging project publishable key. Production, legacy JWT and secret keys are forbidden.",
    );
  return { url: url.origin, key, origin: url.origin, projectRef: target };
}
export function stagingFetch(
  config: StagingConfig,
  transport: typeof fetch = globalThis.fetch,
): typeof fetch {
  return async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const target = new URL(raw);
    if (target.origin !== config.origin || target.username || target.password)
      throw new Error("Blocked: request is outside the approved staging origin.");
    // Never follow a redirect from staging to a production or third-party host.
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    if (headers.get("Authorization") === `Bearer ${config.key}`) headers.delete("Authorization");
    headers.set("apikey", config.key);
    return transport(input, { ...init, headers, redirect: "error", credentials: "omit" });
  };
}
export function stagingCsp(config: StagingConfig) {
  return `default-src 'self'; connect-src ${config.origin}; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'`;
}
