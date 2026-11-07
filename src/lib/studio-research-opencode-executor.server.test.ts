import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import {
  prepareOpenCode,
  parseOpenCodeEvents,
  startOpenCode,
  startInertOpenCodeFixture,
  openCodeIsolationStatus,
} from "./studio-research-opencode-executor.server";
import { COORDINATOR } from "./studio-research-coordinator-contracts";
import type { ExecutionInput } from "./studio-research-coordinator.server";
function input(): ExecutionInput {
  return {
    requestId: randomUUID(),
    issueId: randomUUID(),
    runId: randomUUID(),
    sessionId: `ses_${randomUUID()}`,
    nonce: randomUUID(),
    prompt: "Synthetic inert public text",
    launchDeadline: Date.now() + 5000,
    completionDeadline: Date.now() + 60000,
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
it("builds fixed genuine CLI argv and private allowlisted configuration without inherited secrets", () => {
  const p = prepareOpenCode(input(), "synthetic-test", 43123);
  try {
    expect(p.argv.slice(0, 5)).toEqual(["run", "--format", "json", "--model", COORDINATOR.model]);
    expect(p.argv).not.toContain("--session");
    expect(p.argv).not.toContain("--continue");
    expect(p.argv).not.toContain("--auto");
    expect(p.env).not.toHaveProperty("ZAI_API_KEY");
    const c = JSON.parse(readFileSync(p.env.OPENCODE_CONFIG, "utf8"));
    expect(c.permission).toEqual({ "*": "deny" });
    expect(c.small_model).toBe(COORDINATOR.model);
    expect(c.provider["zai-coding-plan"].options.baseURL).toBe("http://127.0.0.1:43123/v1");
    expect(c.compaction.auto).toBe(false);
  } finally {
    p.cleanup();
  }
  expect(existsSync(p.cwd)).toBe(false);
});
it("rejects live credentials and invalid deadlines before preparation", () => {
  expect(() => prepareOpenCode(input(), "real-key", 43123)).toThrow("offline_fixture_required");
  expect(() =>
    prepareOpenCode({ ...input(), launchDeadline: 0 }, "synthetic-test", 43123),
  ).toThrow();
});
it("real CLI launch fails closed without retrying any OS preflight", () => {
  expect(openCodeIsolationStatus().available).toBe(false);
  expect(() => startOpenCode(input(), "synthetic-test", 43123)).toThrow();
});
it.each(["tool_use", "error", "session.created"])(
  "rejects unexpected genuine CLI event %s",
  (type) => {
    expect(() => parseOpenCodeEvents(JSON.stringify({ type, sessionID: "s" }), "digest")).toThrow();
  },
);
it("rejects changed session and multiple completion steps", () => {
  const e = (s: string) =>
    JSON.stringify({ type: "step_finish", sessionID: s, part: { reason: "stop" } });
  expect(() => parseOpenCodeEvents(e("a") + "\n" + e("b"), "d")).toThrow();
  expect(() => parseOpenCodeEvents(e("a") + "\n" + e("a"), "d")).toThrow();
});
it("inert real process closes before success, never asserts provider request count", async () => {
  const h = startInertOpenCodeFixture("success");
  const r = await h.completion;
  expect(r.immediateChildClosed).toBe(true);
  expect(r.providerRequests).toBeNull();
  expect(await h.stop()).toBe(true);
});
it.each(["hang", "oversize"] as const)(
  "bounds inert real child %s and acknowledges closure",
  async (mode) => {
    const h = startInertOpenCodeFixture(mode, 100);
    await expect(h.completion).rejects.toThrow();
    expect(await h.stop()).toBe(true);
  },
);
it("cancels a pending inert child and waits for close", async () => {
  const h = startInertOpenCodeFixture("hang");
  expect(await h.stop()).toBe(true);
  await expect(h.completion).rejects.toThrow();
});

it("settles cleanup failure without losing process-stop acknowledgement", async () => {
  const h = startInertOpenCodeFixture("cleanup-error");
  await expect(h.completion).rejects.toThrow("process_unconfirmed");
  expect(await h.stop()).toBe(true);
});
it("rejects text after terminal completion and duplicate starts", () => {
  const event = (type: string) =>
    JSON.stringify({ type, sessionID: "ses-fixture", part: { reason: "stop", text: "x" } });
  expect(() =>
    parseOpenCodeEvents(["step_start", "text", "step_finish", "text"].map(event).join("\n"), "d"),
  ).toThrow("event_after_completion");
  expect(() =>
    parseOpenCodeEvents(["step_start", "step_start"].map(event).join("\n"), "d"),
  ).toThrow("step_order_invalid");
});

it("event parsing alone cannot attest process closure or job accounting", () => {
  const events = [
    { type: "step_start", sessionID: "s" },
    { type: "text", sessionID: "s", part: { text: "{}" } },
    { type: "step_finish", sessionID: "s", part: { reason: "stop" } },
  ]
    .map((x) => JSON.stringify(x))
    .join("\n");
  const parsed = parseOpenCodeEvents(events, "binding");
  expect(parsed).not.toHaveProperty("immediateChildClosed");
  expect(parsed).not.toHaveProperty("accounting");
  expect(parsed.providerRequests).toBeNull();
});
