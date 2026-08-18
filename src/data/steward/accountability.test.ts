import { describe, expect, it } from "vitest";

import {
  applyTeamFilter,
  buildStewardTasks,
  glanceOf,
  personRead,
} from "./accountability";
import type { Commitment } from "@/domain/steward";
import type { StewardAgent } from "@/domain/steward-accountability";

const NOW = "2026-08-18T09:00:00.000Z";

function commitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: "c1",
    organizationId: "org",
    conversationId: "conv1",
    ownerName: "Ada Palmer",
    ownerEmail: "ada@trusttai.com",
    what: "Send the onboarding pack",
    status: "open",
    sourceKey: "conv1:1",
    evidence: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Commitment;
}

const agent: StewardAgent = {
  id: "a1",
  paperclipAgentId: "pc1",
  name: "Scout Runner",
  responsibility: "Sourcing research",
  owningApp: "scout",
  lifecycle: "working",
  capabilities: ["Research prospect websites"],
  cannotDo: ["Cannot contact a client"],
  currentWork: "Research Northlight",
  activeTasks: [{ id: "i1", title: "Research Northlight", status: "in_progress" }],
  awaitingApproval: [],
  completedThisWeek: 2,
  lastHeartbeatAt: null,
  recentOutcome: null,
};

const base = { now: NOW, workItems: [], projects: [], agents: [], taskState: [] };

describe("Steward accountability projection", () => {
  it("lets Steward complete a meeting-only commitment", () => {
    const [task] = buildStewardTasks({ ...base, commitments: [commitment()] });
    expect(task?.completionPath).toBe("steward");
  });

  it("routes a promoted commitment to Projects for completion", () => {
    const [task] = buildStewardTasks({
      ...base,
      commitments: [commitment({ projectId: "p1" })],
    });
    expect(task?.completionPath).toBe("projects");
    expect(task?.completionBecause).toMatch(/Projects/);
  });

  it("never lets Steward complete agent work", () => {
    const tasks = buildStewardTasks({ ...base, commitments: [], agents: [agent] });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.completionPath).toBe("paperclip");
    expect(tasks[0]?.owner.kind).toBe("agent");
  });

  it("marks a past due promise overdue and says why", () => {
    const [task] = buildStewardTasks({
      ...base,
      commitments: [commitment({ dueAt: "2026-08-10T09:00:00.000Z" })],
    });
    expect(task?.overdue).toBe(true);
    expect(task?.why).toMatch(/Past its date/);
    expect(task?.focus).toBe("do_now");
  });

  it("treats a nameless owner as unowned", () => {
    const [task] = buildStewardTasks({
      ...base,
      commitments: [commitment({ ownerName: "", ownerEmail: undefined })],
    });
    expect(task?.owner.kind).toBe("unowned");
    expect(applyTeamFilter([task!], "no_owner")).toHaveLength(1);
  });

  it("counts only real open rows in the glance", () => {
    const tasks = buildStewardTasks({
      ...base,
      commitments: [commitment(), commitment({ id: "c2", status: "kept", sourceKey: "conv1:2" })],
      agents: [agent],
    });
    const glance = glanceOf(tasks);
    expect(glance.teamMembers).toBe(1);
    expect(glance.activeTasks).toBe(2);
    expect(glance.agents).toBe(1);
  });

  it("reads one person without inventing a score", () => {
    const tasks = buildStewardTasks({ ...base, commitments: [commitment()] });
    const read = personRead(tasks, tasks[0]!.owner.key, NOW);
    expect(read?.owner.name).toBe("Ada Palmer");
    expect(read?.active).toBe(1);
    expect(read?.mainPriority?.title).toBe("Send the onboarding pack");
  });
});
