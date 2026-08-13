/**
 * A research pass uses web search, and a searching run cannot also be pinned to
 * json response format upstream. The reply therefore arrives as text, sometimes
 * fenced or trailed by a citation line, and it still has to be read safely.
 */

import { describe, expect, it } from "vitest";

import { extractJsonObject } from "./roadmap-research.server";
import { normalizeStrategy } from "@/data/roadmap-research-parse";

const PROVENANCE = {
  provider: "openai",
  model: "gpt-5-mini",
  checkedAt: "2026-01-05T00:00:00.000Z",
};

describe("extractJsonObject", () => {
  it("reads a plain object", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("reads a fenced object", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("reads an object followed by a citation line", () => {
    expect(extractJsonObject('{"a":{"b":"}"}}\n\nSources: https://acme.com')).toEqual({
      a: { b: "}" },
    });
  });

  it("refuses text with no object rather than guessing", () => {
    expect(() => extractJsonObject("no json here")).toThrow();
  });
});

describe("horizon tier", () => {
  it("never marks a future band Observed, however well sourced", () => {
    const strategy = normalizeStrategy(
      {
        horizon: [
          {
            years: 2,
            statement: "Buyers consolidate onto integrated platforms.",
            sources: [{ label: "Report", url: "https://example.com/r", checked_at: "2026-01-05" }],
          },
        ],
      },
      PROVENANCE,
    );
    expect(strategy.horizon[0]?.tier).toBe("inferred");
    expect(strategy.horizon[0]?.sources).toHaveLength(1);
  });
});
