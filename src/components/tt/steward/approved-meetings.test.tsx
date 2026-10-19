import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApprovedMeetings, type ApprovedMeetingsProps } from "./approved-meetings";
import { buildWorkroom } from "@/domain/steward-workroom";
import type { Commitment } from "@/domain/steward";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...p }: React.PropsWithChildren<{ to: string }>) => (
    <a href={p.to}>{children}</a>
  ),
}));
vi.mock("./workroom-view", () => ({
  ExistingTaskTools: () => <p>Existing tools</p>,
  WorkroomView: () => <p>Advanced meeting tools</p>,
}));
const post = vi.fn();
vi.mock("@/data/supabase/steward-updates", () => ({
  taskUpdates: { list: async () => [], post: (...args: unknown[]) => post(...args) },
}));
const c = {
  id: "11111111-1111-4111-8111-111111111111",
  conversationId: "22222222-2222-4222-8222-222222222222",
  status: "open",
  what: "Review delivery",
  evidence: [],
  sourceKey: "source",
} as unknown as Commitment;
const meetings = buildWorkroom(
  [
    {
      id: c.conversationId,
      title: "Delivery meeting",
      occurredAt: "2026-10-01",
      provider: "manual",
      sourceUrl: "",
      participantCount: 0,
      segmentCount: 0,
      lastSegmentAt: null,
    },
  ],
  [c],
);
function fixture(extra: Partial<ApprovedMeetingsProps> = {}) {
  const props = {
    meetings,
    commitmentFor: () => c,
    receiptsFailed: false,
    sync: {},
    headerMenu: null,
    accountSlot: null,
    identity: {
      organizationId: "33333333-3333-4333-8333-333333333333",
      userId: "44444444-4444-4444-8444-444444444444",
      name: "Test author",
    },
    canChange: () => true,
    onStatus: vi.fn(async () => {}),
    linkedRead: { state: "ready", truncated: false },
    ...extra,
  } as ApprovedMeetingsProps;
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ApprovedMeetings {...props} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  cleanup();
  post.mockReset();
  post.mockResolvedValue(undefined);
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
describe("approved journey", () => {
  it("opens meetings then tasks, closes and returns to overview", async () => {
    fixture();
    fireEvent.click(screen.getByRole("button", { name: /Delivery meeting/ }));
    expect(screen.getByRole("heading", { name: "Meeting tasks" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Review delivery/ }));
    expect(screen.getByRole("heading", { name: "Review delivery" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close task details"));
    expect(screen.queryByLabelText("Task update")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Meetings \// }));
    expect(screen.getByRole("heading", { name: "Meetings" })).toBeTruthy();
  });
  it("has an honest filter empty state", () => {
    fixture();
    fireEvent.click(screen.getByRole("button", { name: "Awaiting review" }));
    expect(screen.getByText("No meetings match these filters.")).toBeTruthy();
  });
  it("cancels roll-forward without a write and does not duplicate repeated submissions", async () => {
    fixture({ selection: { meetingId: c.conversationId, rowKey: `commitment:${c.id}` } });
    fireEvent.click(screen.getByRole("button", { name: /Roll forward/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Task update"), {
      target: { value: "Progress recorded" },
    });
    let finish!: () => void;
    post.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    fireEvent.submit(screen.getByLabelText("Task update").closest("form")!);
    expect(post).toHaveBeenCalledTimes(1);
    finish();
    expect(await screen.findByText("Saved.")).toBeTruthy();
  });
  it("disables mutations for a read-only viewer", () => {
    fixture({
      selection: { meetingId: c.conversationId, rowKey: `commitment:${c.id}` },
      canChange: () => false,
    });
    expect(
      (screen.getByRole("button", { name: /Mark complete/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Post update" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it("does not infer a selection from an unavailable task link", () => {
    fixture({ selection: { meetingId: c.conversationId, rowKey: "commitment:missing" } });
    expect(screen.getByText("This task is unavailable in this meeting.")).toBeTruthy();
    expect(screen.queryByLabelText("Task update")).toBeNull();
  });
});
