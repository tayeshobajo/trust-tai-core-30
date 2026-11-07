// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CanonicalConversation } from "./canonical-conversation";
import { event, org, roadmapId, relationshipId } from "@/domain/roadmap-correspondence.fixtures";
import type { ConversationEvent, CorrespondencePage } from "@/domain/roadmap-correspondence";
const page = (
  events: ConversationEvent[] = [event],
  nextCursor: string | null = null,
): CorrespondencePage => ({
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
  expect(await screen.findByText("No saved messages available")).toBeTruthy();
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

it("labels truncated stored excerpts before expansion and links the complete original", async () => {
  const e: ConversationEvent = {
    organizationId: org,
    roadmapId,
    relationshipId,
    source: "stored_gmail",
    channel: "email",
    kind: "received",
    sourceAccountRef: "team@example.test",
    sourceEventId: "synthetic-long",
    identityKind: "provider_id",
    sourceUrl: "https://mail.google.com/mail/?authuser=team%40example.test#all/synthetic-long",
    occurredAt: "2026-11-05T12:00:00Z",
    timestampPrecision: "exact",
    storedAt: "2026-11-06T12:00:00Z",
    subject: "Synthetic long reply",
    bodyText: "SYNTHETIC EXCERPT",
    bodyRepresentation: "stored_truncated_excerpt",
  };
  render(
    <CanonicalConversation
      organizationId={org}
      roadmapId={roadmapId}
      read={vi.fn().mockResolvedValue(page([e]))}
    />,
  );
  const label = await screen.findByText(/Stored text excerpt, truncated for this view/);
  expect(label.closest("details")).toBeNull();
  expect(screen.getByRole("link", { name: "Open original source" }).getAttribute("href")).toBe(
    e.sourceUrl,
  );
  fireEvent.click(screen.getByText("Expand stored message text"));
  expect(screen.getByText("SYNTHETIC EXCERPT")).toBeTruthy();
});
