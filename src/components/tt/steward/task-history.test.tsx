// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActivityEvent } from "@/domain/activity";
import { TaskHistory } from "./task-history";

const mocks = vi.hoisted(() => ({ list: vi.fn(), record: vi.fn() }));
vi.mock("@/data/supabase/activities", () => ({ supabaseActivity: mocks }));
const org = "00000000-0000-4000-8000-000000000001";
const task = "00000000-0000-4000-8000-000000000002";
const otherTask = "00000000-0000-4000-8000-000000000003";
const event: ActivityEvent = {
  id: "fictional-event",
  organizationId: org,
  name: "task.completed",
  subject: { type: "task", id: task },
  summary: "Recorded completion activity",
  payload: { note: "Checked the fictional deliverable." },
  provenance: {
    appId: "steward",
    actor: { type: "user", id: "fictional-actor" },
    observedAt: "2026-10-17T20:00:00Z",
  },
  occurredAt: "2026-10-17T20:00:00Z",
};

function setup(commitmentId = task) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (id: string) => (
    <QueryClientProvider client={client}>
      <TaskHistory key={id} organizationId={org} userId="fictional-user" commitmentId={id} />
    </QueryClientProvider>
  );
  const rendered = render(view(commitmentId));
  return { ...rendered, client, select: (id: string) => rendered.rerender(view(id)) };
}

function expand() {
  const details = screen.getByText("History").closest("details");
  if (!details) throw new Error("History disclosure missing");
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("selected commitment history", () => {
  it("reads only the selected UUID and Steward app after expansion, never writes", async () => {
    mocks.list.mockResolvedValue([event]);
    setup();
    expect(mocks.list).not.toHaveBeenCalled();
    expand();
    await screen.findByText(event.summary);
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({
      organizationId: org,
      subjectType: "task",
      subjectId: task,
      appIds: ["steward"],
      limit: 50,
    });
    expect(mocks.record).not.toHaveBeenCalled();
    expect(screen.getByText(/fictional-actor/)).toBeTruthy();
    expect(screen.getByText("2026-10-17T20:00:00Z")).toBeTruthy();
    expect(screen.getByText("Checked the fictional deliverable.")).toBeTruthy();
    expect(
      screen.getByText(/Legacy activity · task.completed · not a completion receipt/),
    ).toBeTruthy();
  });

  it("shows loading while the selected-task read is unresolved", () => {
    mocks.list.mockReturnValue(new Promise(() => {}));
    setup();
    expand();
    expect(screen.getByRole("status").textContent).toContain("Reading recorded history");
  });

  it("shows a read error instead of empty history", async () => {
    mocks.list.mockRejectedValue(new Error("read unavailable"));
    setup();
    expand();
    expect((await screen.findByRole("alert")).textContent).toContain("History could not be read");
    expect(screen.queryByText(/No recorded history found/)).toBeNull();
  });

  it("suppresses cached events after a failed refresh rather than showing stale history", async () => {
    mocks.list.mockResolvedValueOnce([event]).mockRejectedValueOnce(new Error("read failed"));
    const { client } = setup();
    expand();
    await screen.findByText(event.summary);
    await client.invalidateQueries({ queryKey: ["steward", "task-history", org] });
    await screen.findByRole("alert");
    expect(screen.queryByText(event.summary)).toBeNull();
    expect(screen.queryByText(/No recorded history found/)).toBeNull();
  });

  it("empty activity read is not evidence of no prior work and discloses the limit", async () => {
    mocks.list.mockResolvedValue([]);
    setup();
    expand();
    await screen.findByText(/No recorded history found/);
    expect(screen.getByRole("status").textContent).toContain("does not mean no prior work");
    expect(screen.getByText(/Up to 50 most recent/)).toBeTruthy();
  });

  it("a late result for a previously selected task never becomes the new task history", async () => {
    let resolveOld: ((events: ActivityEvent[]) => void) | undefined;
    mocks.list.mockImplementation(({ subjectId }: { subjectId: string }) =>
      subjectId === task
        ? new Promise<ActivityEvent[]>((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve([]),
    );
    const view = setup();
    expand();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    view.select(otherTask);
    expand();
    await screen.findByText(/No recorded history found/);
    resolveOld?.([event]);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(mocks.list.mock.calls[1]?.[0].subjectId).toBe(otherTask);
    expect(screen.queryByText(event.summary)).toBeNull();
  });

  it("missing commitment identity never falls back to an organization-wide read", () => {
    setup("");
    expand();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
