// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RelationshipRoadmapWorkspace } from "./relationship-workspace";
import type { RelationshipWorkspaceProps } from "./relationship-workspace";
import {
  fixtureRoadmaps,
  publication,
  bindings,
  history,
  summary,
  reviews,
  readFixture,
  org,
  user,
  now,
  id,
} from "../../../../../qa/roadmaps-three-pane/fixtures";
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const props = {
  organizationId: org,
  userId: user,
  roadmaps: fixtureRoadmaps,
  publication,
  bindings,
  history,
  conversationSummary: summary,
  standingReviews: reviews,
  readConversations: readFixture,
  now,
  canWork: true,
};
it("keeps the queue visible across selected tabs and canonical deep links", async () => {
  render(<RelationshipRoadmapWorkspace {...props} />);
  await screen.findByText(/Hi there, I’ve prepared/);
  expect(screen.getByLabelText("Roadmap relationship queue")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open Beacon Building Inspection" }));
  expect(new URL(window.location.href).searchParams.get("evidence")).toBe("fictional-1");
  await screen.findByText("Thanks for the roadmap. Can we review it together?");
  fireEvent.click(screen.getByRole("tab", { name: "Details" }));
  expect(screen.getByLabelText("Roadmap relationship queue")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Conversation" }));
  await screen.findByText("Thanks for the roadmap. Can we review it together?");
  window.history.replaceState(null, "", `/?evidence=canonical:${id(100)}`);
  fireEvent.popState(window);
  await screen.findByText(/Hi there, I’ve prepared/);
});
it("does not substitute message counts for saved roadmap totals and scopes identity search", async () => {
  render(<RelationshipRoadmapWorkspace {...props} />);
  expect(screen.getByRole("button", { name: "Total Roadmaps: 8" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search roadmaps or contacts"), {
    target: { value: "Beacon" },
  });
  const queue = screen.getByLabelText("Roadmap relationship queue");
  expect(
    within(queue).getByRole("button", { name: "Open Beacon Building Inspection" }),
  ).toBeTruthy();
  expect(within(queue).queryByRole("button", { name: "Open Cedar Tax Studio" })).toBeNull();
  expect(screen.getByText(/source coverage|history is incomplete/)).toBeTruthy();
});
it("keeps sending, unsupported notes and health overrides unavailable", async () => {
  render(<RelationshipRoadmapWorkspace {...props} />);
  expect((screen.getByRole("button", { name: /^Send$/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Add Internal Note" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Override Health (with evidence)" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Open Evergreen Wellness" }));
  expect(
    (screen.getByLabelText("Prepare local reply for Evergreen Wellness") as HTMLTextAreaElement)
      .disabled,
  ).toBe(true);
});
it("wires only the supplied existing editor and guards unsaved changes", async () => {
  const edit = vi.fn<NonNullable<RelationshipWorkspaceProps["renderUpdate"]>>(
    (r, _field, onDirty) => <button onClick={() => onDirty(true)}>Make local update dirty</button>,
  );
  render(<RelationshipRoadmapWorkspace {...props} renderUpdate={edit} />);
  fireEvent.click(screen.getByRole("button", { name: "Record an Update" }));
  expect(
    screen.getByRole("tab", { name: "Actions & Evidence" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(edit).toHaveBeenCalled();
  fireEvent.click(screen.getByText("Make local update dirty"));
  expect(
    (screen.getByRole("button", { name: "Open Beacon Building Inspection" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByText(/Finish, discard or check/)).toBeTruthy();
});
it("renders loading and failures with unknown metrics instead of false zeros", () => {
  const view = render(<RelationshipRoadmapWorkspace {...props} loading />);
  expect(screen.getByRole("button", { name: "Total Roadmaps: unknown" })).toBeTruthy();
  view.rerender(<RelationshipRoadmapWorkspace {...props} readError />);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.queryByText(/Hi there, I’ve prepared/)).toBeNull();
});
it("supports tab arrow keys and retains a selected relationship while filtering the queue", async () => {
  render(<RelationshipRoadmapWorkspace {...props} />);
  const conversation = screen.getByRole("tab", { name: "Conversation" });
  fireEvent.keyDown(conversation, { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "On Track: 2" }));
  const queue = screen.getByLabelText("Roadmap relationship queue");
  expect(within(queue).queryByRole("button", { name: "Open Cedar Tax Studio" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Cedar Tax Studio" })).toBeTruthy();
});
it("starts mobile on the queue and returns to it after opening a relationship", async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  render(<RelationshipRoadmapWorkspace {...props} />);
  expect(screen.queryByRole("heading", { name: "Cedar Tax Studio" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Cedar Tax Studio" }));
  await screen.findByRole("heading", { name: "Cedar Tax Studio" });
  fireEvent.click(screen.getByRole("button", { name: /^All roadmaps$/ }));
  expect(screen.queryByRole("heading", { name: "Cedar Tax Studio" })).toBeNull();
  expect(screen.getByRole("button", { name: "Open Cedar Tax Studio" })).toBeTruthy();
});
