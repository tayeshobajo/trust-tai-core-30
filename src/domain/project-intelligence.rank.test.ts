/** Confirmation is what gives a statement authority in the context packet. */
import { describe, expect, it } from "vitest";
import { rankOf } from "@/domain/project-intelligence";

describe("knowledge authority", () => {
  it("promotes an imported statement once a person confirms it", () => {
    expect(rankOf("thinking_room", "confirmed")).toBeLessThan(
      rankOf("thinking_room", "needs_review"),
    );
    expect(rankOf("thinking_room", "confirmed")).toBe(rankOf("human", "confirmed"));
  });

  it("keeps roadmap above confirmed knowledge", () => {
    expect(rankOf("roadmap", "needs_review")).toBeLessThan(rankOf("human", "confirmed"));
  });

  it("leaves an unreviewed import where it was", () => {
    expect(rankOf("agent", "detected")).toBeGreaterThan(rankOf("human", "confirmed"));
  });
});
