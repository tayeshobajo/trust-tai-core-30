/**
 * Steward's writes, exercised end to end: refusal rules, the write itself, and
 * the entry it leaves in the shared activity stream.
 */

import { describe, expect, it } from "vitest";

import type { ActivityEvent } from "@/domain/activity";
import type { StewardAgent, StewardTask } from "@/domain/steward-accountability";

import {
  completeTask,
  reassignToPerson,
  reprioritizeTask,
  requestAgentAssignment,
  setTaskDue,
  StewardRefusal,
  type StewardWriteDeps,
  type StewardWriter,
} from "./actions";

const NOW = "2026-08-18T12:00:00.000Z";

function task(overrides: Partial<StewardTask> = {}): StewardTask {
  return {
    id: "commitment-1",
    key: "commitment:commitment-1",
    organizationId: "org",
    title: "Send the onboarding pack",
    origin: "commitment",
    owner: {
      kind: "human",
      key: "ada@trusttai.com",
      name: "Ada Palmer",
      initials: "AP",
      userId: "user-ada",
    },
    focus: "do_now",
    state: "open",
    why: "Promised in the kickoff call.",
    sourceLabel: "Kickoff call",
    overdue: false,
    rank: 10,
    evidence: [],
    completionPath: "steward",
    ...overrides,
  } as StewardTask;
}

const agent: StewardAgent = {
  id: "agent-1",
  paperclipAgentId: "pc-1",
  name: "Scout Runner",
  responsibility: "Sourcing research",
  owningApp: "scout",
  lifecycle: "idle",
  capabilities: ["Prepare onboarding material"],
  cannotDo: ["Cannot email a client"],
  currentWork: null,
  activeTasks: [],
  awaitingApproval: [],
  completedThisWeek: 0,
  lastHeartbeatAt: null,
  recentOutcome: null,
};

interface Recorder {
  writer: StewardWriter;
  calls: string[];
  activity: Omit<ActivityEvent, "id">[];
  taskState: Record<string, unknown>[];
  agentTasks: Record<string, unknown>[];
}

function writerFor(
  identity: Partial<StewardWriter["identity"]> = {},
  overrides: Partial<StewardWriteDeps> = {},
): Recorder {
  const calls: string[] = [];
  const activity: Omit<ActivityEvent, "id">[] = [];
  const taskState: Record<string, unknown>[] = [];
  const agentTasks: Record<string, unknown>[] = [];

  const deps: StewardWriteDeps = {
    setCommitmentStatus: async (id, status) => calls.push(`status:${id}:${status}`),
    setCommitmentOwner: async (id, owner) => calls.push(`owner:${id}:${owner.name}:${owner.email}`),
    setCommitmentDue: async (id, dueAt) => calls.push(`due:${id}:${dueAt}`),
    saveTaskState: async (input) => {
      taskState.push(input);
      return input;
    },
    recordActivity: async (event) => {
      activity.push(event);
      return event;
    },
    assignAgentTask: async (input) => {
      agentTasks.push(input);
      return input;
    },
    now: () => NOW,
    ...overrides,
  };

  return {
    calls,
    activity,
    taskState,
    agentTasks,
    writer: {
      identity: {
        organizationId: "org",
        userId: "user-tai",
        name: "Tai",
        canManage: true,
        ...identity,
      },
      deps,
    },
  };
}

describe("completing a task", () => {
  it("records the promise as kept and writes one audit entry", async () => {
    const r = writerFor();
    await completeTask(r.writer, { task: task(), note: "Pack sent this morning." });

    expect(r.calls).toEqual(["status:commitment-1:kept"]);
    expect(r.taskState[0]).toMatchObject({
      taskKey: "commitment:commitment-1",
      completedBy: "Tai",
      completedAt: NOW,
      completionNote: "Pack sent this morning.",
    });
    expect(r.activity).toHaveLength(1);
    expect(r.activity[0]).toMatchObject({
      name: "task.completed",
      organizationId: "org",
      subject: { type: "task", id: "commitment-1" },
      occurredAt: NOW,
    });
    expect(r.activity[0]?.provenance.appId).toBe("steward");
    expect(r.activity[0]?.payload).toMatchObject({
      steward_task_key: "commitment:commitment-1",
      note: "Pack sent this morning.",
    });
  });

  it("still completes when Steward's own state table is missing", async () => {
    const r = writerFor({}, {
      saveTaskState: async () => {
        throw new Error("relation steward_task_state does not exist");
      },
    });
    await expect(completeTask(r.writer, { task: task(), note: "" })).resolves.toBeUndefined();
    expect(r.calls).toEqual(["status:commitment-1:kept"]);
    expect(r.activity).toHaveLength(1);
  });

  it("keeps the action when only the audit write fails", async () => {
    const r = writerFor({}, {
      recordActivity: async () => {
        throw new Error("activities unavailable");
      },
    });
    await expect(completeTask(r.writer, { task: task(), note: "" })).resolves.toBeUndefined();
    expect(r.calls).toEqual(["status:commitment-1:kept"]);
  });

  it("refuses a member completing someone else's promise, and writes nothing", async () => {
    const r = writerFor({ userId: "user-someone", canManage: false });
    await expect(completeTask(r.writer, { task: task(), note: "" })).rejects.toThrow(
      /Ada Palmer carries this/,
    );
    expect(r.calls).toEqual([]);
    expect(r.activity).toEqual([]);
  });

  it("lets the person carrying it complete their own promise", async () => {
    const r = writerFor({ userId: "user-ada", canManage: false });
    await completeTask(r.writer, { task: task(), note: "" });
    expect(r.calls).toEqual(["status:commitment-1:kept"]);
  });

  it("refuses project work and points at the owning room", async () => {
    const r = writerFor();
    const projectTask = task({
      completionPath: "projects",
      completionBecause: "This is delivery work. Complete it in Projects.",
    });
    await expect(completeTask(r.writer, { task: projectTask, note: "" })).rejects.toThrow(
      /Complete it in Projects/,
    );
    expect(r.calls).toEqual([]);
  });

  it("never lets Steward complete agent work", async () => {
    const r = writerFor();
    const agentTask = task({
      origin: "agent",
      completionPath: "paperclip",
      owner: { kind: "agent", key: "pc-1", name: "Scout Runner", initials: "SR" },
    } as Partial<StewardTask>);
    await expect(completeTask(r.writer, { task: agentTask, note: "" })).rejects.toBeInstanceOf(
      StewardRefusal,
    );
    expect(r.calls).toEqual([]);
    expect(r.activity).toEqual([]);
  });
});

