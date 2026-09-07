import { describe, expect, it } from "vitest";

import {
  checkRoadmapLink,
  linkableRoadmaps,
  projectLinkedToRoadmap,
  roadmapLinkKey,
  type LinkableRoadmap,
} from "@/domain/project-roadmap-link";

const project = {
  id: "p1",
  organizationId: "org",
  clientId: "c1",
  origin: { kind: "manual" as const },
};

const roadmap: LinkableRoadmap = {
  id: "r1",
  organizationId: "org",
  clientId: "c1",
  subjectLabel: "Mental Dental",
};

describe("checkRoadmapLink", () => {
  it("records a link for a manual project on the same client", () => {
    expect(checkRoadmapLink(project, roadmap).ok).toBe(true);
  });

  it("refuses when the work came from a roadmap milestone", () => {
    const carried = { ...project, origin: { kind: "roadmap_milestone" as const, roadmapId: "r9" } };
    const check = checkRoadmapLink(carried, roadmap);
    expect(check.ok).toBe(false);
    expect(check.because).toContain("Roadmap truth");
  });

  it("refuses a roadmap belonging to another company", () => {
    expect(checkRoadmapLink(project, { ...roadmap, clientId: "c2" }).ok).toBe(false);
  });

  it("refuses a roadmap from another workspace", () => {
    expect(checkRoadmapLink(project, { ...roadmap, organizationId: "other" }).ok).toBe(false);
  });

  it("refuses relinking the same roadmap", () => {
    const linked = { ...project, origin: { kind: "manual" as const, roadmapId: "r1" } };
    expect(checkRoadmapLink(linked, roadmap).ok).toBe(false);
  });

  it("allows a client-less roadmap to be chosen by a person", () => {
    const { clientId: _drop, ...rest } = roadmap;
    expect(checkRoadmapLink(project, rest as LinkableRoadmap).ok).toBe(true);
  });
});

describe("linkableRoadmaps", () => {
  it("keeps only roadmaps a person may legitimately choose", () => {
    const list = linkableRoadmaps(project, [
      roadmap,
      { ...roadmap, id: "r2", clientId: "c2" },
      { ...roadmap, id: "r3", organizationId: "other" },
    ]);
    expect(list.map((entry) => entry.id)).toEqual(["r1"]);
  });

  it("never implies a single candidate is already linked", () => {
    const list = linkableRoadmaps(project, [roadmap]);
    expect(list).toHaveLength(1);
    expect(project.origin).not.toHaveProperty("roadmapId");
  });
});

describe("roadmapLinkKey", () => {
  it("is stable for the same pair", () => {
    expect(roadmapLinkKey("p1", "r1")).toBe(roadmapLinkKey("p1", "r1"));
    expect(roadmapLinkKey("p1", "r1")).not.toBe(roadmapLinkKey("p1", "r2"));
  });
});

describe("projectLinkedToRoadmap", () => {
  it("finds the project a person linked to the roadmap", () => {
    const linked = { id: "p2", origin: { kind: "manual" as const, roadmapId: "r1" } };
    expect(projectLinkedToRoadmap([project, linked], "r1")?.id).toBe("p2");
  });

  it("returns null when no canonical link exists", () => {
    expect(projectLinkedToRoadmap([project], "r1")).toBeNull();
    expect(projectLinkedToRoadmap([], "r1")).toBeNull();
  });

  it("never infers a link from a different roadmap id", () => {
    const linked = { id: "p2", origin: { kind: "manual" as const, roadmapId: "r2" } };
    expect(projectLinkedToRoadmap([linked], "r1")).toBeNull();
  });
});
