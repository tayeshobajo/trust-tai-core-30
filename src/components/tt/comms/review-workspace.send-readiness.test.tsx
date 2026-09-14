// @vitest-environment jsdom
/**
 * The Sending panel must never show a stale "ready".
 *
 * Ready, then an unsaved edit, then a saved new version: each is a different
 * question, and the panel is only allowed to answer the one that matches what
 * is actually on record. Nothing here sends anything — the only call made is
 * the read-only readiness question.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const sendReadiness = vi.fn();

vi.mock("@/data/supabase/comms-review-client", () => ({
  sendReadiness: (organizationId: string, draftId: string) =>
    sendReadiness(organizationId, draftId),
}));

import { SendReadiness } from "./review-workspace";

afterEach(() => {
  cleanup();
  sendReadiness.mockReset();
});

const READY = {
  ready: true,
  code: null,
  message: "This is approved as it stands and could be sent from the queue.",
  blockers: [],
  configured: true,
};

const NOT_READY = {
  ready: false,
  code: "no_approval",
  message: "These words have not been approved yet.",
  blockers: ["No approval covers this version."],
  configured: true,
};

function panel(props: { versionId: string; contextRevision: number; dirty: boolean }) {
  return (
    <SendReadiness
      organizationId="org-1"
      draftId="draft-1"
      channel="email_resend"
      sender="Tai"
      approvedAt="2026-09-14T10:00:00.000Z"
      contextFingerprint="fp-1"
      {...props}
    />
  );
}

describe("SendReadiness", () => {
  it("goes ready, then unsaved, then asks again for the saved version", async () => {
    sendReadiness.mockResolvedValue(READY);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const view = render(
      <QueryClientProvider client={client}>
        {panel({ versionId: "v1", contextRevision: 3, dirty: false })}
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("send-readiness-state").textContent).toContain("could be sent"),
    );
    expect(sendReadiness).toHaveBeenCalledTimes(1);

    // An unsaved edit: the panel stops claiming anything and asks nothing.
    view.rerender(
      <QueryClientProvider client={client}>
        {panel({ versionId: "v1", contextRevision: 3, dirty: true })}
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("send-readiness-state").textContent).toContain("unsaved changes"),
    );
    expect(sendReadiness).toHaveBeenCalledTimes(1);

    // Saved as a new version: a new question, answered afresh.
    sendReadiness.mockResolvedValue(NOT_READY);
    view.rerender(
      <QueryClientProvider client={client}>
        {panel({ versionId: "v2", contextRevision: 4, dirty: false })}
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("send-readiness-state").textContent).toContain(
        "not been approved yet",
      ),
    );
    expect(sendReadiness).toHaveBeenCalledTimes(2);
  });
});
