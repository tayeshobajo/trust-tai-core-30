import { describe, expect, it } from "vitest";

import {
  EMPTY_PROJECT_FILTERS,
  buildProjectRows,
  companyOptions,
  filterProjectRows,
  groupByCompany,
  inTab,
  milestoneOptions,
  needsAttention,
  projectsGlance,
  type LineageSources,
} from "./index-projection";
import type { ExecutionProject, ExecutionState } from "@/domain/projects";

const NOW = new Date("2026-08-17T00:00:00.000Z");

function project(
  id: string,
  state: ExecutionState,
  overrides: Partial<ExecutionProject> = {},
): ExecutionProject {
  return {
    id,
    organizationId: "o1",
    name: `Project ${id}`,
    state,
    pointA: "Nothing yet.",
    pointB: "A working intake.",
    ownerLabel: "Tai",
    evidence: [],
    dependencies: [],
    origin: { kind: "manual" },
    lastMovedAt: NOW.toISOString(),
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  } as ExecutionProject;
}

const SOURCES: LineageSources = {
  milestones: { m1: { ordinal: "01", name: "Intake rebuild", roadmapId: "r1" } },
  roadmapCompany: { r1: "Northlight Systems" },
  clientCompany: {},
};

const PROJECTS = [
  project("a", "in_flight", {
    nextMove: "Ship the intake form",
    origin: { kind: "roadmap_milestone", roadmapId: "r1", milestoneId: "m1" },
  }),
  project("b", "blocked", {
    blockedBecause: "Waiting on access",
    blockedSince: "2026-08-10T00:00:00.000Z",
    origin: { kind: "roadmap_milestone", roadmapId: "r1", milestoneId: "m1" },
  }),
  project("c", "delivered", { ownerLabel: "Mara" }),
];

describe("projects index projection", () => {
  const rows = buildProjectRows(PROJECTS, SOURCES, NOW);

  it("holds the empty state when nothing is in delivery", () => {
    expect(buildProjectRows([], SOURCES, NOW)).toHaveLength(0);
    expect(projectsGlance([]).active).toBe(0);
    expect(groupByCompany([])).toHaveLength(0);
  });

  it("counts what is moving, blocked and complete", () => {
    const glance = projectsGlance(rows);
    expect(glance.active).toBe(2);
    expect(glance.blocked).toBe(1);
  });

  it("keeps lineage attached to roadmap-born work", () => {
    const row = rows.find((entry) => entry.project.id === "a");
    expect(row?.lineage.company).toBe("Northlight Systems");
    expect(row?.lineage.fromRoadmap).toBe(true);
    expect(milestoneOptions(rows)).toContain("Intake rebuild");
  });

  it("groups projects under the company they serve", () => {
    const groups = groupByCompany(rows);
    const northlight = groups.find((group) => group.company === "Northlight Systems");
    expect(northlight?.rows).toHaveLength(2);
    expect(northlight?.active).toBe(2);
    expect(groups[0]?.company).toBe("Northlight Systems");
  });

  it("splits tabs without losing rows", () => {
    expect(rows.filter((row) => inTab(row, "all"))).toHaveLength(3);
    expect(rows.filter((row) => inTab(row, "completed"))).toHaveLength(1);
    expect(rows.filter((row) => inTab(row, "in_progress")).map((row) => row.project.id)).toEqual([
      "a",
    ]);
  });

  it("calls in-flight work with no next move waiting", () => {
    const [waiting] = buildProjectRows([project("d", "in_flight")], SOURCES, NOW);
    expect(waiting?.status).toBe("waiting");
    expect(inTab(waiting!, "waiting")).toBe(true);
  });

  it("surfaces a blocked project as needing attention", () => {
    expect(needsAttention(rows).some((row) => row.project.id === "b")).toBe(true);
  });

  it("returns nothing when a search matches nothing, and everything when cleared", () => {
    expect(
      filterProjectRows(rows, { ...EMPTY_PROJECT_FILTERS, query: "no such project" }),
    ).toHaveLength(0);
    expect(filterProjectRows(rows, EMPTY_PROJECT_FILTERS)).toHaveLength(3);
  });

  it("filters by company and owner", () => {
    expect(companyOptions(rows)).toContain("Northlight Systems");
    expect(
      filterProjectRows(rows, { ...EMPTY_PROJECT_FILTERS, company: "Northlight Systems" }),
    ).toHaveLength(2);
    expect(filterProjectRows(rows, { ...EMPTY_PROJECT_FILTERS, owner: "Mara" })).toHaveLength(1);
  });
});
