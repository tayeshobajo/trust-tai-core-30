import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, rmSync } from "node:fs";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), inspect: vi.fn(), cleanupFail: false }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    rmSync: (...args: Parameters<typeof actual.rmSync>) => {
      if (mocks.cleanupFail) throw Error("cleanup-io");
      return actual.rmSync(...args);
    },
  };
});
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("./studio-research-linux-runtime-preflight.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  inspectProtectedLinuxExecutable: mocks.inspect,
}));
import { createLinuxPreviewExecutor } from "./studio-research-linux-runtime.server";
import { COORDINATOR } from "./studio-research-coordinator-contracts";
import type { ExecutionInput } from "./studio-research-coordinator.server";
function input(signal = new AbortController().signal): ExecutionInput {
  return {
    requestId: randomUUID(),
    issueId: randomUUID(),
    runId: randomUUID(),
    sessionId: `ses_${randomUUID()}`,
    nonce: randomUUID(),
    prompt: "public supplied evidence",
    launchDeadline: Date.now() + 5000,
    completionDeadline: Date.now() + 60000,
    signal,
    profile: {
      primaryModel: COORDINATOR.model,
      auxiliaryModel: COORDINATOR.model,
      endpoint: COORDINATOR.endpoint,
      nativeTools: "deny",
      maxProviderRequests: null,
      maxCliJobs: 1,
      timeoutMs: 60000,
      freshSession: true,
      retries: 0,
      genericWake: false,
      runtimeLogs: false,
    },
  };
}
function fake() {
  return Object.assign(new EventEmitter(), {
    pid: 12345,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  mocks.spawn.mockReset();
  mocks.inspect.mockReset();
  mocks.cleanupFail = false;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("executes fixed recipe once, preserves native events/session mapping, clears private files", async () => {
  const c = fake();
  let configPath = "";
  mocks.spawn.mockImplementation((_path, _argv, options) => {
    configPath = options.env.OPENCODE_CONFIG;
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    expect(cfg.provider["zai-coding-plan"].options.baseURL).toBe(COORDINATOR.endpoint);
    expect(options.env.OPENCODE_PURE).toBe("true");
    expect(options.env.OPENCODE_DISABLE_DEFAULT_PLUGINS).toBe("true");
    expect(options.env.NODE_OPTIONS).toBeUndefined();
    expect(options.env.npm_config_offline).toBe("true");
    expect(readFileSync(options.env.npm_config_userconfig, "utf8")).toContain("offline=true");
    return c;
  });
  const authorizeCurrent = vi.fn(async () => {});
  const runtime = createLinuxPreviewExecutor({
    authorizeCurrent,
    providerKey: async () => "synthetic-runtime-key-for-tests",
  });
  const i = input();
  const h = await runtime.start(i);
  expect(authorizeCurrent).toHaveBeenCalledTimes(2);
  expect(mocks.inspect).toHaveBeenCalledTimes(2);
  const stdout = [
    { type: "step_start", sessionID: "native-id" },
    { type: "reasoning", sessionID: "native-id", part: { text: "ignored" } },
    { type: "text", sessionID: "native-id", part: { text: "{}" } },
    { type: "step_finish", sessionID: "native-id", part: { reason: "stop" } },
  ]
    .map((x) => JSON.stringify(x))
    .join("\n");
  c.stdout.write(stdout);
  c.emit("close", 0);
  const capture = await h.completion;
  expect(capture.stdout).toBe(stdout);
  expect(capture.receipt).toMatchObject({
    sessionId: i.sessionId,
    nativeSession: { id: "native-id" },
  });
  expect(capture.accounting.immediateChildClosed).toBe(true);
  expect(existsSync(configPath)).toBe(false);
  await expect(runtime.start(i)).rejects.toThrow("consumed");
  expect(mocks.spawn).toHaveBeenCalledOnce();
});
it("revocation or late credential resolve prevents spawn and consumes this preview", async () => {
  const authorizeCurrent = vi.fn(async () => {}).mockRejectedValueOnce(Error("revoked"));
  const r = createLinuxPreviewExecutor({
    authorizeCurrent,
    providerKey: async () => "synthetic-runtime-key-for-tests",
  });
  await expect(r.start(input())).rejects.toThrow("revoked");
  expect(mocks.spawn).not.toHaveBeenCalled();
  const late = createLinuxPreviewExecutor({
    authorizeCurrent: async () => {},
    providerKey: async () => {
      vi.setSystemTime(7000);
      return "synthetic-runtime-key-for-tests";
    },
  });
  await expect(late.start(input())).rejects.toThrow("launch_expired");
  expect(mocks.spawn).not.toHaveBeenCalled();
});
it("abort sends exact group signals; stop never upgrades group evidence to all-stopped", async () => {
  const c = fake();
  mocks.spawn.mockReturnValue(c);
  const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
  const ac = new AbortController();
  const h = await createLinuxPreviewExecutor({
    authorizeCurrent: async () => {},
    providerKey: async () => "synthetic-runtime-key-for-tests",
  }).start(input(ac.signal));
  ac.abort();
  expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
  await vi.advanceTimersByTimeAsync(5000);
  expect(kill).toHaveBeenCalledWith(-12345, "SIGKILL");
  c.emit("close", null);
  await expect(h.completion).rejects.toThrow();
  expect(await h.stop()).toBe(false);
  expect(h.observation().providerCancellation).toBe("unverified");
});
it("supervisor init failure after spawn terminates only exact group and never retries", async () => {
  const c = fake();
  c.stdout.on = () => {
    throw Error("observer-init");
  };
  mocks.spawn.mockReturnValue(c);
  const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
  const runtime = createLinuxPreviewExecutor({
    authorizeCurrent: async () => {},
    providerKey: async () => "synthetic-runtime-key-for-tests",
  });
  await expect(runtime.start(input())).rejects.toThrow("observer-init");
  expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
  await vi.advanceTimersByTimeAsync(5000);
  expect(kill).toHaveBeenCalledWith(-12345, "SIGKILL");
  c.emit("close", null);
  expect(mocks.spawn).toHaveBeenCalledOnce();
});

it("cleanup failure after fallback close cannot escape event callback", async () => {
  const c = fake();
  c.stdout.on = () => {
    throw Error("observer-init");
  };
  let cwd = "";
  mocks.spawn.mockImplementation((_p, _a, options) => {
    cwd = options.cwd;
    return c;
  });
  vi.spyOn(process, "kill").mockImplementation(() => true);
  await expect(
    createLinuxPreviewExecutor({
      authorizeCurrent: async () => {},
      providerKey: async () => "synthetic-runtime-key-for-tests",
    }).start(input()),
  ).rejects.toThrow("observer-init");
  mocks.cleanupFail = true;
  expect(() => c.emit("close", null)).not.toThrow();
  mocks.cleanupFail = false;
  rmSync(cwd, { recursive: true, force: true });
});
