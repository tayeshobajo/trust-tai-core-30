import { describe, it, expect, vi } from "vitest";
import { callCodingPlanProtocol } from "./studio-research-coding-protocol.server";
const input = {
  prompt: "Synthetic offline request",
  maxInputBytes: 1000,
  maxOutputTokens: 100,
  timeoutMs: 1000,
};
const reply = {
  model: "glm-5.3",
  choices: [{ finish_reason: "stop", message: { role: "assistant", content: '{"research":{}}' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};
describe("offline Coding Plan wire protocol", () => {
  it("uses exactly one fixed Coding Plan endpoint/model request with token parameter and no environment lookup", async () => {
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe("https://api.z.ai/api/coding/paas/v4/chat/completions");
      expect(init!.redirect).toBe("manual");
      expect(JSON.parse(String(init!.body))).toEqual({
        model: "glm-5.3",
        stream: false,
        max_tokens: 100,
        tool_choice: "none",
        messages: [{ role: "user", content: input.prompt }],
      });
      return Response.json(reply);
    });
    expect(
      (await callCodingPlanProtocol(input, { credential: "synthetic-only", transport }))
        .observedHttpRequests,
    ).toBe(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([301, 307, 401, 429, 500])("never follows or retries HTTP %s", async (status) => {
    const transport = vi.fn<typeof fetch>(
      async () =>
        new Response(null, { status, headers: { Location: "https://example.org/forbidden" } }),
    );
    await expect(
      callCodingPlanProtocol(input, { credential: "synthetic", transport }),
    ).rejects.toThrow("coding_outcome_uncertain");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects tool calls, multiple choices, wrong model, truncation and over-budget reported tokens", async () => {
    for (const patch of [
      { model: "other" },
      { choices: [...reply.choices, ...reply.choices] },
      { choices: [{ finish_reason: "length", message: reply.choices[0]!.message }] },
      {
        choices: [
          {
            finish_reason: "stop",
            message: { ...reply.choices[0]!.message, tool_calls: [{ name: "shell" }] },
          },
        ],
      },
      { usage: { prompt_tokens: 10, completion_tokens: 101, total_tokens: 111 } },
    ])
      await expect(
        callCodingPlanProtocol(input, {
          credential: "synthetic",
          transport: async () => Response.json({ ...reply, ...patch }),
        }),
      ).rejects.toThrow();
  });
  it("enforces input byte cap before any transport call", async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(
      callCodingPlanProtocol(
        { ...input, maxInputBytes: 1 },
        { credential: "synthetic", transport },
      ),
    ).rejects.toThrow("coding_request_invalid");
    expect(transport).not.toHaveBeenCalled();
  });
  it("aborts deadline and treats hung transport as uncertain without retry", async () => {
    let signal: AbortSignal | undefined;
    const transport = vi.fn<typeof fetch>(async (_u, init) => {
      signal = init!.signal as AbortSignal;
      return new Promise(() => {});
    });
    await expect(
      callCodingPlanProtocol({ ...input, timeoutMs: 10 }, { credential: "synthetic", transport }),
    ).rejects.toThrow("coding_outcome_uncertain");
    expect(signal!.aborted).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects pre-cancelled call before transmission", async () => {
    const transport = vi.fn<typeof fetch>(),
      c = new AbortController();
    c.abort();
    await expect(
      callCodingPlanProtocol(input, { credential: "synthetic", transport, signal: c.signal }),
    ).rejects.toThrow("coding_request_cancelled");
    expect(transport).not.toHaveBeenCalled();
  });
  it("cancellation interrupts an unresponsive intercepted transport without retry", async () => {
    const c = new AbortController();
    let started!: (v: void) => void;
    const waiting = new Promise<void>((r) => (started = r));
    const transport = vi.fn<typeof fetch>(async () => {
      started();
      return new Promise(() => {});
    });
    const result = callCodingPlanProtocol(input, {
      credential: "synthetic",
      transport,
      signal: c.signal,
    });
    await waiting;
    c.abort();
    await expect(result).rejects.toThrow("coding_outcome_uncertain");
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
