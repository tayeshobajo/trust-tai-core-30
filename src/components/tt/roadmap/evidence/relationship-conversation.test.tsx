// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RelationshipConversation } from "./relationship-conversation";
import { event, org, roadmapId, relationshipId } from "@/domain/roadmap-correspondence.fixtures";
import type { Correspondence, CorrespondencePage } from "@/domain/roadmap-correspondence";
afterEach(cleanup);
const page = (
  events: Correspondence[] = [event],
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
    .mockResolvedValueOnce(page([event], "a".repeat(64)))
    .mockResolvedValueOnce(
      page([event, { ...event, sourceEventId: "second", bodyText: "SECOND" }], "b".repeat(64)),
    )
    .mockResolvedValueOnce(page([{ ...event, bodyText: "CONFLICT" }]));
  render(<RelationshipConversation organizationId={org} roadmapId={roadmapId} read={read} />);
  fireEvent.click(await screen.findByText("Load more imported messages"));
  expect(await screen.findByText("SECOND")).toBeTruthy();
  fireEvent.click(screen.getByText("Load more imported messages"));
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
  expect(await screen.findByText("No approved messages imported yet")).toBeTruthy();
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
    .mockResolvedValueOnce(page([event], "a".repeat(64)))
    .mockReturnValueOnce(pending);
  const view = render(
    <RelationshipConversation
      organizationId={org}
      roadmapId={roadmapId}
      read={read}
      onPreview={onPreview}
    />,
  );
  fireEvent.click(await screen.findByText("Load more imported messages"));
  view.unmount();
  const count = onPreview.mock.calls.length;
  rejectOld(new Error("Old read failed"));
  await Promise.resolve();
  await Promise.resolve();
  expect(onPreview).toHaveBeenCalledTimes(count);
});
