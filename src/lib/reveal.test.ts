import { describe, expect, it } from "vitest";

import { firstFocusable, needsScroll, prefersReducedMotion, revealBehavior } from "@/lib/reveal";

describe("revealBehavior", () => {
  it("scrolls smoothly by default and instantly under reduced motion", () => {
    expect(revealBehavior(false)).toBe("smooth");
    expect(revealBehavior(true)).toBe("auto");
  });
});

describe("prefersReducedMotion", () => {
  it("reads the media query when one is available", () => {
    const win = { matchMedia: () => ({ matches: true }) } as unknown as Window;
    expect(prefersReducedMotion(win)).toBe(true);
  });

  it("stays false when the query throws or is missing", () => {
    const broken = {
      matchMedia: () => {
        throw new Error("no");
      },
    } as unknown as Window;
    expect(prefersReducedMotion(broken)).toBe(false);
  });
});

describe("needsScroll", () => {
  const viewport = 800;

  it("leaves a panel already comfortably on screen alone", () => {
    expect(needsScroll({ top: 200, bottom: 500 }, viewport)).toBe(false);
  });

  it("scrolls when the panel sits above the comfortable margin", () => {
    expect(needsScroll({ top: 10, bottom: 300 }, viewport)).toBe(true);
  });

  it("scrolls when the panel runs past the bottom margin", () => {
    expect(needsScroll({ top: 600, bottom: 780 }, viewport)).toBe(true);
  });

  it("does nothing without a measurable viewport", () => {
    expect(needsScroll({ top: 0, bottom: 0 }, 0)).toBe(false);
  });
});

describe("firstFocusable", () => {
  it("returns nothing when the panel has no fields", () => {
    expect(firstFocusable({ querySelector: () => null })).toBeNull();
  });

  it("ignores a match that is not an element we can focus", () => {
    expect(firstFocusable({ querySelector: () => ({}) as Element })).toBeNull();
  });
});
