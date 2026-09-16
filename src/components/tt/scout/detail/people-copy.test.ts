import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * How an answer is held between a lookup and a save is ours to know. The People
 * card states whether a result can be saved, and never how the machinery works.
 * This guards the copy itself, so the wording cannot creep back in.
 */
const CARD = readFileSync("src/components/tt/scout/detail/people-section.tsx", "utf8");

const FORBIDDEN = [
  "server restart",
  "restart",
  "30 minutes",
  "expires",
  "receipt",
  "cache",
  "in memory",
  "process memory",
  "TTL",
];

describe("People card copy", () => {
  it("never explains the holding mechanism to the person reading it", () => {
    // Only the words shown on screen are judged, not identifiers in code.
    const shown = [...CARD.matchAll(/"([^"\n]{12,})"|>([^<>{}\n]{12,})</g)]
      .map((match) => (match[1] ?? match[2] ?? "").trim())
      .filter((text) => /[a-z] [a-z]/.test(text) && !text.includes("/"));
    for (const phrase of FORBIDDEN) {
      const offender = shown.find((text) => text.toLowerCase().includes(phrase.toLowerCase()));
      expect(offender, `copy mentions "${phrase}"`).toBeUndefined();
    }
  });

  it("states the two save outcomes in plain words", () => {
    expect(CARD).toContain("Email found, but Scout could not save it yet.");
    expect(CARD).toContain("This result can't be saved anymore. Refresh the email when you're ready.");
    expect(CARD).toContain("Try saving again");
  });

  it("says a title is unavailable rather than not recorded", () => {
    expect(CARD).toContain("Title unavailable");
    expect(CARD).not.toContain("Title not recorded");
  });
});
