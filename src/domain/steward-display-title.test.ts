import { describe, expect, it } from "vitest";

import { displayTitleOf } from "./steward-display-title";

describe("display title normalization", () => {
  it("shows the distinguishing tail of a prefixed title and preserves the full text", () => {
    expect(displayTitleOf("Soji — Artist website mockup")).toEqual({
      display: "Artist website mockup",
      full: "Soji — Artist website mockup",
      shortened: true,
    });
    expect(displayTitleOf("Mental Dental – Phased artist-growth roadmap").display).toBe(
      "Phased artist-growth roadmap",
    );
  });

  it("leaves unprefixed and ambiguous titles whole", () => {
    expect(displayTitleOf("Phased artist-growth roadmap").shortened).toBe(false);
    expect(displayTitleOf("Artist website mockup vs phased roadmap").display).toBe(
      "Artist website mockup vs phased roadmap",
    );
    /* A trivially short tail distinguishes nothing. */
    expect(displayTitleOf("Roadmap — Q3").shortened).toBe(true);
    expect(displayTitleOf("Roadmap — go").shortened).toBe(false);
  });

  it("never invents text: the display is always a substring of the stored title", () => {
    for (const title of [
      "Soji — Artist website mockup",
      "No separator here",
      "A — B — C",
      "  padded  ",
    ]) {
      const result = displayTitleOf(title);
      expect(title).toContain(result.display);
      expect(result.full).toBe(title);
    }
  });
});
