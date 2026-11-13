import { it, expect, vi, afterEach } from "vitest";
import { createPrivateKey, sign, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    throw Error("database_forbidden");
  },
}));
import {
  diagnostic,
  DIAGNOSTIC_URL,
  BODY_READ_TIMEOUT_MS,
} from "../../qa/studio-callback/inert/supabase/functions/studio-research-coordinator/handler";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("valid and invalid inert probes cannot access environment, DB or network", async () => {
  vi.stubGlobal("Deno", {
    env: {
      get: () => {
        throw Error("environment_forbidden");
      },
      toObject: () => {
        throw Error("environment_forbidden");
      },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("network_forbidden");
    }),
  );
  const key = createPrivateKey({
    format: "der",
    type: "pkcs8",
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex"),
    ]),
  });
  const body = Buffer.from(
    JSON.stringify({
      domain: "studio-callback-inert/v1",
      nonce: randomUUID(),
      issuedAt: 1000,
      expiresAt: 31000,
    }),
  );
  const token = body.toString("base64url") + "." + sign(null, body, key).toString("base64url");
  expect(
    await (
      await diagnostic(
        new Request(DIAGNOSTIC_URL, { method: "POST", body: JSON.stringify({ token }) }),
        () => 2000,
      )
    ).json(),
  ).toEqual({ build: "studio-callback-inert-v2", status: "signature_verified" });
  for (const url of [
    DIAGNOSTIC_URL,
    DIAGNOSTIC_URL + "?x=1",
    DIAGNOSTIC_URL.replace("diagnostic", "authority"),
  ])
    expect(
      (
        await diagnostic(
          new Request(url, { method: "POST", body: JSON.stringify({ token: "bad" }) }),
          () => 2000,
        )
      ).status,
    ).toBe(403);
  expect(
    (
      await diagnostic(
        new Request(DIAGNOSTIC_URL, { method: "POST", body: JSON.stringify({ token }) }),
        () => 32000,
      )
    ).status,
  ).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
  const source = readFileSync(
    "qa/studio-callback/inert/supabase/functions/studio-research-coordinator/handler.ts",
    "utf8",
  );
  expect(source).not.toMatch(/Deno\.env|process\.env|createClient|\bfetch\s*\(|createPrivateKey/);
});

it("inert valid request runs with process environment access forbidden", async () => {
  const key = createPrivateKey({
    format: "der",
    type: "pkcs8",
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex"),
    ]),
  });
  const bytes = Buffer.from(
    JSON.stringify({
      domain: "studio-callback-inert/v1",
      nonce: randomUUID(),
      issuedAt: 1000,
      expiresAt: 31000,
    }),
  );
  const token = bytes.toString("base64url") + "." + sign(null, bytes, key).toString("base64url");
  const good = new Request(DIAGNOSTIC_URL, { method: "POST", body: JSON.stringify({ token }) }),
    bad = new Request(DIAGNOSTIC_URL, { method: "POST", body: '{"token":"invalid"}' });
  const descriptor = Object.getOwnPropertyDescriptor(process, "env")!;
  let success = 0,
    denied = 0;
  try {
    Object.defineProperty(process, "env", {
      configurable: true,
      get() {
        throw Error("environment_forbidden");
      },
    });
    success = (await diagnostic(good, () => 2000)).status;
    denied = (await diagnostic(bad, () => 2000)).status;
  } finally {
    Object.defineProperty(process, "env", descriptor);
  }
  expect(success).toBe(200);
  expect(denied).toBe(403);
});

it.each(["stalled", "slow", "cancel-rejects", "cancel-never-settles"])(
  "bounds %s unsigned body and releases timer/reader",
  async (mode) => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw Error("network_forbidden");
      }),
    );
    vi.stubGlobal("Deno", {
      env: {
        get: () => {
          throw Error("environment_forbidden");
        },
      },
    });
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn(() =>
      mode === "cancel-rejects"
        ? Promise.reject(Error("cleanup_failed"))
        : mode === "cancel-never-settles"
          ? new Promise<void>(() => {})
          : undefined,
    );
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
      cancel,
    });
    const request = new Request(DIAGNOSTIC_URL, {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    const pending = diagnostic(request, () => 2000);
    await vi.advanceTimersByTimeAsync(BODY_READ_TIMEOUT_MS - 1);
    if (mode === "slow") controller.enqueue(new TextEncoder().encode('{"token":'));
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(403);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  },
);
it.each(["error", "oversize", "closed-invalid"])("cleans up read resources on %s", async (mode) => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      if (mode === "error") c.error(Error("source_error"));
      else {
        c.enqueue(new Uint8Array(mode === "oversize" ? 4097 : 1));
        if (mode === "closed-invalid") c.close();
      }
    },
    cancel,
  });
  const request = new Request(DIAGNOSTIC_URL, {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);
  expect((await diagnostic(request, () => 2000)).status).toBe(403);
  expect(body.locked).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  if (mode === "oversize") expect(cancel).toHaveBeenCalledOnce();
});
