import { describe, expect, it } from "vitest";

import { classifyAgentTask, safeAgentArtifact } from "./steward-agent-execution";

describe("bounded Steward agent policy", () => {
  it.each(["Send the email", "Approve pricing", "Publish the article", "Change scope"])(
    "stops high-risk work: %s",
    (title) => {
      expect(classifyAgentTask({ title, contextLinks: [{ label: "Brief", url: "https://example.com" }] })).toMatchObject({ risk: "high", executable: false });
    },
  );

  it("does not guess when no context was supplied", () => {
    expect(classifyAgentTask({ title: "Draft a summary", contextLinks: [] })).toMatchObject({ executable: false });
  });

  it("allows evidence-backed internal preparation", () => {
    expect(classifyAgentTask({ title: "Summarise the research", contextLinks: [{ label: "Research", url: "https://example.com/research" }] })).toMatchObject({ risk: "low", executable: true });
  });

  it("accepts only artifacts with evidence", () => {
    expect(safeAgentArtifact({ artifact: "Summary", evidence_refs: ["context:1"] })).toEqual({ artifact: "Summary", evidenceRefs: ["context:1"] });
    expect(safeAgentArtifact({ artifact: "Unsupported", evidence_refs: [] })).toBeNull();
  });
});