/**
 * The Project Chat boundary.
 *
 * Chat is how you talk to the project. Projects remains where project truth
 * lives, so these tests hold the line: the answer keeps what the record says
 * apart from what someone read into it, an empty question never reaches a
 * provider, unreadable output fails without implying a write, and nothing in
 * this module can touch a project service.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { answerProjectQuestion } from "./project-intelligence.server";

function caller(raw: string) {
  return vi.fn(async () => ({ raw, provider: "test", model: "test" }));
}

const INPUT = {
  projectLabel: "Mental Dental Academy",
  question: "Where is this stuck?",
  packet: { project: { name: "Mental Dental Academy" } },
};

describe("answerProjectQuestion", () => {
  it("keeps facts, interpretations, unknowns and next steps separate", async () => {
    const model = caller(
      JSON.stringify({
        answer: "Two work items are open.",
        facts: ["Two work items are open.", ""],
        interpretations: ["It looks close to review."],
        unknowns: ["Nobody recorded a due date."],
        next_steps: ["Record the next move in Projects."],
      }),
    );
    const result = await answerProjectQuestion(INPUT, model);
    expect(result.facts).toEqual(["Two work items are open."]);
    expect(result.interpretations).toEqual(["It looks close to review."]);
    expect(result.unknowns).toEqual(["Nobody recorded a due date."]);
    expect(result.nextSteps).toEqual(["Record the next move in Projects."]);
  });

  it("refuses a blank question without calling a provider", async () => {
    const model = caller("{}");
    await expect(answerProjectQuestion({ ...INPUT, question: "   " }, model)).rejects.toThrow(
      /question is required/i,
    );
    expect(model).not.toHaveBeenCalled();
  });

  it("fails on unreadable output and says nothing was changed", async () => {
    const model = caller("not json at all");
    await expect(answerProjectQuestion(INPUT, model)).rejects.toThrow(/Nothing was changed/);
  });

  it("passes the pasted turn context and never asks for web search", async () => {
    const model = caller(JSON.stringify({ answer: "ok" }));
    await answerProjectQuestion({ ...INPUT, pasted: "client email" }, model);
    const call = model.mock.calls[0]?.[0] as unknown as { input: string; webSearch?: boolean };
    expect(call.webSearch).toBe(false);
    expect(call.input).toContain("client email");
  });

  it("calls no project state service from Chat", () => {
    const source = readFileSync(
      new URL("./project-intelligence.server.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /projects-service|projectsService|supabaseAdmin|\.insert\(|\.update\(/,
    );
  });
});
