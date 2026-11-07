import { describe, it, expect } from "vitest";
import { validateCapturedOutput } from "./studio-research-output.server";
import { extractSource } from "./studio-research-public-source.server";
import type { ManualResearchTicket } from "./studio-research-manual-test.server";
function fixture() {
  const ticket: ManualResearchTicket = {
    request: {
      requestId: "22222222-2222-4222-8222-222222222222",
      organizationId: "11111111-1111-4111-8111-111111111111",
      topic: "Public research",
    },
    approvedUrls: ["https://example.org/article"],
    approvedAt: 1000,
    expiresAt: 10000,
    companyId: "aaa4eceb-44fb-4492-823c-65d3d90c5519",
    projectId: "d5160872-5d1c-41fb-b793-9ad7e4469f86",
    agentId: "5cbc9418-0ff9-4f1c-a807-c0632e26a538",
  };
  const expected = {
    issueId: "33333333-3333-4333-8333-333333333333",
    runId: "44444444-4444-4444-8444-444444444444",
    sessionId: "ses_fixture",
  };
  const result = {
    version: 1,
    requestId: ticket.request.requestId,
    topics: [],
    limitations: ["Insufficient supplied evidence."],
  };
  const events = [
    { type: "step_start", sessionID: expected.sessionId },
    { type: "text", sessionID: expected.sessionId, part: { text: JSON.stringify(result) } },
    { type: "step_finish", sessionID: expected.sessionId, part: { reason: "stop" } },
  ];
  return {
    ticket,
    evidence: [extractSource("Public text", "text/plain", ticket.approvedUrls[0]!, 2000)],
    expected,
    receipt: {
      ...expected,
      requestId: ticket.request.requestId,
      agentId: ticket.agentId,
      projectId: ticket.projectId,
      exitCode: 0,
      timedOut: false,
      attempts: 1,
    },
    stdout: events.map((e) => JSON.stringify(e)).join("\n"),
    events,
    result,
  };
}
describe("coordinator-captured output boundary", () => {
  it("accepts one bounded completed result for the exact trusted receipt", () => {
    const f = fixture();
    expect(validateCapturedOutput(f)).toEqual(f.result);
  });
  it.each([
    { attempts: 2 },
    { exitCode: 1 },
    { timedOut: true },
    { sessionId: "other" },
    { runId: "55555555-5555-4555-8555-555555555555" },
    { requestId: "55555555-5555-4555-8555-555555555555" },
  ])("rejects altered receipt %j", (change) => {
    const f = fixture();
    Object.assign(f.receipt, change);
    expect(() => validateCapturedOutput(f)).toThrow(/^captured_result_invalid$/);
  });
  it.each(["tool_use", "error", "reasoning", "unknown"])(
    "rejects %s events without leaking content",
    (type) => {
      const f = fixture();
      f.events[1]!.type = type;
      f.stdout = f.events.map((e) => JSON.stringify(e)).join("\n");
      expect(() => validateCapturedOutput(f)).toThrow(/^captured_result_invalid$/);
    },
  );
  it("rejects mixed sessions", () => {
    const f = fixture();
    f.events[1]!.sessionID = "foreign";
    f.stdout = f.events.map((e) => JSON.stringify(e)).join("\n");
    expect(() => validateCapturedOutput(f)).toThrow();
  });
  it("rejects partial, oversized and multiple results", () => {
    for (const transform of [
      (s: string) => s.split("\n").slice(0, 2).join("\n"),
      (s: string) => s + "\n" + s,
      () => "x".repeat(100001),
    ]) {
      const f = fixture();
      f.stdout = transform(f.stdout);
      expect(() => validateCapturedOutput(f)).toThrow();
    }
  });
});

it("native mapping preserves IDs and supports reasoning plus text chunks without accepting tools", () => {
  const f = fixture();
  const result = JSON.stringify(f.result);
  const receipt = {
    ...f.receipt,
    nativeSession: { version: 1, id: "native", bindingDigest: "a".repeat(64) },
  };
  const events = [
    { type: "step_start", sessionID: "native" },
    { type: "reasoning", sessionID: "native", part: { text: "ignored" } },
    { type: "text", sessionID: "native", part: { text: result.slice(0, 20) } },
    { type: "text", sessionID: "native", part: { text: result.slice(20) } },
    { type: "step_finish", sessionID: "native", part: { reason: "stop" } },
  ];
  expect(
    validateCapturedOutput({
      ...f,
      receipt,
      stdout: events.map((e) => JSON.stringify(e)).join("\n"),
    }),
  ).toEqual(f.result);
  events[1]!.type = "tool_use";
  expect(() =>
    validateCapturedOutput({
      ...f,
      receipt,
      stdout: events.map((e) => JSON.stringify(e)).join("\n"),
    }),
  ).toThrow();
});
