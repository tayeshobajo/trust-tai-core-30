// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApprovedHome } from "./approved-home";
import type { WorkspaceIdentity } from "@/lib/workspace";
import type { StewardDashboardRead } from "@/data/steward/dashboard-read";
const mocks = vi.hoisted(() => ({ tasks: vi.fn(), revenue: vi.fn(), meetings: vi.fn() }));
vi.mock("@/data/supabase/cmd-tasks", () => ({ cmdTasks: { list: mocks.tasks } }));
vi.mock("@/data/supabase/commercial-service", () => ({ listClientCommercialState: mocks.revenue }));
vi.mock("@/data/supabase/steward-service", () => ({
  stewardService: { conversations: mocks.meetings },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: React.PropsWithChildren<{ to: string }>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
const identity = {
  userId: "me",
  organizationId: "org",
  name: "Review User",
  apps: ["clients", "steward", "roadmap", "studio"].map((appId) => ({ appId })),
} as WorkspaceIdentity;
const data = {
  now: "2026-10-20T08:00:00Z",
  weeklyGoal: null,
  tasks: [],
  activities: [],
} as unknown as StewardDashboardRead;
function mount(viewer = identity, read = data) {
  const open = vi.fn(),
    confirm = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ApprovedHome
        identity={viewer}
        read={read}
        onCreate={vi.fn()}
        onOpenBoard={open}
        onOpenLegacy={vi.fn()}
        onConfirmGoal={confirm}
        confirmingGoal={false}
      />
    </QueryClientProvider>,
  );
  return { open, confirm };
}
beforeEach(() => {
  mocks.tasks.mockResolvedValue({ tasks: [], truncated: false });
  mocks.revenue.mockResolvedValue([]);
  mocks.meetings.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe("approved homepage source honesty", () => {
  it("renders unavailable totals and no illustrative tasks as real work", async () => {
    mount();
    await screen.findByText("No open business tasks recorded.");
    expect(screen.queryByText("Review the next roadmap")).toBeNull();
    expect(screen.getAllByLabelText("Unavailable")).toHaveLength(3);
    expect(screen.getByText("No recurring amounts recorded")).toBeTruthy();
    expect(screen.getByText("Publishing schedule not connected to Home.")).toBeTruthy();
  });
  it("gates optional reads and links by the current app permissions", async () => {
    mount({ ...identity, apps: [] });
    await screen.findByText("No open business tasks recorded.");
    expect(mocks.revenue).not.toHaveBeenCalled();
    expect(mocks.meetings).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("reports failed reads without inventing empty success", async () => {
    mocks.tasks.mockRejectedValue(Error("offline"));
    mocks.revenue.mockRejectedValue(Error("offline"));
    mocks.meetings.mockRejectedValue(Error("offline"));
    mount();
    await screen.findByText(/Business work could not be read/);
    expect(screen.queryByText("No open business tasks recorded.")).toBeNull();
    expect(screen.getByText("Revenue source unavailable")).toBeTruthy();
    expect(screen.getByText(/Meetings could not be read/)).toBeTruthy();
  });
  it("qualifies partial work and opens the canonical task handler", async () => {
    const task = {
      id: "one",
      title: "Actual saved task",
      status: "blocked",
      next_action: "Review evidence",
      archived_at: null,
      parent_task_id: null,
    };
    mocks.tasks.mockResolvedValue({ tasks: [task], truncated: true });
    const { open } = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Review Actual saved task" }));
    expect(open).toHaveBeenCalledWith(task);
    expect(screen.getByText("Read limit reached; priorities are a partial view.")).toBeTruthy();
  });
  it("keeps partial recorded MRR distinct from collected revenue", async () => {
    mocks.revenue.mockResolvedValue([
      { tier: "run", mrrCents: 10000 },
      { tier: "run", mrrCents: null },
      { tier: "build", mrrCents: 900000 },
    ]);
    mount();
    await screen.findByText("$100");
    expect(screen.getByText("Coverage unverified")).toBeTruthy();
    expect(screen.getByText(/1 of 2 visible Run client amounts recorded/)).toBeTruthy();
  });
  it("never displays a foreign goal or confirms a proposal merely by opening it", async () => {
    const { confirm } = mount(identity, {
      ...data,
      weeklyGoal: { ownerUserId: "other", title: "PRIVATE", status: "proposed" },
    } as StewardDashboardRead);
    fireEvent.click(screen.getByText("Review goal"));
    await waitFor(() => expect(mocks.tasks).toHaveBeenCalled());
    expect(screen.queryByText("PRIVATE")).toBeNull();
    expect(screen.queryByText("Confirm my goal")).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });
  it("requires an explicit click to confirm the current person’s proposal", async () => {
    const { confirm } = mount(identity, {
      ...data,
      weeklyGoal: { ownerUserId: "me", title: "Saved proposal", status: "proposed" },
    } as StewardDashboardRead);
    fireEvent.click(screen.getByText("Review goal"));
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirm my goal"));
    expect(confirm).toHaveBeenCalledOnce();
  });
});
