import { describe, expect, it } from "vitest";

import {
  PROJECT_SURFACES,
  isProjectSurface,
  sectionAnchor,
  surfaceForSection,
} from "./project-workroom-ia";

describe("project workroom IA", () => {
  it("offers exactly five top level surfaces", () => {
    expect(PROJECT_SURFACES.map((entry) => entry.value)).toEqual([
      "overview",
      "chat",
      "roadmap",
      "files",
      "activity",
    ]);
  });

  it("re-homes execution sections into Overview", () => {
    expect(surfaceForSection("work")).toBe("overview");
    expect(surfaceForSection("blockers")).toBe("overview");
    expect(surfaceForSection("decisions")).toBe("overview");
  });

  it("re-homes working material into Files", () => {
    expect(surfaceForSection("context")).toBe("files");
    expect(surfaceForSection("knowledge")).toBe("files");
    expect(surfaceForSection("assets")).toBe("files");
  });

  it("keeps surfaces mapped to themselves", () => {
    for (const entry of PROJECT_SURFACES) {
      expect(surfaceForSection(entry.value)).toBe(entry.value);
    }
  });

  it("names a stable anchor per section", () => {
    expect(sectionAnchor("blockers")).toBe("project-section-blockers");
  });

  it("recognises only real surfaces", () => {
    expect(isProjectSurface("files")).toBe(true);
    expect(isProjectSurface("work")).toBe(false);
    expect(isProjectSurface(null)).toBe(false);
  });
});
