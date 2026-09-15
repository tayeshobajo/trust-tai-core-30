// @vitest-environment jsdom
/**
 * Drafts & Reviews, on the states it must not misreport.
 *
 * A closed review does not hide a draft still waiting at the boundary; a
 * failed read never shows a confident count or an empty success; and a link
 * naming a draft reaches that exact record, even one the capped list does not
 * hold. Nothing here sends anything.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchQueue = vi.fn();
const fetchDraftById = vi.fn();
const listReviews = vi.fn();

vi.mock("@/components/tt/comms/draft-queue", () => ({
  fetchQueue: (organizationId: string) => fetchQueue(organizationId),
  fetchDraftById: (organizationId: string, draftId: string) =>
    fetchDraftById(organizationId, draftId),
  openReview: vi.fn(),
  rejectDraft: vi.fn(),
  sendDraft: vi.fn(),
}));

vi.mock("@/data/supabase/comms-review-client", () => ({
  listReviews: (organizationId: string) => listReviews(organizationId),
}));

vi.mock("@/components/tt/comms/review-workspace", () => ({
  NewReview: () => <div>new review</div>,
  ReviewDetail: ({ sessionId }: { sessionId: string }) => <div>review {sessionId}</div>,
}));

vi.mock("@tanstack/react-router", () => ({ useBlocker: () => undefined }));

import { DraftsWorkspace, rowsFrom, type DraftsSelection } from "./drafts-workspace";
import type { WorkspaceIdentity } from "@/lib/workspace";

const identity = { organizationId: "org-1", userId: "user-1", role: "owner" } as WorkspaceIdentity;

const draft = (id: string) => ({
  draft: {
    id,
    organization_id: "org-1",
    relationship_id: "rel-1",
    subject: `Draft ${id}`,
    body: "Words.",
    intent: "reply",
    register: "warm",
    review_state: "needs_human_review",
    rationale: null,
    created_at: "2026-09-14T09:00:00.000Z",
  },
  relationship: {
    id: "rel-1",
    full_name: "Dana Reid",
    company_name: null,
    email: "dana@example.invalid",
    stage: "active",
  },
});

const session = (over: Record<string, unknown>) => ({
  id: "s-1",
  organizationId: "org-1",
  relationshipId: null,
  threadId: null,
  title: "A review",
  situation: null,
  goal: null,
  recipientName: "Dana Reid",
  recipientEmail: null,
  status: "open",
  contextRevision: 1,
  draftId: null,
  intendedChannel: null,
  kind: null,
  updatedAt: "2026-09-14T10:00:00.000Z",
  ...over,
});

function view(selection: DraftsSelection, onSelect = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DraftsWorkspace identity={identity} selection={selection} onSelect={onSelect} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  fetchQueue.mockReset();
  fetchDraftById.mockReset();
  listReviews.mockReset();
});

describe("what each row actually is", () => {
  it("calls a closed review closed, and still shows its draft as waiting", () => {
    const rows = rowsFrom(
      [draft("d-1") as never],
      [session({ status: "closed", draftId: "d-1" }) as never],
    );
    expect(rows.find((row) => row.sessionId === "s-1")?.stateLabel).toBe("Closed");
    expect(rows.find((row) => row.draftId === "d-1" && row.kind === "draft")?.state).toBe(
      "waiting",
    );
  });

  it("hides a draft behind its live review, and calls approval approval", () => {
    const open = rowsFrom([draft("d-1") as never], [session({ draftId: "d-1" }) as never]);
    expect(open.filter((row) => row.kind === "draft")).toHaveLength(0);
    expect(open[0]?.stateLabel).toBe("In review");
    const approved = rowsFrom([], [session({ status: "approved" }) as never]);
    expect(approved[0]?.state).toBe("approved");
  });
});

describe("a list that could not be read", () => {
  it("says so, offers a retry, and states no counts", async () => {
    fetchQueue.mockRejectedValue(new Error("network down"));
    listReviews.mockResolvedValue({ rows: [], total: 0, capped: false });
    view({});

    await waitFor(() => expect(screen.getByText(/could not be read just now/i)).toBeTruthy());
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    expect(screen.queryByText(/nothing in this filter/i)).toBeNull();
    expect(screen.getByRole("button", { name: "All" }).textContent).toBe("All");
  });
});

describe("a list that is only part of the truth", () => {
  it("names the real total instead of letting a page read as everything", async () => {
    fetchQueue.mockResolvedValue([]);
    listReviews.mockResolvedValue({ rows: [session({})], total: 214, capped: true });

    view({});

    await waitFor(() =>
      expect(screen.getByText(/out of 214 reviews in this workspace/i)).toBeTruthy(),
    );
  });
});

describe("a link that names one record", () => {
  it("reads that exact draft rather than looking through the capped list", async () => {
    fetchQueue.mockResolvedValue([]);
    listReviews.mockResolvedValue({ rows: [], total: 0, capped: false });
    fetchDraftById.mockResolvedValue(draft("d-99"));

    view({ draft: "d-99" });

    await waitFor(() => expect(screen.getByText("Draft d-99")).toBeTruthy());
    expect(fetchDraftById).toHaveBeenCalledWith("org-1", "d-99");
  });

  it("moves a draft link onto the live review that governs it", async () => {
    const onSelect = vi.fn();
    fetchQueue.mockResolvedValue([draft("d-1")]);
    listReviews.mockResolvedValue({ rows: [session({ draftId: "d-1" })], total: 1, capped: false });

    view({ draft: "d-1" }, onSelect);

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ session: "s-1" }));
  });
});
