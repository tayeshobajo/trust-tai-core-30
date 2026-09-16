/**
 * The event path, end to end in memory.
 *
 * Room event -> policy -> reader -> runner -> store. The database and the
 * reasoning boundary are stood in for, so what is under test is the path
 * itself: what happens when the same event arrives twice, when the person is
 * no longer an active member, and when somebody edits the source.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sandboxStore } from "@/data/fixtures/preparation-sandbox";
import type { PreparationPolicy } from "@/domain/preparation-jobs";
import { PREPARATION_POLICY_DEFAULT } from "@/domain/preparation-jobs";

const store = sandboxStore();
const model = vi.fn(async () => ({
  raw: JSON.stringify({ summary: "They asked what phase one involves.", suggestions: [] }),
  provider: "test",
  model: "test-model",
}));
let policy: PreparationPolicy = {
  ...PREPARATION_POLICY_DEFAULT,
  enabledJobs: ["conversation_summary"],
  configuredKeys: ["reasoning_provider"],
};
let activeMember = true;

vi.mock("@/lib/preparation-policy.server", () => ({
  loadPreparationPolicy: async () => policy,
}));

vi.mock("@/lib/preparation-store.server", () => ({
  preparationStore: () => store,
  PreparationStoreUnavailable: class extends Error {},
  preparationWriter: () => {
    throw new Error("not used in this test");
  },
  missingSchema: () => false,
}));

vi.mock("@/lib/intelligence-runtime.server", () => ({
  requireRuntimeAccess: async () => activeMember,
  runtimeModelCaller: async () => model,
  runtimeProviderStatus: () => ({ configured: true }),
  ProviderCallFailedError: class extends Error {},
  ProviderNotConfiguredError: class extends Error {},
}));

const messages = [
  {
    id: "msg-1",
    organization_id: "org-1",
    relationship_id: "rel-1",
    direction: "inbound",
    subject: "Phase one",
    snippet: "What does a first phase involve?",
    occurred_at: "2026-09-15T10:00:00.000Z",
  },
];
let workspace = {
  comms_relationships: [{ id: "rel-1", organization_id: "org-1", owner_label: "Priya" }],
  comms_messages: [...messages],
  icp_profiles: [] as Record<string, unknown>[],
};

function fakeWorkspace(tables: Record<string, Record<string, unknown>[]>) {
  function query(table: string) {
    let rows = [...(tables[table] ?? [])];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return builder;
      },
      order: () => builder,
      limit: (count: number) => {
        rows = rows.slice(0, count);
        return builder;
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
    };
    return builder;
  }
  return { from: (table: string) => query(table) } as never;
}

const event = {
  token: "member-token",
  organizationId: "org-1",
  subjectRef: "rel-1",
  triggerEventId: "evt-1",
};

let onConversationMessage: typeof import("@/lib/preparation-events.server")["onConversationMessage"];
let setCallerClientFactory: typeof import("@/lib/preparation-readers.server")["setCallerClientFactory"];

beforeEach(async () => {
  ({ setCallerClientFactory } = await import("@/lib/preparation-readers.server"));
  ({ onConversationMessage } = await import("@/lib/preparation-events.server"));
  setCallerClientFactory(() => fakeWorkspace(workspace));
  activeMember = true;
  model.mockClear();
});

afterEach(() => setCallerClientFactory(null));

describe("a conversation gains a message", () => {
  it("prepares once for two copies of the same event, and the result is current", async () => {
    const first = await onConversationMessage(event);
    const second = await onConversationMessage(event);
    expect(model).toHaveBeenCalledTimes(1);
    expect(first?.status).toBe("prepared");
    expect(second?.key).toBe(first?.key);
    expect(second?.summary).toBe(first?.summary);
  });

  it("prepares nothing at all where the job is switched off", async () => {
    policy = { ...policy, enabledJobs: [] };
    expect(await onConversationMessage({ ...event, subjectRef: "rel-off" })).toBeNull();
    expect(model).not.toHaveBeenCalled();
    policy = { ...policy, enabledJobs: ["conversation_summary"] };
  });

  it("refuses somebody who is no longer an active member, and writes nothing", async () => {
    activeMember = false;
    await expect(onConversationMessage({ ...event, subjectRef: "rel-1" })).rejects.toThrow(
      /access/i,
    );
    expect(model).not.toHaveBeenCalled();
  });

  it("goes stale and prepares again when the source is edited", async () => {
    const before = await onConversationMessage(event);
    workspace = {
      ...workspace,
      comms_messages: [
        ...messages,
        { ...messages[0]!, id: "msg-2", occurred_at: "2026-09-16T08:00:00.000Z" },
      ],
    };
    setCallerClientFactory(() => fakeWorkspace(workspace));
    const after = await onConversationMessage({ ...event, triggerEventId: "evt-2" });
    expect(after?.key).not.toBe(before?.key);
    expect(after?.status).toBe("prepared");
    expect(after?.request.inputRevision).not.toBe(before?.request.inputRevision);
  });
});
