import { describe, expect, it } from "vitest";

import { coverageForDraft, extractAsks } from "./comms-coverage";

const SOURCE = [
  "Morning. Before we confirm the launch date I need four things settled.",
  "First, what exactly is included in the launch scope?",
  "Second, who owns content updates after go live, us or you?",
  "Please send the updated pricing table before Thursday.",
  `${"We have been reviewing the plan in detail. ".repeat(30)}`,
  "Does the annual figure include the support retainer?",
].join(" ");

describe("extractAsks", () => {
  it("finds every question and actionable request, with its position", () => {
    const asks = extractAsks(SOURCE, "Their message");
    const texts = asks.map((ask) => ask.text);
    expect(texts.some((text) => text.includes("included in the launch scope"))).toBe(true);
    expect(texts.some((text) => text.includes("who owns content updates"))).toBe(true);
    expect(texts.some((text) => text.includes("send the updated pricing table"))).toBe(true);
    expect(asks.filter((ask) => ask.kind === "request")).toHaveLength(1);
  });

  it("counts a question buried past character 900", () => {
    const asks = extractAsks(SOURCE, "Their message");
    const late = asks.find((ask) => ask.text.includes("support retainer"));
    expect(late).toBeDefined();
    expect(late!.offset).toBeGreaterThan(900);
  });

  it("invents nothing when nothing was asked", () => {
    expect(extractAsks("Thanks for the handover session. It went well.")).toEqual([]);
  });
});

describe("coverageForDraft", () => {
  const asks = extractAsks(SOURCE, "Their message");

  it("names a missing answer instead of assuming the draft covered it", () => {
    const report = coverageForDraft(
      asks,
      "The launch scope covers the new site and the booking form. Trust,\nSam",
    );
    const ownership = report.asks.find((ask) => ask.text.includes("who owns content updates"));
    expect(ownership!.status).toBe("missing");
    expect(report.complete).toBe(false);
    expect(report.outstanding).toBeGreaterThan(0);
  });

  it("reads a promised answer as pending, which keeps the question open", () => {
    const report = coverageForDraft(
      asks,
      "On the annual figure and the support retainer, I will confirm with finance today.",
    );
    const retainer = report.asks.find((ask) => ask.text.includes("support retainer"));
    expect(retainer!.status).toBe("pending_confirmation");
    expect(report.complete).toBe(false);
  });

  it("says it is deterministic, never that a model read anything", () => {
    expect(coverageForDraft(asks, "anything").method).toBe("deterministic");
  });
});
