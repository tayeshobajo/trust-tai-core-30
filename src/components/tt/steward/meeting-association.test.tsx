// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkroomView } from "./workroom-view";
import { appendLinkedBusinessWork, withMeetingAssociation } from "@/domain/steward-meeting-links";
import { buildWorkroom } from "@/domain/steward-workroom";
import type { BoardTask } from "@/domain/cmd-tasks";
import type { Commitment } from "@/domain/steward";
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
}));
beforeAll(() => {
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(cleanup);
const id = "00000000-0000-4000-8000-000000000011";
const task = {
  id,
  organization_id: "org",
  task_visibility: "business",
  title: "Email-refined linked work",
  status: "complete",
  next_action: "Review email refinement",
  notes: "Original task notes",
  acceptance_criteria: ["Original acceptance"],
  context_links: withMeetingAssociation(
    [{ label: "Email refinement", url: "https://example.com/email" }],
    id,
  ),
  completion_evidence: "Original board evidence",
  owner_user_id: null,
  owner_label: null,
  due_at: null,
} as BoardTask;
const commitment = {
  id,
  conversationId: id,
  what: "Confirmed promise",
  status: "open",
  ownerName: "Fictional",
  evidence: [],
  sourceKey: "source",
} as Commitment;
const base = buildWorkroom(
  [
    {
      id,
      title: "Fictional meeting",
      occurredAt: "2026-10-18",
      provider: "fathom",
      sourceUrl: "",
      participantCount: 2,
      segmentCount: 2,
      lastSegmentAt: null,
    },
  ],
  [commitment],
);
const meetings = appendLinkedBusinessWork(base, [task], "org");
function setup(state: "loading" | "error" | "ready" = "ready", truncated = false) {
  const history = vi.fn().mockReturnValue(<span>Commitment history</span>);
  render(
    <WorkroomView
      meetings={state === "ready" ? meetings : base}
      commitmentFor={() => commitment}
      receiptsFailed={false}
      sync={{
        running: false,
        failure: null,
        lastSuccessAt: null,
        added: 0,
        refreshed: 0,
        unchanged: 0,
        preserved: 0,
        warnings: [],
        pendingTranscript: 0,
        hasMore: false,
        onRetry: vi.fn(),
      }}
      headerMenu={null}
      accountSlot={null}
      historyFor={history}
      linkedRead={{ state, truncated }}
    />,
  );
  return history;
}
describe("linked-work source and verification isolation", () => {
  it("selects distinct original IDs, retains evidence/source and never queries commitment history for a board row", () => {
    const history = setup();
    history.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Email-refined linked work/ }));
    expect(history).not.toHaveBeenCalled();
    expect(screen.getByText(/Linked business task · association/)).toBeTruthy();
    expect(screen.getByText("Original board evidence")).toBeTruthy();
    expect(screen.getByText("Original task notes")).toBeTruthy();
    expect(screen.getByText("Original acceptance")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Email refinement" })).toBeTruthy();
    expect(screen.getByText(/not a verified commitment receipt/)).toBeTruthy();
    expect(screen.getByText(/History unavailable/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verified 0" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Confirmed promise/ }).getAttribute("aria-pressed"),
    ).toBe("false");
  });
  it.each(["loading", "error"] as const)(
    "keeps %s linked reads unavailable, not empty/zero",
    (state) => {
      setup(state);
      expect(screen.getByRole("button", { name: "All tasks —" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Open —" })).toBeTruthy();
      expect(screen.queryByText(/0 linked business tasks/)).toBeNull();
      expect(screen.getByText(/all-work completion cannot be established/)).toBeTruthy();
    },
  );
  it("discloses truncated reads rather than complete coverage", () => {
    setup("ready", true);
    expect(screen.getByText(/most recent 1,000 board records only/)).toBeTruthy();
    expect(screen.getByText(/all-work completion cannot be established/)).toBeTruthy();
  });
});
