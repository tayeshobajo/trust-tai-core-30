// @vitest-environment jsdom
/**
 * Accessibility of the real Drafts & Reviews screen, on the states a person
 * actually meets: a populated list, a list that could not be read, and the
 * empty list.
 *
 * This is the production component, not a mockup. It is rendered in a test
 * browser, so colour contrast is not measurable here and is excluded — that
 * part is measured on the rendered screen, and is recorded separately.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
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
  listReviews: (organizationId: string, offset?: number) => listReviews(organizationId, offset),
}));

vi.mock("@/components/tt/comms/review-workspace", () => ({
  NewReview: () => <div>new review</div>,
  ReviewDetail: ({ sessionId }: { sessionId: string }) => <div>review {sessionId}</div>,
}));

vi.mock("@tanstack/react-router", () => ({ useBlocker: () => undefined }));

import { DraftsWorkspace } from "./drafts-workspace";
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

function view() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DraftsWorkspace identity={identity} selection={{}} onSelect={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function violations(container: Element) {
  const result = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    // Not measurable without a real renderer; measured on the rendered screen instead.
    rules: { "color-contrast": { enabled: false } },
  });
  return result.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`);
}

afterEach(() => {
  cleanup();
  fetchQueue.mockReset();
  fetchDraftById.mockReset();
  listReviews.mockReset();
});

describe("the real Drafts & Reviews screen", () => {
  it("has no WCAG A/AA structure or naming failures with work on it", async () => {
    fetchQueue.mockResolvedValue([draft("d-1"), draft("d-2")]);
    listReviews.mockResolvedValue({
      rows: [session({}), session({ id: "s-2", status: "approved" })],
      total: 214,
      capped: true,
    });
    const { container } = view();
    await waitFor(() => expect(screen.getByText(/Draft d-1|Dana Reid/)).toBeTruthy());

    expect(await violations(container)).toEqual([]);
  });

  it("keeps a failed read distinct from an empty one, and both accessible", async () => {
    fetchQueue.mockRejectedValue(new Error("network down"));
    listReviews.mockResolvedValue({ rows: [], total: 0, capped: false });
    const failed = view();
    await waitFor(() => expect(screen.getByText(/could not be read just now/i)).toBeTruthy());
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    expect(await violations(failed.container)).toEqual([]);

    cleanup();
    fetchQueue.mockReset();
    fetchQueue.mockResolvedValue([]);
    const empty = view();
    await waitFor(() => expect(screen.queryByText(/could not be read just now/i)).toBeNull());
    expect(await violations(empty.container)).toEqual([]);
  });

  it("gives every control a name a screen reader can say", async () => {
    fetchQueue.mockResolvedValue([draft("d-1")]);
    listReviews.mockResolvedValue({ rows: [session({})], total: 1, capped: false });
    const { container } = view();
    await waitFor(() => expect(screen.getByText(/Dana Reid/)).toBeTruthy());

    const unnamed = [...container.querySelectorAll("button, a[href]")].filter((el) => {
      const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
      return name.length === 0;
    });
    expect(unnamed).toEqual([]);
  });
});
