// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CanonicalConversation } from "./canonical-conversation";
import { event, org, roadmapId, relationshipId } from "@/domain/roadmap-correspondence.fixtures";
import type { CorrespondencePage } from "@/domain/roadmap-correspondence";
const page = (events = [event], nextCursor: string | null = null): CorrespondencePage => ({
  organizationId: org,
  roadmapId,
  relationshipId,
  events,
  nextCursor,
  coverage: events.length ? "partial" : "unknown",
  readAt: "2026-11-03T12:00:00Z",
});
afterEach(cleanup);
it("shows honest empty state without claiming no outreach", async () => {
  render(
    <CanonicalConversation
      organizationId={org}
      roadmapId={roadmapId}
      read={vi.fn().mockResolvedValue(page([]))}
    />,
  );
  expect(await screen.findByText("No approved messages imported yet")).toBeTruthy();
  expect(screen.queryByText("0 sent")).toBeNull();
});
it("escapes full message text and distinguishes email, Sales Navigator, draft and bounce", async () => {
  const records = [
    { ...event, bodyText: "<img src=x onerror=alert(1)> SYNTHETIC" },
    {
      ...event,
      sourceEventId: "sale",
      channel: "linkedin_sales_navigator" as const,
      sourceUrl: "https://www.linkedin.com/sales/inbox/synthetic",
      identityKind: "reviewed_receipt" as const,
      timestampPrecision: "approximate" as const,
    },
    { ...event, sourceEventId: "draft", kind: "draft" as const },
    { ...event, sourceEventId: "bounce", kind: "bounce" as const },
  ];
  const { container } = render(
    <CanonicalConversation
      organizationId={org}
      roadmapId={roadmapId}
      read={vi.fn().mockResolvedValue(page(records))}
    />,
  );
  expect(await screen.findByText("Sales Navigator · Sent · delivery unconfirmed")).toBeTruthy();
  expect(screen.getByText("Email · Draft · unsent")).toBeTruthy();
  expect(screen.getByText("Email · Bounced · delivery failed")).toBeTruthy();
  expect(container.querySelector("img")).toBeNull();
  fireEvent.click(screen.getAllByText("Expand full reviewed message")[0]!);
  expect(screen.getByText("<img src=x onerror=alert(1)> SYNTHETIC")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Conversation channel"), {
    target: { value: "linkedin_sales_navigator" },
  });
  expect(screen.queryByText("Email · Draft · unsent")).toBeNull();
  expect(screen.getByRole("link", { name: "Open original source" }).getAttribute("rel")).toBe(
    "noopener noreferrer",
  );
});
it("paginates without duplicate messages then clears text on a failed page read", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(page([event], "a".repeat(64)))
    .mockResolvedValueOnce(page([event, { ...event, sourceEventId: "second" }], "b".repeat(64)))
    .mockRejectedValueOnce(new Error("Denied"));
  render(<CanonicalConversation organizationId={org} roadmapId={roadmapId} read={read} />);
  fireEvent.click(await screen.findByText("Load more reviewed messages"));
  await waitFor(() => expect(screen.getAllByText("Expand full reviewed message")).toHaveLength(2));
  fireEvent.click(screen.getByText("Load more reviewed messages"));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText(event.bodyText)).toBeNull();
});
