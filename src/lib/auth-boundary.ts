/**
 * Trust Tai OS auth boundary — fails closed.
 *
 * No backend is connected yet. In production the workspace stays locked and the
 * shell renders a configuration state. There is no demo access in production.
 * A local preview of the shell is available only during development.
 */

export type WorkspaceAccess =
  | { state: "authenticated"; userId: string; organizationId: string }
  | { state: "unconfigured"; reason: string }
  | { state: "signed_out" };

/** True once an identity provider (Lovable Cloud) is wired up. */
export const AUTH_CONFIGURED = false;

/** Development-only inspection of the shell. Never true in a production build. */
export const PREVIEW_ALLOWED = import.meta.env.DEV;

export function resolveAccess(): WorkspaceAccess {
  if (!AUTH_CONFIGURED) {
    if (PREVIEW_ALLOWED) {
      return { state: "authenticated", userId: "usr_tai", organizationId: "org_trusttai" };
    }
    return {
      state: "unconfigured",
      reason: "Trust Tai identity is not connected for this environment.",
    };
  }
  return { state: "signed_out" };
}
