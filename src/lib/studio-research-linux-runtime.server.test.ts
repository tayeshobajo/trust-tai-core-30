import { it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import {
  prepareLinuxRun,
  LINUX_RUNTIME,
  linuxRuntimeReadiness,
  observeLinuxProcess,
  createLinuxPreviewExecutor,
} from "./studio-research-linux-runtime.server";
import { COORDINATOR, digest } from "./studio-research-coordinator-contracts";
import type { ExecutionInput } from "./studio-research-coordinator.server";
function input(): ExecutionInput {
  return {
    requestId: randomUUID(),
    issueId: randomUUID(),
    runId: randomUUID(),
    sessionId: `ses_${randomUUID()}`,
    nonce: randomUUID(),
    prompt: "untrusted synthetic public evidence",
    launchDeadline: 2000,
    completionDeadline: 61000,
    signal: new AbortController().signal,
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
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("pins actual inspected Linux metadata and remains closed", () => {
  expect(LINUX_RUNTIME.packageVersion).toBe("1.18.18");
  expect(LINUX_RUNTIME.sha256).toBe(
    "bb71f45b564f9234a97f54d6252a4a41d2f4388ae4b078918f691824cc3b3e54",
  );
  expect(linuxRuntimeReadiness().available).toBe(false);
  expect(linuxRuntimeReadiness().reasons).not.toContain("per_job_boundary_unverified");
  expect(typeof createLinuxPreviewExecutor).toBe("function");
});
it("prepares a fresh private config and clean env without inheriting service secrets/options", () => {
  vi.stubEnv("UNRELATED_SERVICE_KEY", "never-inherit");
  vi.stubEnv("NODE_OPTIONS", "--require=/unrelated/hook.js");
  vi.stubEnv("OPENAI_API_KEY", "never-inherit");
  const i = input(),
    a = prepareLinuxRun(i, "synthetic-key", 1000),
    b = prepareLinuxRun(i, "synthetic-key", 1000);
  try {
    expect(a.options.cwd).not.toBe(b.options.cwd);
    expect(a.options.shell).toBe(false);
    expect(a.options.detached).toBe(true);
    expect(a.executable).toBe("/opt/trusttai/studio-runtime/opencode-1.18.18");
    expect(a.options.env).not.toHaveProperty("NODE_OPTIONS");
    expect(JSON.stringify(a.options.env)).not.toContain("never-inherit");
    expect(a.argv).not.toContain("--continue");
    expect(a.argv).not.toContain("--session");
    expect(a.argv).not.toContain("--attach");
    expect(a.stdin).toBe(i.prompt);
    const config = JSON.parse(readFileSync(a.options.env.OPENCODE_CONFIG, "utf8"));
    expect(config.model).toBe(COORDINATOR.model);
    expect(config.small_model).toBe(COORDINATOR.model);
    expect(config.permission).toEqual({ "*": "deny" });
    expect(config.provider["zai-coding-plan"].options.baseURL).toBe("http://127.0.0.1:43119/v1");
    expect(statSync(a.options.env.OPENCODE_CONFIG).mode & 0o777).toBe(0o600);
    expect(a.bindingDigest).toHaveLength(64);
  } finally {
    a.cleanup();
    b.cleanup();
  }
});
it.each(["actual-key", "", "synthetic-$(touch hacked)"])(
  "rejects non-synthetic credentials %s",
  (key) => {
    expect(() => prepareLinuxRun(input(), key, 1000)).toThrow();
  },
);
it("rejects expired, aborted and oversized inputs before any launch", () => {
  expect(() => prepareLinuxRun(input(), "synthetic-k", 2000)).toThrow();
  expect(() =>
    prepareLinuxRun({ ...input(), prompt: "x".repeat(25001) }, "synthetic-k", 1000),
  ).toThrow();
  expect(() =>
    prepareLinuxRun({ ...input(), signal: AbortSignal.abort() }, "synthetic-k", 1000),
  ).toThrow();
});
function fake() {
  const c = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: PassThrough;
    stderr: PassThrough;
  };
  c.pid = 12345;
  c.stdout = new PassThrough();
  c.stderr = new PassThrough();
  return c;
}
it("observes group TERM/KILL and absence without claiming all descendants or provider stop", async () => {
  vi.useFakeTimers();
  const c = fake();
  let gone = false;
  const signals = vi.fn((_pid: number, signal: NodeJS.Signals | 0) => {
    if (signal === 0 && gone) throw Object.assign(Error(), { code: "ESRCH" });
  });
  const h = observeLinuxProcess(
    c as unknown as ChildProcessWithoutNullStreams,
    100,
    digest("run"),
    signals,
  );
  await vi.advanceTimersByTimeAsync(101);
  expect(signals).toHaveBeenCalledWith(-12345, "SIGTERM");
  await vi.advanceTimersByTimeAsync(5000);
  expect(signals).toHaveBeenCalledWith(-12345, "SIGKILL");
  gone = true;
  c.emit("close", null);
  expect(h.observation()).toMatchObject({
    scope: "process-group",
    immediateChildClosed: true,
    groupAbsentObserved: true,
    escapedDescendants: "unverified",
    providerCancellation: "unverified",
  });
  h.dispose();
});
it("does not signal a possibly reused group after child close and keeps uncertain descendants explicit", async () => {
  vi.useFakeTimers();
  const c = fake(),
    signals = vi.fn();
  const h = observeLinuxProcess(
    c as unknown as ChildProcessWithoutNullStreams,
    100,
    digest("run"),
    signals,
  );
  h.stop();
  c.emit("close", null);
  await vi.advanceTimersByTimeAsync(6000);
  h.stop();
  expect(signals.mock.calls.filter((x) => x[1] === "SIGKILL")).toHaveLength(0);
  expect(h.observation()).toMatchObject({
    groupAbsentObserved: false,
    escapedDescendants: "unverified",
  });
  h.dispose();
});
it("group signalling permission failure never falls back to an unrelated direct PID", () => {
  const c = fake(),
    signals = vi.fn((_pid: number, _signal: NodeJS.Signals | 0) => {
      throw Object.assign(Error(), { code: "EPERM" });
    });
  const h = observeLinuxProcess(
    c as unknown as ChildProcessWithoutNullStreams,
    100,
    digest("run"),
    signals,
  );
  h.stop();
  expect(h.observation().termSent).toBe(false);
  expect(signals.mock.calls.every((x) => x[0] === -12345)).toBe(true);
  h.dispose();
});
it("captures native session separately under exact binding without fabricating coordinator receipt", async () => {
  const c = fake(),
    h = observeLinuxProcess(
      c as unknown as ChildProcessWithoutNullStreams,
      1000,
      digest("exact-run"),
      () => {},
    );
  c.stdout.write(
    [
      { type: "step_start", sessionID: "native-session" },
      { type: "text", sessionID: "native-session", part: { text: "{}" } },
      { type: "step_finish", sessionID: "native-session", part: { reason: "stop" } },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n"),
  );
  c.emit("close", 0);
  const result = await h.completion;
  expect(result.nativeSessionId).toBe("native-session");
  expect(result.bindingDigest).toBe(digest("exact-run"));
  expect(result.providerRequests).toBeNull();
  expect(result).not.toHaveProperty("receipt");
  h.dispose();
});

it.each([NaN, Infinity, -Infinity, 1.5])("rejects non-finite/non-integer clocks %s", (value) => {
  expect(() => prepareLinuxRun(input(), "synthetic-key", value)).toThrow();
  expect(() =>
    prepareLinuxRun({ ...input(), launchDeadline: value }, "synthetic-key", 1000),
  ).toThrow();
  expect(() =>
    prepareLinuxRun({ ...input(), completionDeadline: value }, "synthetic-key", 1000),
  ).toThrow();
  expect(() =>
    observeLinuxProcess(
      fake() as unknown as ChildProcessWithoutNullStreams,
      value,
      digest("run"),
      () => {},
    ),
  ).toThrow();
});
it("settles unconfirmed when signals fail and close never arrives; late close cannot turn it into success", async () => {
  vi.useFakeTimers();
  const c = fake();
  const signal = vi.fn(() => {
    throw Object.assign(Error(), { code: "EPERM" });
  });
  const h = observeLinuxProcess(
    c as unknown as ChildProcessWithoutNullStreams,
    100,
    digest("run"),
    signal,
  );
  const failure = expect(h.completion).rejects.toThrow("linux_termination_unconfirmed");
  await vi.advanceTimersByTimeAsync(6101);
  await failure;
  expect(h.observation()).toMatchObject({
    immediateChildClosed: false,
    groupAbsentObserved: false,
    termSent: false,
    killSent: false,
  });
  c.emit("close", 0);
  expect(h.observation().immediateChildClosed).toBe(true);
  await expect(h.completion).rejects.toThrow("linux_termination_unconfirmed");
  h.dispose();
});
