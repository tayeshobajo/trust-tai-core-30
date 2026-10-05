// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DailyHome } from "./daily-home";
import { PersonalDashboard } from "./personal-dashboard";
import type { WorkspaceIdentity } from "@/lib/workspace";
import type { StewardDashboardRead } from "@/data/steward/dashboard-read";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  revenue: vi.fn(),
  create: vi.fn(),
  dashboard: vi.fn(),
}));
vi.mock("@/data/supabase/cmd-tasks", () => ({
  cmdTasks: { list: mocks.list, create: mocks.create },
}));
vi.mock("@/data/supabase/commercial-service", () => ({ listClientCommercialState: mocks.revenue }));
vi.mock("@/data/steward/dashboard-read", () => ({ readStewardDashboard: mocks.dashboard }));
vi.mock("@/data/steward/use-steward-actions", () => ({ useStewardActions: () => ({}) }));
vi.mock("@/components/tt/steward/reassign-picker", () => ({ ReassignPicker: () => null }));
vi.mock("@/components/tt/steward/task-detail", () => ({ TaskDetailPanel: () => null }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
const identity = {
  userId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000010",
  name: "Test Person",
  role: "member",
  apps: [{ appId: "clients" }],
} as WorkspaceIdentity;
const read = {
  now: "2026-10-04T12:00:00Z",
  weeklyGoal: null,
  tasks: [],
  activities: [],
} as unknown as StewardDashboardRead;
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function mount(viewer = identity, data = read) {
  const onConfirmGoal = vi.fn();
  const onCreate = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DailyHome
        identity={viewer}
        read={data}
        onCreate={onCreate}
        onOpenLegacy={vi.fn()}
        onOpenBoard={vi.fn()}
        onConfirmGoal={onConfirmGoal}
        confirmingGoal={false}
      />
    </QueryClientProvider>,
  );
  return { onConfirmGoal, onCreate };
}
function empty() {
  mocks.list.mockResolvedValue({ tasks: [], truncated: false });
  mocks.revenue.mockResolvedValue([]);
}
describe("approved daily Home", () => {
  it.each(["personal", "business"])(
    "qualifies incomplete My Tasks counts when %s is truncated",
    async (scope) => {
      empty();
      mocks.list.mockImplementation(async (_org: string, requested: string) => ({
        tasks: [],
        truncated: requested === scope,
      }));
      mount();
      expect(await screen.findByText(/Partial view: at least 0 open/)).toBeTruthy();
      expect(screen.getByText(/these are not complete totals/)).toBeTruthy();
      expect(screen.queryByText("No open tasks assigned to you.")).toBeNull();
    },
  );
  it("opens the private task editor directly from Home and saves through its canonical service", async () => {
    empty();
    mocks.dashboard.mockResolvedValue({ ...read, people: [], agents: { agents: [] } });
    mocks.create.mockResolvedValue({});
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PersonalDashboard identity={identity} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "+ New task" }));
    const title = await screen.findByLabelText("Task title");
    expect(screen.getByRole("dialog", { name: "New task" })).toBeTruthy();
    fireEvent.change(title, { target: { value: "Synthetic direct Home task" } });
    fireEvent.click(screen.getByRole("button", { name: "Save task" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        identity.organizationId,
        "personal",
        expect.stringMatching(/^cmd-board:/),
        expect.objectContaining({
          title: "Synthetic direct Home task",
          owner_user_id: identity.userId,
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("renders honest unknown revenue and empty work without mockup metrics or an AI feed", async () => {
    empty();
    const actions = mount();
    await screen.findByText("No open business tasks recorded.");
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.queryByText("$5,000")).toBeNull();
    expect(screen.queryByText("$75k+")).toBeNull();
    expect(screen.queryByText("AI teammate activity")).toBeNull();
    expect(screen.getByText("No confirmed meeting time")).toBeTruthy();
    fireEvent.click(screen.getByText("+ New task"));
    expect(actions.onCreate).toHaveBeenCalledOnce();
    expect(screen.getByText("My progress").closest("details")?.open).toBe(false);
  });
  it("does not query commercial records without the existing Clients app access", async () => {
    empty();
    mount({ ...identity, apps: [] });
    await screen.findByText("No open business tasks recorded.");
    expect(mocks.revenue).not.toHaveBeenCalled();
    expect(screen.getByText("Clients access required")).toBeTruthy();
  });
  it("keeps missing revenue amounts visible instead of claiming complete coverage", async () => {
    empty();
    mocks.revenue.mockResolvedValue([
      { tier: "run", mrrCents: 10000 },
      { tier: "run", mrrCents: null },
    ]);
    mount();
    await screen.findByText("1 of 2 visible Run client amounts recorded");
    expect(screen.getByText("Coverage unverified")).toBeTruthy();
    expect(screen.getByText("Not comparable yet.")).toBeTruthy();
  });
  it("never exposes another person's goal or confirms on review", async () => {
    empty();
    const foreign = {
      ...read,
      weeklyGoal: { ownerUserId: "someone-else", title: "PRIVATE GOAL", status: "proposed" },
    } as StewardDashboardRead;
    const actions = mount(identity, foreign);
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    expect(screen.queryByText("PRIVATE GOAL")).toBeNull();
    fireEvent.click(screen.getByText("Review goal"));
    expect(actions.onConfirmGoal).not.toHaveBeenCalled();
    expect(screen.queryByText("Confirm my goal")).toBeNull();
  });
  it("reports failed task reads instead of saying there is no work", async () => {
    empty();
    mocks.list.mockRejectedValue(new Error("unavailable"));
    mount();
    await screen.findByText(/Some tasks could not be read/);
    expect(screen.queryByText("No open tasks assigned to you.")).toBeNull();
  });
});
