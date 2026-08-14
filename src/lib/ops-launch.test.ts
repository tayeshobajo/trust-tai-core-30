/**
 * Acceptance checks for the Ops launch handshake.
 *
 * These prove the security properties, not the styling: fail closed when
 * signed out, never leak the token into anything the browser persists or
 * exposes, and never post before Ops answers from its exact origin.
 */

import { describe, expect, it } from "vitest";

import { OPS_ORIGIN, OPS_READY_MESSAGE, OPS_SESSION_MESSAGE, OPS_SSO_PATH } from "@/domain/ops";
import { launchOps, type LaunchHost } from "./ops-launch";

const TOKEN = "test-access-token-abc123";
const ORG = "6f1d3f6e-6e0a-4f1e-9c37-2b0e7a2c9d41";

function harness() {
  const opened: { url: string; target: string }[] = [];
  const posts: { data: Record<string, unknown>; targetOrigin: string }[] = [];
  let handler: ((event: MessageEvent) => void) | null = null;
  const timers = new Map<number, () => void>();
  let nextTimer = 1;

  const fakeWindow = {
    postMessage: (data: Record<string, unknown>, targetOrigin: string) => {
      posts.push({ data, targetOrigin });
    },
  } as unknown as Window;

  const host: LaunchHost & { blocked?: boolean } = {
    open(url, target) {
      opened.push({ url, target });
      return host.blocked ? null : fakeWindow;
    },
    addEventListener: (_type, fn) => {
      handler = fn;
    },
    removeEventListener: () => {
      handler = null;
    },
    setTimeout: (fn) => {
      const id = nextTimer++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
  };

  return {
    host,
    opened,
    posts,
    fakeWindow,
    fire(event: Partial<MessageEvent>) {
      handler?.({ source: fakeWindow, ...event } as MessageEvent);
    },
    expire() {
      for (const fn of [...timers.values()]) fn();
    },
  };
}

describe("Ops launch", () => {
  it("fails closed when there is no session and never opens a window", async () => {
    const h = harness();
    const result = await launchOps({ accessToken: null, organizationId: ORG, host: h.host });
    expect(result).toEqual({ ok: false, reason: "no_session" });
    expect(h.opened).toHaveLength(0);
    expect(h.posts).toHaveLength(0);
  });

  it("uses the exact contract Ops publishes", () => {
    // These are the Ops bridge's own values. Changing one here without Ops
    // changing it there breaks the handshake silently, so assert them.
    expect(OPS_SSO_PATH).toBe("/sso");
    expect(OPS_READY_MESSAGE).toBe("trust-tai-ops:sso-ready");
    expect(OPS_SESSION_MESSAGE).toBe("trust-tai-os:sso");
  });

  it("fails closed when no organization is active", async () => {
    const h = harness();
    const result = await launchOps({ accessToken: TOKEN, organizationId: null, host: h.host });
    expect(result).toEqual({ ok: false, reason: "no_organization" });
    expect(h.opened).toHaveLength(0);
    expect(h.posts).toHaveLength(0);
  });

  it("fails closed when the organization is not a UUID", async () => {
    const h = harness();
    const result = await launchOps({ accessToken: TOKEN, organizationId: "org-1", host: h.host });
    expect(result).toEqual({ ok: false, reason: "no_organization" });
    expect(h.opened).toHaveLength(0);
    expect(h.posts).toHaveLength(0);
  });

  it("opens the exact Ops SSO origin with no token in the URL or window name", async () => {
    const h = harness();
    const launch = launchOps({ accessToken: TOKEN, organizationId: ORG, host: h.host });
    h.fire({ origin: OPS_ORIGIN, data: { type: OPS_READY_MESSAGE } });
    await launch;

    const opened = h.opened[0]!;
    expect(opened.url).toBe(`${OPS_ORIGIN}${OPS_SSO_PATH}`);
    expect(opened.url).not.toContain(TOKEN);
    expect(opened.url).not.toContain("#");
    expect(opened.target).toBe("_blank");
    expect(opened.target).not.toContain(TOKEN);
  });

  it("posts nothing until Ops acknowledges, then posts to the exact origin", async () => {
    const h = harness();
    const launch = launchOps({ accessToken: TOKEN, organizationId: ORG, host: h.host });
    expect(h.posts).toHaveLength(0);

    h.fire({ origin: OPS_ORIGIN, data: { type: OPS_READY_MESSAGE } });
    const result = await launch;

    expect(result).toEqual({ ok: true });
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]!.targetOrigin).toBe(OPS_ORIGIN);
    expect(h.posts[0]!.targetOrigin).not.toBe("*");
    expect(h.posts[0]!.data["type"]).toBe(OPS_SESSION_MESSAGE);
    expect(h.posts[0]!.data["accessToken"]).toBe(TOKEN);
    expect(h.posts[0]!.data["organizationId"]).toBe(ORG);
  });

  it("ignores a ready signal from any other origin", async () => {
    const h = harness();
    const launch = launchOps({ accessToken: TOKEN, organizationId: ORG, host: h.host });
    h.fire({ origin: "https://ops.evil.example", data: { type: OPS_READY_MESSAGE } });
    expect(h.posts).toHaveLength(0);
    h.expire();
    expect(await launch).toEqual({ ok: false, reason: "no_ack" });
    expect(h.posts).toHaveLength(0);
  });

  it("carries the canonical project id when launched from a project", async () => {
    const h = harness();
    const launch = launchOps({
      accessToken: TOKEN,
      organizationId: ORG,
      canonicalProjectId: "proj-77",
      host: h.host,
    });
    h.fire({ origin: OPS_ORIGIN, data: { type: OPS_READY_MESSAGE } });
    await launch;
    expect(h.posts[0]!.data["canonicalProjectId"]).toBe("proj-77");
  });

  it("reports a blocked popup instead of navigating with a token", async () => {
    const h = harness();
    h.host.blocked = true;
    const result = await launchOps({ accessToken: TOKEN, organizationId: ORG, host: h.host });
    expect(result).toEqual({ ok: false, reason: "popup_blocked" });
    expect(h.posts).toHaveLength(0);
  });
});
