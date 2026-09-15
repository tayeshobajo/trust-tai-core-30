/**
 * The Responses API refuses `json_object` output unless the word "json" is in
 * the input messages — the instructions do not count. Room packets are data,
 * so the word is usually absent and the call is rejected before any reasoning
 * happens. These checks hold the framing in place.
 */

import { describe, expect, it } from "vitest";

import { inputForJsonObjectFormat } from "./roadmap-research.server";

describe("json_object input framing", () => {
  it("frames a packet that never happens to say json", () => {
    const packet = JSON.stringify({ draft: "The training is on Tuesday." });
    const framed = inputForJsonObjectFormat(packet);

    expect(framed.toLowerCase()).toContain("json");
    // The packet itself is untouched; only a line of framing is added.
    expect(framed.endsWith(packet)).toBe(true);
  });

  it("leaves a packet that already says json exactly as it is", () => {
    const packet = JSON.stringify({ note: "Return JSON to the client." });
    expect(inputForJsonObjectFormat(packet)).toBe(packet);
  });
});

describe("what the provider actually receives", () => {
  it("frames a real review-shaped packet, so json_object is not refused", async () => {
    const original = globalThis.fetch;
    let sent: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(
        'data: {"type":"response.output_text.delta","delta":"{\\"ok\\":true}"}\n\n',
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    }) as unknown as typeof fetch;
    process.env["OPENAI_API_KEY"] ||= "test-key-not-used";

    try {
      const { callRoadmapProvider } = await import("./roadmap-research.server");
      // A packet like the review's: data only, no occurrence of the word.
      const packet = JSON.stringify({
        draft: "The training is on Tuesday.",
        obligations: [{ id: "q2", question: "Who sends the handover guide?" }],
      });
      await callRoadmapProvider("Return strict JSON only.", packet, { webSearch: false });
    } finally {
      globalThis.fetch = original;
    }

    expect(sent["text"]).toEqual({ format: { type: "json_object" } });
    expect(String(sent["input"]).toLowerCase()).toContain("json");
  });
});
