// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RelationshipConversation } from "./relationship-conversation";
import { event, org, roadmapId, relationshipId } from "@/domain/roadmap-correspondence.fixtures";
import type { ConversationEvent, CorrespondencePage } from "@/domain/roadmap-correspondence";
afterEach(cleanup);
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
  readAt: "2026-11-04T10:00:00Z",
});
it("shows inline chronological text with separate drafts and inert HTML", async () => {
  const read = vi.fn().mockResolvedValue(
    page([
      {
        ...event,
        sourceEventId: "later",
        occurredAt: "2026-11-03T10:00:00Z",
        bodyText: "SECOND <img src=x onerror=bad()>",
      },
      { ...event, sourceEventId: "draft", kind: "draft", bodyText: "UNSENT COPY" },
      { ...event, kind: "received", bodyText: "FIRST" },
    ]),
  );
  const { container } = render(
    <RelationshipConversation
      organizationId={org}
      roadmapId={roadmapId}
      relationshipId={relationshipId}
      read={read}
    />,
  );
  expect(await screen.findByText("FIRST")).toBeTruthy();
  expect(screen.getByText("SECOND <img src=x onerror=bad()>")).toBeTruthy();
  expect(container.querySelector("img")).toBeNull();
  const pre = [...container.querySelectorAll("pre")].map((x) => x.textContent);
  expect(pre).toEqual(["FIRST", "SECOND <img src=x onerror=bad()>", "UNSENT COPY"]);
  expect(screen.getByRole("heading", { name: "Unsent prepared copy" })).toBeTruthy();
  expect(screen.getByLabelText("Search loaded messages")).toBeTruthy();
  expect(container.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
});
it("does not leak previous-client text while a new scoped read is pending or fails", async () => {
  let resolveOld!: (v: CorrespondencePage) => void;
  const old = new Promise<CorrespondencePage>((r) => (resolveOld = r));
  const read = vi.fn().mockReturnValueOnce(old).mockRejectedValueOnce(new Error("Denied"));
  const view = render(
    <RelationshipConversation organizationId={org} roadmapId={roadmapId} read={read} />,
  );
  view.rerender(
    <RelationshipConversation
      organizationId={org}
      roadmapId="00000000-0000-4000-8000-000000000099"
      read={read}
    />,
  );
  resolveOld(page([{ ...event, bodyText: "OLD PRIVATE TEXT" }]));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("OLD PRIVATE TEXT")).toBeNull();
});
it("deduplicates a repeated page and clears text on a conflicting event", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(page([event], "a".repeat(64) + ".25"))
    .mockResolvedValueOnce(
      page(
        [event, { ...event, sourceEventId: "second", bodyText: "SECOND" }],
        "b".repeat(64) + ".50",
      ),
    )
    .mockResolvedValueOnce(page([{ ...event, bodyText: "CONFLICT" }]));
  render(<RelationshipConversation organizationId={org} roadmapId={roadmapId} read={read} />);
  fireEvent.click(await screen.findByText("Load older saved messages"));
  expect(await screen.findByText("SECOND")).toBeTruthy();
  fireEvent.click(screen.getByText("Load older saved messages"));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("SECOND")).toBeNull();
  expect(screen.queryByText(event.bodyText)).toBeNull();
});
it("fails closed on a mismatched reader scope and preserves honest empty coverage", async () => {
  const read = vi
    .fn()
    .mockResolvedValue({ ...page(), organizationId: "00000000-0000-4000-8000-000000000088" });
  const view = render(
    <RelationshipConversation organizationId={org} roadmapId={roadmapId} read={read} />,
  );
  expect(await screen.findByRole("alert")).toBeTruthy();
  view.unmount();
  render(
    <RelationshipConversation
      organizationId={org}
      roadmapId={roadmapId}
      read={vi.fn().mockResolvedValue(page([]))}
    />,
  );
  expect(await screen.findByText("No saved messages available")).toBeTruthy();
  expect(screen.queryByText("0 sent")).toBeNull();
});
it("limits search to loaded records instead of implying global correspondence search", async () => {
  render(
    <RelationshipConversation
      organizationId={org}
      roadmapId={roadmapId}
      read={vi.fn().mockResolvedValue(page())}
    />,
  );
  await screen.findByText(event.bodyText);
  fireEvent.change(screen.getByLabelText("Search loaded messages"), {
    target: { value: "missing" },
  });
  expect(screen.getByText("No matching loaded messages")).toBeTruthy();
  expect(screen.getByText(/search covers loaded messages only/)).toBeTruthy();
});
it("does not publish a stale pagination callback after its relationship unmounts", async () => {
  let rejectOld!: (reason: Error) => void;
  const pending = new Promise<CorrespondencePage>((_resolve, reject) => (rejectOld = reject));
  const onPreview = vi.fn();
  const read = vi
    .fn()
    .mockResolvedValueOnce(page([event], "a".repeat(64) + ".25"))
    .mockReturnValueOnce(pending);
  const view = render(
    <RelationshipConversation
      organizationId={org}
      roadmapId={roadmapId}
      read={read}
      onPreview={onPreview}
    />,
  );
  fireEvent.click(await screen.findByText("Load older saved messages"));
  view.unmount();
  const count = onPreview.mock.calls.length;
  rejectOld(new Error("Old read failed"));
  await Promise.resolve();
  await Promise.resolve();
  expect(onPreview).toHaveBeenCalledTimes(count);
});

