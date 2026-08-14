/**
 * The Ops launch handshake.
 *
 * Rules that are not negotiable:
 *  - no session, no launch,
 *  - the token never touches a URL, a hash, a window name, or storage,
 *  - Ops must say it is ready, from the exact Ops origin, before anything
 *    sensitive is posted,
 *  - the post uses the exact target origin, never "*",
 *  - a blocked popup is reported, never worked around by navigating with a
 *    token-bearing URL.
 */

import { OPS_ORIGIN, OPS_READY_MESSAGE, OPS_SESSION_MESSAGE, OPS_SSO_PATH } from "@/domain/ops";

export type OpsLaunchFailure =
  | "no_session"
  | "no_organization"
  | "popup_blocked"
  | "no_ack";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OpsLaunchResult = { ok: true } | { ok: false; reason: OpsLaunchFailure };

/** The browser surface the launcher needs. Injected so it can be tested. */
export interface LaunchHost {
  open(url: string, target: string, features?: string): Window | null;
  addEventListener(type: "message", handler: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", handler: (event: MessageEvent) => void): void;
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export interface LaunchOpsOptions {
  /** The current Trust Tai OS access token. Absent means fail closed. */
  accessToken: string | null | undefined;
  /**
   * The organization the session is acting in. Ops requires it and requires a
   * UUID. An absent or malformed id fails closed before anything is opened.
   */
  organizationId: string | null | undefined;
  canonicalProjectId?: string | undefined;
  /** Optional hint about where the person came from. Never sensitive. */
  returnContext?: string | undefined;
  origin?: string;
  host?: LaunchHost;
  /** How long to wait for Ops to say it is ready. */
  timeoutMs?: number;
}

function browserHost(): LaunchHost {
  return {
    open: (url, target, features) => window.open(url, target, features),
    addEventListener: (type, handler) => window.addEventListener(type, handler),
    removeEventListener: (type, handler) => window.removeEventListener(type, handler),
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    clearTimeout: (handle) => window.clearTimeout(handle),
  };
}

/** Open Ops and hand the session over once Ops acknowledges. */
export function launchOps(options: LaunchOpsOptions): Promise<OpsLaunchResult> {
  const origin = options.origin ?? OPS_ORIGIN;
  const token = (options.accessToken ?? "").trim();
  if (!token) return Promise.resolve({ ok: false, reason: "no_session" });

  const organizationId = (options.organizationId ?? "").trim();
  if (!UUID.test(organizationId)) {
    return Promise.resolve({ ok: false, reason: "no_organization" });
  }

  const host = options.host ?? browserHost();
  // "_blank" only: a window name is readable cross-document, so it never
  // carries anything about the session.
  const opened = host.open(`${origin}${OPS_SSO_PATH}`, "_blank", "noopener=no,noreferrer=no");
  if (!opened) return Promise.resolve({ ok: false, reason: "popup_blocked" });

  return new Promise<OpsLaunchResult>((resolve) => {
    let settled = false;
    let timer = 0;

    const finish = (result: OpsLaunchResult) => {
      if (settled) return;
      settled = true;
      host.removeEventListener("message", onMessage);
      host.clearTimeout(timer);
      resolve(result);
    };

    function onMessage(event: MessageEvent) {
      if (event.origin !== origin) return;
      if (event.source && opened && event.source !== opened) return;
      const data = event.data as { type?: unknown } | null;
      if (!data || data.type !== OPS_READY_MESSAGE) return;

      opened?.postMessage(
        {
          type: OPS_SESSION_MESSAGE,
          accessToken: token,
          organizationId,
          ...(options.canonicalProjectId
            ? { canonicalProjectId: options.canonicalProjectId }
            : {}),
          ...(options.returnContext ? { returnContext: options.returnContext } : {}),
          issuedAt: new Date().toISOString(),
        },
        origin,
      );
      finish({ ok: true });
    }

    host.addEventListener("message", onMessage);
    timer = host.setTimeout(
      () => finish({ ok: false, reason: "no_ack" }),
      options.timeoutMs ?? 15_000,
    );
  });
}

export const OPS_LAUNCH_MESSAGE: Record<OpsLaunchFailure, string> = {
  no_session: "You are signed out, so Ops cannot be opened from here. Sign in and try again.",
  no_organization:
    "No Trust Tai organization is active for this session, so nothing was sent to Ops.",
  popup_blocked: "Your browser blocked the Ops window. Allow the popup and try again.",
  no_ack: "Ops did not answer the handshake. Nothing was sent. Try again.",
};
