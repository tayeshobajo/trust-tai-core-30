import { it, expect, vi, afterEach } from "vitest";
import { createPrivateKey, sign, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
const h = vi.hoisted(() => ({ throwVerify: false }));
vi.mock("node:crypto", async (original) => {
  const real = await original<typeof import("node:crypto")>();
  return {
    ...real,
    verify: (...args: Parameters<typeof real.verify>) => {
      if (h.throwVerify) throw Error("private_error_must_not_escape");
      return real.verify(...args);
    },
  };
});
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    throw Error("database_forbidden");
  },
}));
import {
  diagnostic,
  DIAGNOSTIC_URL,
  BODY_READ_TIMEOUT_MS,
  STAGES,
} from "../../qa/studio-callback/inert-v3/supabase/functions/studio-research-coordinator/handler";
afterEach(() => {
  h.throwVerify = false;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const key = createPrivateKey({
  type: "pkcs8",
  format: "der",
  key: Buffer.from(
    "302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    "hex",
  ),
});
const payload = () => ({
  domain: "studio-callback-inert/v1",
  nonce: randomUUID(),
  issuedAt: 1000,
  expiresAt: 31000,
});
const encoded = (raw: string) => {
  const b = Buffer.from(raw);
  return JSON.stringify({
    token: b.toString("base64url") + "." + sign(null, b, key).toString("base64url"),
  });
};
const valid = () => encoded(JSON.stringify(payload()));
const req = (body?: BodyInit, url = DIAGNOSTIC_URL, method = "POST") =>
  new Request(url, {
    method,
    ...(body === undefined ? {} : { body }),
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);
const seen = new Set<string>();
async function check(request: Request, stage: string, now: () => number = () => 2000) {
  const response = await diagnostic(request, now),
    p = await response.json();
  seen.add(p.stage);
  expect(p.stage).toBe(stage);
  expect(response.status).toBe(stage === "accepted" ? 200 : 403);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(Object.keys(p).sort()).toEqual(["build", "checks", "observed", "stage", "status"]);
  expect(p.build).toBe("studio-callback-inert-v3");
  expect(JSON.stringify(p)).not.toContain("private_error");
  return p;
}
it("covers all fixed failure stages and acceptance without arbitrary error output", async () => {
  await check(req(undefined, DIAGNOSTIC_URL, "GET"), "method");
  await check(req(), "body_missing");
  await check(req("{"), "outer_json");
  for (const body of ["null", "[]", '{"token":1}', '{"token":"x","secret":"private_error"}'])
    await check(req(body), "outer_shape");
  await check(req('{"token":"bad"}'), "token_format");
  await check(req('{"token":"e30.AA"}'), "signature_invalid");
  const invalid = JSON.parse(valid());
  invalid.token = invalid.token.split(".")[0] + "." + Buffer.alloc(64).toString("base64url");
  await check(req(JSON.stringify(invalid)), "signature_invalid");
  h.throwVerify = true;
  await check(req(valid()), "signature_error");
  h.throwVerify = false;
  await check(req(encoded("{")), "payload_json");
  for (const p of [
    null,
    [],
    {},
    { ...payload(), domain: "private_error" },
    { ...payload(), nonce: "private_error" },
  ])
    await check(req(encoded(JSON.stringify(p))), "payload_shape");
  for (const p of [
    { ...payload(), issuedAt: 3000 },
    { ...payload(), expiresAt: 2000 },
    { ...payload(), expiresAt: 1000 },
    { ...payload(), expiresAt: 62000 },
  ])
    await check(req(encoded(JSON.stringify(p))), "clock_bounds");
  await check(req(valid()), "internal_error", () => {
    throw Error("private_error");
  });
  const p = await check(req(valid()), "accepted");
  expect(p.checks).toEqual({ destination: "match", signature: "valid" });
  expect(p.observed).toEqual({
    method: "POST",
    protocol: "https",
    host: "expected_host",
    path: "expected_path",
    query: "absent",
  });
  const denied = await check(
    req(valid(), "http://localhost:8000/studio-research-coordinator/diagnostic"),
    "canonical_url",
  );
  expect(denied.checks).toEqual({ destination: "mismatch", signature: "valid" });
  expect(denied.observed).toEqual({
    method: "POST",
    protocol: "http",
    host: "loopback",
    path: "function_relative",
    query: "absent",
  });
});
it("redacts arbitrary method/host/path/query and ignores forwarded headers", async () => {
  for (const [url, path] of [
    ["https://private-error.invalid/private_error?private_error=1", "other"],
    [DIAGNOSTIC_URL + "?private_error=1", "expected_path"],
    ["https://okydosoacqdnursmmenf.supabase.co/diagnostic", "diagnostic_only"],
    [DIAGNOSTIC_URL.replace("diagnostic", "%64iagnostic"), "other"],
  ]) {
    const request = req(valid(), url!);
    request.headers.set("x-forwarded-host", "okydosoacqdnursmmenf.supabase.co");
    request.headers.set("x-original-url", DIAGNOSTIC_URL);
    const p = await check(request, "canonical_url");
    expect(p.observed.path).toBe(path);
    expect(JSON.stringify(p)).not.toContain("private_error");
  }
  const p = await check(req("private_error", DIAGNOSTIC_URL, "PATCH"), "method");
  expect(p.observed.method).toBe("other");
});
it.each(["stalled", "slow", "cancel-rejects", "cancel-pending"])(
  "bounds %s body and cleans up without disclosure",
  async (mode) => {
    vi.useFakeTimers();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn(() =>
      mode === "cancel-rejects"
        ? Promise.reject(Error("private_error"))
        : mode === "cancel-pending"
          ? new Promise<void>(() => {})
          : undefined,
    );
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
      cancel,
    });
    const pending = check(req(stream), "body_timeout");
    await vi.advanceTimersByTimeAsync(BODY_READ_TIMEOUT_MS - 1);
    if (mode === "slow") controller.enqueue(new TextEncoder().encode('{"token":'));
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  },
);
it("bounds oversized and failed streams", async () => {
  vi.useFakeTimers();
  for (const mode of ["limit", "error"]) {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        if (mode === "error") c.error(Error("private_error"));
        else c.enqueue(new Uint8Array(4097));
      },
    });
    await check(req(stream), mode === "limit" ? "body_limit" : "body_error");
    expect(stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  }
});
it("valid and invalid inputs cannot access environment, database or outbound network", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("outbound_forbidden");
    }),
  );
  vi.stubGlobal("Deno", {
    env: {
      get: () => {
        throw Error("env_forbidden");
      },
    },
  });
  const requests = [req(valid()), req("bad")],
    descriptor = Object.getOwnPropertyDescriptor(process, "env")!;
  const replies: Response[] = [];
  try {
    Object.defineProperty(process, "env", {
      configurable: true,
      get() {
        throw Error("env_forbidden");
      },
    });
    for (const r of requests) replies.push(await diagnostic(r, () => 2000));
  } finally {
    Object.defineProperty(process, "env", descriptor);
  }
  expect(replies.map((r) => r.status)).toEqual([200, 403]);
  expect(fetch).not.toHaveBeenCalled();
  const source = readFileSync(
    "qa/studio-callback/inert-v3/supabase/functions/studio-research-coordinator/handler.ts",
    "utf8",
  );
  expect(source).not.toMatch(
    /Deno\.env|process\.env|createClient|\bfetch\s*\(|console\.|request\.headers|createPrivateKey/,
  );
});
it("exercises every declared response code", () => {
  expect([...seen].sort()).toEqual([...STAGES].sort());
});
