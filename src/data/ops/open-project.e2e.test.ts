/**
 * End-to-end check of "open this Ops project from the Ops room".
 *
 * This exercises the exact chain the room uses: an Ops activity row becomes a
 * portfolio system, the system's destination becomes a target path, and the
 * launcher opens Ops in a new tab and hands the session over only after Ops
 * answers from its own origin. The promises under test are the security ones:
 * the exact ops.trusttai.com project is reached, and no auth token ever
 * appears in a URL, a window name, or a wildcard post.
 */

import { describe, expect, it } from "vitest";

import { OPS_ORIGIN, OPS_READY_MESSAGE, OPS_SESSION_MESSAGE, OPS_SSO_PATH } from "@/domain/ops";
import type { OpsEvent } from "@/domain/ops";
import { launchOps, type LaunchHost } from "@/lib/ops-launch";

import { opsPathOf } from "./destination";
import { opsPortfolio } from "./projection";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.super-secret-access-token.signature";
const ORG = "6f1d3f6e-6e0a-4f1e-9c37-2b0e7a2c9d41";
const PROJECT_PATH = "/projects/northlight-platform?tab=runs";

function opsRow(partial: Partial<OpsEvent> = {}): OpsEvent {
  return {
    id: "row-1",
    organizationId: ORG,
    name: "ops.issue_detected",
    at: "2026-08-18T10:00:00Z",
    summary: "Nightly deploy failed on the payments worker",
    idempotencyKey: "ops-row-1",
    chainKey: "northlight",
    destinationUrl: `${OPS_ORIGIN}${PROJECT_PATH}`,
    humanDecision: false,
    subjectLabel: "Northlight platform",
    canonicalProjectId: "proj-northlight",
    ...partial,
  } as OpsEvent;
}

function harness() {
  const opened: { url: string; target: string }[] = [];
  const posts: { data: Record<string, unknown>; targetOrigin: string }[] = [];
  let handler: ((event: MessageEvent) => void) | null = null;

  const opsWindow = {
    postMessage: (data: Record<string, unknown>, targetOrigin: string) => {
      posts.push({ data, targetOrigin });
    },
  } as unknown as Window;

  const host: LaunchHost = {
    open(url, target) {
      opened.push({ url, target });
      return opsWindow;
    },
    addEventListener: (_type, fn) => {
      handler = fn;
    },
    removeEventListener: () => {
      handler = null;
    },
    setTimeout: () => 1,
    clearTimeout: () => undefined,
  };

  return {
    host,
    opened,
    posts,
    opsReady() {
      handler?.({
        source: opsWindow,
        origin: OPS_ORIGIN,
        data: { type: OPS_READY_MESSAGE },
      } as MessageEvent);
    },
  };
}

/** The room's own click path, reproduced exactly. */
async function openFromRoom(h: ReturnType<typeof harness>, accessToken: string | null) {
  const portfolio = opsPortfolio([opsRow()]);
  const system = portfolio.systems[0]!;
  const launch = launchOps({
    accessToken,
    organizationId: ORG,
    ...(system.canonicalProjectId ? { canonicalProjectId: system.canonicalProjectId } : {}),
    ...(opsPathOf(system.destinationUrl) ? { targetPath: opsPathOf(system.destinationUrl)! } : {}),
    returnContext: "ops-room",
    host: h.host,
  });
  h.opsReady();
  return { system, result: await launch };
}

describe("opening an Ops project from the Ops room", () => {
  it("opens the exact ops.trusttai.com project in a new tab", async () => {
    const h = harness();
    const { system, result } = await openFromRoom(h, TOKEN);

    expect(result).toEqual({ ok: true });
    expect(system.name).toBe("Northlight platform");
    expect(h.opened).toHaveLength(1);
    expect(h.opened[0]!.url).toBe(`${OPS_ORIGIN}${OPS_SSO_PATH}`);
    expect(h.opened[0]!.url.startsWith("https://ops.trusttai.com/")).toBe(true);
    expect(h.opened[0]!.target).toBe("_blank");

    const post = h.posts[0]!;
    expect(post.targetOrigin).toBe(OPS_ORIGIN);
    expect(post.data["type"]).toBe(OPS_SESSION_MESSAGE);
    expect(post.data["targetPath"]).toBe(PROJECT_PATH);
    expect(post.data["canonicalProjectId"]).toBe("proj-northlight");
  });

  it("puts no auth token in any URL or window name", async () => {
    const h = harness();
    await openFromRoom(h, TOKEN);

    for (const { url, target } of h.opened) {
      expect(url).not.toContain(TOKEN);
      expect(url).not.toContain("access_token");
      expect(url).not.toContain("#");
      expect(url.split("?")[1]).toBeUndefined();
      expect(target).toBe("_blank");
    }
    // The token exists only inside the in-memory post to the exact origin.
    expect(h.posts[0]!.data["accessToken"]).toBe(TOKEN);
    expect(h.posts[0]!.targetOrigin).not.toBe("*");
  });

  it("never routes off the Ops origin, even if a row says otherwise", async () => {
    const portfolio = opsPortfolio([
      opsRow({ destinationUrl: "https://ops.evil.example/projects/steal" }),
    ]);
    const h = harness();
    const launch = launchOps({
      accessToken: TOKEN,
      organizationId: ORG,
      ...(opsPathOf(portfolio.systems[0]!.destinationUrl)
        ? { targetPath: opsPathOf(portfolio.systems[0]!.destinationUrl)! }
        : {}),
      host: h.host,
    });
    h.opsReady();
    await launch;

    expect(opsPathOf("https://ops.evil.example/projects/steal")).toBeUndefined();
    expect(h.opened[0]!.url).toBe(`${OPS_ORIGIN}${OPS_SSO_PATH}`);
    expect(h.posts[0]!.data["targetPath"]).toBeUndefined();
  });

  it("fails closed when signed out and opens no tab at all", async () => {
    const h = harness();
    const { result } = await openFromRoom(h, null);
    expect(result).toEqual({ ok: false, reason: "no_session" });
    expect(h.opened).toHaveLength(0);
    expect(h.posts).toHaveLength(0);
  });
});