const stored = (id = "stored-1"): Extract<ConversationEvent, { source: "stored_gmail" }> => ({
  organizationId: org,
  roadmapId,
  relationshipId,
  source: "stored_gmail",
  channel: "email",
  kind: "received",
  sourceAccountRef: "team@example.test",
  sourceEventId: id,
  identityKind: "provider_id",
  sourceUrl: "https://mail.google.com/mail/?authuser=team%40example.test#all/stored-1",
  occurredAt: "2026-11-05T12:00:00Z",
  timestampPrecision: "exact",
  storedAt: "2026-11-06T12:00:00Z",
  subject: "Synthetic stored reply",
  bodyText: "STORED PRIVATE REPLY",
  bodyRepresentation: "stored_plain_text",
});
it("distinguishes stored snippets from reviewed imports and states freshness limits", async () => {
  const input = {
    ...page([
      { ...stored(), bodyText: "SNIPPET <img src=x>", bodyRepresentation: "stored_snippet" },
    ]),
    sources: { storedGmail: "included", omittedUnattributed: 1, providerSync: "not_checked" },
  };
  const { container } = render(
    <RelationshipConversation
      organizationId={org}
      roadmapId={roadmapId}
      read={vi.fn().mockResolvedValue(input)}
    />,
  );
  expect(await screen.findByText("SNIPPET <img src=x>")).toBeTruthy();
  expect(
    screen.getByText(/Stored snippet only; not the complete message or a reviewed import/),
  ).toBeTruthy();
  expect(screen.getByText(/Gmail sync is not checked/)).toBeTruthy();
  expect(screen.getByText(/Some legacy stored mail has no verified mailbox/)).toBeTruthy();
  expect(screen.queryByText(/Verified .*reviewed/)).toBeNull();
  expect(container.querySelector("img")).toBeNull();
});
it("refreshes saved records without a provider sync and clears stale text immediately", async () => {
  let resolveRefresh!: (p: CorrespondencePage) => void;
  const pending = new Promise<CorrespondencePage>((resolve) => {
    resolveRefresh = resolve;
  });
  const read = vi
    .fn()
    .mockResolvedValueOnce(page([stored()]))
    .mockReturnValueOnce(pending);
  const onPreview = vi.fn();
  render(
    <RelationshipConversation
      organizationId={org}
      roadmapId={roadmapId}
      read={read}
      onPreview={onPreview}
    />,
  );
  await screen.findByText("STORED PRIVATE REPLY");
  fireEvent.click(screen.getByRole("button", { name: "Refresh stored messages" }));
  expect(screen.queryByText("STORED PRIVATE REPLY")).toBeNull();
  expect(onPreview).toHaveBeenLastCalledWith(null, roadmapId);
  expect(read).toHaveBeenLastCalledWith(org, roadmapId);
  expect(
    (screen.getByRole("button", { name: "Refresh stored messages" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  resolveRefresh(page([{ ...stored("new"), bodyText: "NEW PRIVATE REPLY" }]));
  expect(await screen.findByText("NEW PRIVATE REPLY")).toBeTruthy();
  expect(onPreview).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: "NEW PRIVATE REPLY" }),
    roadmapId,
  );
});
it("ignores a late load-more response after refresh, including its preview", async () => {
  let resolveMore!: (p: CorrespondencePage) => void;
  const oldPage = new Promise<CorrespondencePage>((resolve) => {
    resolveMore = resolve;
  });
  const read = vi
    .fn()
    .mockResolvedValueOnce(page([stored()], "a".repeat(64) + ".25"))
    .mockReturnValueOnce(oldPage)
    .mockResolvedValueOnce(page([{ ...stored("new"), bodyText: "FRESH RESPONSE" }]));
  const onPreview = vi.fn();
  render(
    <RelationshipConversation
      organizationId={org}
      roadmapId={roadmapId}
      read={read}
      onPreview={onPreview}
    />,
  );
  fireEvent.click(await screen.findByText("Load older saved messages"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh stored messages" }));
  await screen.findByText("FRESH RESPONSE");
  resolveMore(page([{ ...stored("stale"), bodyText: "LATE OLD PAGE" }]));
  await waitFor(() => expect(screen.queryByText("LATE OLD PAGE")).toBeNull());
  expect(onPreview).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: "FRESH RESPONSE" }),
    roadmapId,
  );
  expect(screen.getByText("FRESH RESPONSE")).toBeTruthy();
});
it("clears previous text when refresh access fails and a retry can recover", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(page([stored()]))
    .mockRejectedValueOnce(new Error("Revoked"))
    .mockResolvedValueOnce(page([event]));
  render(<RelationshipConversation organizationId={org} roadmapId={roadmapId} read={read} />);
  await screen.findByText("STORED PRIVATE REPLY");
  fireEvent.click(screen.getByRole("button", { name: "Refresh stored messages" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("STORED PRIVATE REPLY")).toBeNull();
  fireEvent.click(screen.getByText("Retry conversations"));
  expect(await screen.findByText(event.bodyText)).toBeTruthy();
});
it("clears private text on relationship changes even if the roadmap id is unchanged", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(page([stored()]))
    .mockReturnValueOnce(new Promise(() => {}));
  const view = render(
    <RelationshipConversation
      organizationId={org}
      roadmapId={roadmapId}
      relationshipId={relationshipId}
      read={read}
    />,
  );
  await screen.findByText("STORED PRIVATE REPLY");
  view.rerender(
    <RelationshipConversation
      organizationId={org}
      roadmapId={roadmapId}
      relationshipId={org}
      read={read}
    />,
  );
  expect(screen.queryByText("STORED PRIVATE REPLY")).toBeNull();
});
it("keeps identical provider ids in different mailboxes distinct", async () => {
  render(
    <RelationshipConversation
      organizationId={org}
      roadmapId={roadmapId}
      read={vi
        .fn()
        .mockResolvedValue(
          page([
            stored(),
            { ...stored(), sourceAccountRef: "other@example.test", bodyText: "OTHER MAILBOX" },
          ]),
        )}
    />,
  );
  await screen.findByText("STORED PRIVATE REPLY");
  expect(screen.getByText("OTHER MAILBOX")).toBeTruthy();
});
it("publishes the newest loaded preview after pagination as well as initial read", async () => {
  const onPreview = vi.fn();
  const read = vi
    .fn()
    .mockResolvedValueOnce(page([event], "a".repeat(64) + ".25"))
    .mockResolvedValueOnce(page([stored()]));
  render(
    <RelationshipConversation
      organizationId={org}
      roadmapId={roadmapId}
      read={read}
      onPreview={onPreview}
    />,
  );
  fireEvent.click(await screen.findByText("Load older saved messages"));
  await screen.findByText("STORED PRIVATE REPLY");
  expect(onPreview).toHaveBeenLastCalledWith(
    expect.objectContaining({ at: "2026-11-05T12:00:00Z", text: "STORED PRIVATE REPLY" }),
    roadmapId,
  );
});

it("visibly labels truncated stored excerpts and keeps their original-source link", async () => {
  const e = {
    ...stored(),
    bodyText: "SYNTHETIC EXCERPT",
    bodyRepresentation: "stored_truncated_excerpt" as const,
  };
  render(
    <RelationshipConversation
      organizationId={org}
      roadmapId={roadmapId}
      read={vi.fn().mockResolvedValue(page([e]))}
    />,
  );
  const label = await screen.findByText(/Stored text excerpt, truncated for this view/);
  expect(label.closest("details")).toBeNull();
  expect(screen.getByText("SYNTHETIC EXCERPT")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Open original source for Synthetic stored reply" })
      .getAttribute("href"),
  ).toBe(e.sourceUrl);
  expect(screen.queryByText("Message text is unavailable in stored records.")).toBeNull();
});
