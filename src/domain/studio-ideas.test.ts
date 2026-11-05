import { describe, expect, it } from "vitest";
import { ideaBrief, isStudioIdea } from "./studio-ideas";
import { decideBriefPersistence } from "@/data/supabase/studio-brief-service";

describe("Studio ideas use the existing brief store", () => {
  it("creates an unsaved manual draft without authorizing generation or publishing", () => {
    const idea = ideaBrief(
      "org-a",
      "  A useful thought\nA little more context.  ",
      undefined,
      "Video idea",
    );
    expect(idea.id).toBe("");
    expect(idea.state).toBe("draft");
    expect(idea.approvedBy).toBeUndefined();
    expect(idea.coreIdea).toBe("A useful thought\nA little more context.");
    expect(idea.angle).toBe("Video idea");
    expect(idea.sourceOpportunityId).toBeNull();
    expect(isStudioIdea(idea)).toBe(true);
    expect(decideBriefPersistence(idea).operation).toBe("insert");
  });
  it("updates the same saved record instead of creating another idea", () => {
    const existing = { ...ideaBrief("org-a", "First thought"), id: "brief-1" };
    const edited = ideaBrief("org-a", "Edited thought", existing);
    expect(edited.id).toBe(existing.id);
    expect(decideBriefPersistence(edited).operation).toBe("update");
    expect(existing.coreIdea).toBe("First thought");
  });
  it("rejects a different organization or a non-Ideas brief", () => {
    const idea = ideaBrief("org-a", "Thought");
    expect(() => ideaBrief("org-b", "Edited", idea)).toThrow();
    expect(() =>
      ideaBrief("org-a", "Edited", { ...idea, sourceOpportunityId: "observed-opportunity" }),
    ).toThrow();
  });
  it("refuses blank and oversized ideas", () => {
    expect(() => ideaBrief("org-a", "  ")).toThrow();
    expect(() => ideaBrief("org-a", "x".repeat(12001))).toThrow();
  });
});
