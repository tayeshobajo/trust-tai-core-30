/**
 * Build metadata for deployment diagnostics.
 *
 * Populated at build time by the deployment through VITE_BUILD_SHA and
 * VITE_BUILD_TIME. Metadata only: never read a privileged variable here,
 * because everything in this module reaches the browser.
 */

const env = import.meta.env as Record<string, string | undefined>;

function clean(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  return text.length > 0 ? text : null;
}

export interface BuildInfo {
  /** Short commit SHA, when the deployment provided one. */
  commitSha: string | null;
  /** ISO build timestamp, when the deployment provided one. */
  builtAt: string | null;
  mode: string;
}

export function readBuildInfo(): BuildInfo {
  const sha = clean(env["VITE_BUILD_SHA"]);
  return {
    commitSha: sha ? sha.slice(0, 12) : null,
    builtAt: clean(env["VITE_BUILD_TIME"]),
    mode: env["MODE"] ?? "unknown",
  };
}
