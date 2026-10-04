import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildStewardTasks } from "@/data/steward/accountability";
import { TaskContext, taskContextHref } from "./task-context";

function task() {
  return buildStewardTasks({
    now: "2026-10-04T00:00:00Z",
    commitments: [],
    workItems: [],
    projects: [],
    agents: [],
    taskState: [],
    manualTasks: [
      {
        id: "test",
        organizationId: "test-org",
        title: "Synthetic task",
        ownerUserId: "owner",
        ownerLabel: "Test owner",
        priority: "normal",
        assigneeKind: "human",
        status: "blocked",
        subtasks: [
          { id: "done", text: "Already checked", done: true },
          { id: "next", text: "Run isolated verification", done: false },
        ],
        acceptanceCriteria: ["Result survives refresh"],
        notes: "Awaiting test access",
        contextLinks: [
          { label: "Dependency", url: "https://example.com/dependency", kind: "dependency" },
          { label: "Source", url: "https://example.com/source" },
        ],
        createdAt: "2026-10-03T00:00:00Z",
        updatedAt: "2026-10-04T00:00:00Z",
      },
    ],
  })[0]!;
}

describe("recorded task context", () => {
  it("preserves canonical fields and selects the first remaining recorded action", () => {
    const row = task();
    expect(row.manualDetail?.notes).toBe("Awaiting test access");
    expect(row.updatedAt).toBe("2026-10-04T00:00:00Z");
    const html = renderToStaticMarkup(<TaskContext task={row} viewerUserId="owner" />);
    expect(html).toContain("Run isolated verification");
    expect(html).not.toContain("Already checked");
    expect(html).toContain("https://example.com/dependency");
    expect(html).toContain("Planned acceptance criteria");
    expect(html).toContain("not a checked completion receipt");
  });
  it("does not expose additional context to another person or an absent identity", () => {
    for (const viewerUserId of ["someone-else", ""]) {
      expect(renderToStaticMarkup(<TaskContext task={task()} viewerUserId={viewerUserId} />)).toBe(
        "",
      );
    }
  });
  it("does not invent missing next actions or dependencies", () => {
    const row = task();
    row.manualDetail = { subtasks: [], acceptanceCriteria: [], contextLinks: [] };
    const html = renderToStaticMarkup(<TaskContext task={row} viewerUserId="owner" />);
    expect(html).toContain("No next action recorded");
    expect(html).toContain("No dependency recorded");
  });
  it("rejects active and malformed link protocols", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,test",
      "file:///tmp/test",
      "//example.com",
      "bad",
    ])
      expect(taskContextHref(url)).toBeUndefined();
    expect(taskContextHref("https://example.com/receipt")).toBe("https://example.com/receipt");
  });
});