describe("reprioritising by drag", () => {
  it("saves the new rank and says where it landed", async () => {
    const r = writerFor();
    await reprioritizeTask(r.writer, {
      task: task(),
      rank: 4,
      aboveTitle: "Draft the pricing note",
    });

    expect(r.taskState[0]).toMatchObject({ taskKey: "commitment:commitment-1", rank: 4 });
    expect(r.activity[0]?.name).toBe("task.updated");
    expect(r.activity[0]?.summary).toBe(
      'Tai moved “Send the onboarding pack” above “Draft the pricing note”.',
    );
    expect(r.activity[0]?.payload).toMatchObject({ rank: 4 });
  });

  it("does not touch commitment truth when only the order changed", async () => {
    const r = writerFor();
    await reprioritizeTask(r.writer, { task: task(), rank: 1 });
    expect(r.calls).toEqual([]);
  });
});

describe("reassigning", () => {
  it("moves the owner and records who carried it before", async () => {
    const r = writerFor();
    await reassignToPerson(r.writer, {
      task: task(),
      person: { key: "ben@trusttai.com", name: "Ben Ito" },
    });

    expect(r.calls).toEqual(["owner:commitment-1:Ben Ito:ben@trusttai.com"]);
    expect(r.activity[0]).toMatchObject({ name: "task.assigned" });
    expect(r.activity[0]?.payload).toMatchObject({
      owner_key: "ben@trusttai.com",
      previous_owner_key: "ada@trusttai.com",
    });
  });

  it("refuses a member without management authority", async () => {
    const r = writerFor({ canManage: false });
    await expect(
      reassignToPerson(r.writer, { task: task(), person: { key: "ben", name: "Ben Ito" } }),
    ).rejects.toThrow(/Only an owner or admin/);
    expect(r.calls).toEqual([]);
    expect(r.activity).toEqual([]);
  });

  it("refuses to reassign work another room owns", async () => {
    const r = writerFor();
    await expect(
      reassignToPerson(r.writer, {
        task: task({ origin: "project_work" } as Partial<StewardTask>),
        person: { key: "ben", name: "Ben Ito" },
      }),
    ).rejects.toThrow(/owned by another room/);
    expect(r.calls).toEqual([]);
  });

  it("asks Paperclip rather than claiming the agent took it", async () => {
    const r = writerFor();
    await requestAgentAssignment(r.writer, { task: task(), agent });

    expect(r.agentTasks[0]).toMatchObject({ agentId: "pc-1", title: "Send the onboarding pack" });
    expect(r.calls).toEqual([]);
    expect(r.activity[0]?.summary).toContain("sent to Scout Runner in Paperclip");
  });

  it("refuses an agent with no published capability for the work", async () => {
    const r = writerFor();
    await expect(
      requestAgentAssignment(r.writer, {
        task: task(),
        agent: { ...agent, capabilities: ["Reconcile invoices"] },
      }),
    ).rejects.toThrow(/no published capability/);
    expect(r.agentTasks).toEqual([]);
    expect(r.activity).toEqual([]);
  });
});

describe("due dates", () => {
  it("moves a meeting promise and records it", async () => {
    const r = writerFor();
    await setTaskDue(r.writer, { task: task(), dueAt: "2026-08-25T00:00:00.000Z" });
    expect(r.calls).toEqual(["due:commitment-1:2026-08-25T00:00:00.000Z"]);
    expect(r.activity[0]?.summary).toBe("Due date set to 2026-08-25.");
  });

  it("leaves delivery dates to the room that owns them", async () => {
    const r = writerFor();
    await expect(
      setTaskDue(r.writer, {
        task: task({ origin: "project_work" } as Partial<StewardTask>),
        dueAt: null,
      }),
    ).rejects.toThrow(/room that owns it/);
    expect(r.calls).toEqual([]);
  });
});
