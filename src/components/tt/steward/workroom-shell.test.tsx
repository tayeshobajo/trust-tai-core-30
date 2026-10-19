// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "../app-shell";
import { StewardWorkroom } from "./workroom";
import type { WorkspaceIdentity } from "@/lib/workspace";

const service = vi.hoisted(() => ({ conversations: vi.fn(), commitments: vi.fn(), list: vi.fn() }));
vi.mock("@/data/supabase/cmd-tasks", () => ({
  businessWorkQuery: (org: string, userId: string) => ({
    queryKey: ["cmd-tasks", org, userId, "business"],
    queryFn: async () => ({ tasks: [], truncated: false }),
  }),
}));
vi.mock("@/data/supabase/steward-service", () => ({ stewardService: service }));
vi.mock("@/data/supabase/steward-task-state", () => ({ stewardTaskState: service }));
vi.mock("@/data/steward/recent-sync", () => ({ syncRecentMeetings: () => new Promise(() => {}) }));
vi.mock("@/hooks/use-presence", () => ({ usePresence: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ signOut: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params: _params,
    children,
    ...props
  }: React.PropsWithChildren<{ to: string; params?: unknown }>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: "/modules/steward" } }),
}));

const identity: WorkspaceIdentity = {
  userId: "fictional-user",
  email: "review@example.invalid",
  name: "Fictional reviewer",
  firstName: "Fictional",
  organizationId: "fictional-org",
  organizationName: "Fictional review",
  organizationSlug: "fictional",
  role: "member",
  canManage: false,
  avatarUrl: null,
  apps: ["home", "steward", "scout"].map((appId) => ({
    appId,
    level: "work",
    visible: true,
    canWork: true,
    canManage: false,
    because: "fictional fixture",
  })),
};
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function setup(child: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {child}
    </QueryClientProvider>,
  );
}
describe("Steward suite-shell regression", () => {
  it("retains authorized suite navigation during loading and empty reads", async () => {
    service.conversations.mockResolvedValue([]);
    service.commitments.mockResolvedValue([]);
    service.list.mockResolvedValue([]);
    setup(<StewardWorkroom identity={identity} />);
    expect(screen.getByText("Reading stored meetings…")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Trust Tai suite" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Steward" }).getAttribute("aria-current")).toBe("page");
    await screen.findByText(/No saved meetings yet/);
    expect(screen.getAllByRole("link", { name: "Settings" })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /Account settings/ })).toBeNull();
  });
  it("retains suite navigation when stored meetings fail", async () => {
    service.conversations.mockRejectedValue(new Error("fixture unavailable"));
    service.commitments.mockResolvedValue([]);
    service.list.mockResolvedValue([]);
    setup(<StewardWorkroom identity={identity} />);
    await screen.findByText(/Couldn’t read stored meetings/);
    expect(screen.getByRole("link", { name: "Home" })).toBeTruthy();
  });
  it("opens a named app drawer and closes it on navigation", async () => {
    setup(
      <AppShell identity={identity} canvas="workroom">
        Fictional content
      </AppShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open app navigation" }));
    const dialog = screen.getByRole("dialog", { name: "App navigation" });
    expect(dialog).toBeTruthy();
    fireEvent.click(dialog.querySelector('a[href="/"]') as HTMLAnchorElement);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
