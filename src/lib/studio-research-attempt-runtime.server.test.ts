import { it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { existsSync } from "node:fs";
import { COORDINATOR, profileSchema } from "./studio-research-coordinator-contracts";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), inspect: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("./studio-research-linux-runtime-preflight.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  inspectProtectedLinuxExecutable: mocks.inspect,
}));
import { createLinuxTimingAdapter } from "./studio-research-linux-runtime.server";
afterEach(() => {
  vi.restoreAllMocks();
  mocks.spawn.mockReset();
  mocks.inspect.mockReset();
});
async function prepared() {
  const runtime = createLinuxTimingAdapter({ providerKey: async () => "synthetic-provider-key" });
  const requestId = randomUUID(),
    issueId = randomUUID(),
    runId = randomUUID(),
    signal = new AbortController().signal;
  const input = {
    requestId,
    issueId,
    runId,
    nonce: randomUUID(),
    sessionId: `ses_${randomUUID()}`,
    signal,
    prompt: "synthetic evidence",
    profile: profileSchema.parse({
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
    }),
  };
  const value = await runtime.prepare(input, {
    requestId,
    issueId,
    runId,
    attemptId: randomUUID(),
    priorRunId: randomUUID(),
    subjectId: randomUUID(),
    organizationId: COORDINATOR.organizationId,
    companyId: COORDINATOR.companyId,
    projectId: COORDINATOR.projectId,
    agentId: COORDINATOR.agentId,
    sourceDigest: "a".repeat(64),
    approvalDigest: "b".repeat(64),
  });
  return { runtime, value, signal };
}
it("v2 runtime prepares without spawning, rechecks executable, binds capture and disposes private files", async () => {
  const f = await prepared();
  expect(mocks.spawn).not.toHaveBeenCalled();
  const child = Object.assign(new EventEmitter(), {
    pid: 24680,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  mocks.spawn.mockReturnValue(child);
  try {
    const h = f.runtime.spawn(f.value, f.signal, {
      launchDeadline: Date.now() + 1000,
      providerDeadline: Date.now() + 2000,
    });
    child.emit("spawn");
    await h.started;
    for (const e of [
      { type: "step_start" },
      { type: "text", part: { text: "synthetic output" } },
      { type: "step_finish", part: { reason: "stop" } },
    ])
      child.stdout.write(JSON.stringify({ ...e, sessionID: "synthetic-native" }) + "\n");
    child.emit("close", 0);
    expect(await h.completion).toMatchObject({
      immediateChildClosed: true,
      value: { text: "synthetic output", bindingDigest: f.value.bindingDigest },
    });
    expect(mocks.inspect).toHaveBeenCalledTimes(2);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(() =>
      f.runtime.spawn(f.value, f.signal, {
        launchDeadline: Date.now() + 1000,
        providerDeadline: Date.now() + 2000,
      }),
    ).toThrow("runtime_attempt_consumed");
  } finally {
    f.runtime.dispose(f.value);
  }
  expect(existsSync(f.value.spec.options.cwd)).toBe(false);
});
it("observer setup failure after native spawn still returns its exact stop handle", async () => {
  const f = await prepared();
  const child = Object.assign(new EventEmitter(), {
    pid: undefined,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  mocks.spawn.mockReturnValue(child);
  try {
    const h = f.runtime.spawn(f.value, f.signal, {
      launchDeadline: Date.now() + 1000,
      providerDeadline: Date.now() + 2000,
    });
    await expect(h.started).rejects.toThrow("runtime_observer_failed");
    await expect(h.completion).rejects.toThrow("runtime_observer_failed");
    child.emit("close", 1);
    expect(await h.stop()).toEqual({ immediateChildClosed: true });
    expect(mocks.spawn).toHaveBeenCalledOnce();
  } finally {
    f.runtime.dispose(f.value);
  }
});
