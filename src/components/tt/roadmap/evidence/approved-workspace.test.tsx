// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApprovedRoadmapWorkspace } from "./approved-workspace";
import { manifest, message, native } from "@/domain/roadmap-evidence.fixtures";
import type { PartialCoverage } from "@/domain/roadmap-evidence";
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => cb());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const props = { organizationId: "org", roadmaps: [], review: manifest };
it("opens a full detail page and supports back/forward selection without inventing messages", () => {
  render(<ApprovedRoadmapWorkspace {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "View QA company details" }));
  expect(screen.getByRole("heading", { name: "The conversation" })).toBeTruthy();
  expect(new URL(window.location.href).searchParams.get("evidence")).toBe("qa-company");
  expect(screen.getByText("No verified messages in this view yet")).toBeTruthy();
  window.history.replaceState(null, "", "/");
  fireEvent.popState(window);
  expect(screen.getByRole("heading", { name: "Roadmaps" })).toBeTruthy();
  window.history.replaceState(null, "", "/?evidence=qa-company");
  fireEvent.popState(window);
  expect(screen.getByRole("heading", { name: "The conversation" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "All roadmaps" }));
  expect(screen.getByRole("table", { name: "Roadmap inventory" })).toBeTruthy();
});
it("searches companies and resets an empty view", () => {
  render(<ApprovedRoadmapWorkspace {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Find a company or contact" }), {
    target: { value: "absent" },
  });
  expect(screen.getByText("No roadmaps match this view")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
  expect(screen.getByRole("button", { name: "View QA company details" })).toBeTruthy();
});
it("renders failure and loading states without zero-count claims", () => {
  const retry = vi.fn();
  const view = render(<ApprovedRoadmapWorkspace {...props} loading />);
  expect(screen.getByText("Reading your roadmap inventory…")).toBeTruthy();
  view.rerender(<ApprovedRoadmapWorkspace {...props} readError onRetry={retry} />);
  expect(screen.getByText(/Canonical read unavailable/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry canonical read" }));
  expect(retry).toHaveBeenCalledOnce();
});
it("expands full exact message text, keeps HTML inert and exposes source links", () => {
  const input = structuredClone(manifest);
  input.rows[0]!.interactions = [
    {
      ...message,
      body_exact:
        '<p>Exact receipt</p><img src="https://tracker.test/pixel"><script>BAD_EXECUTION()</script>',
      body_format: "text/html",
    },
  ];
  render(<ApprovedRoadmapWorkspace {...props} review={input} />);
  fireEvent.click(screen.getByRole("button", { name: "View QA company details" }));
  fireEvent.click(screen.getByText("Expand full message"));
  expect(screen.getAllByText("Exact receipt").length).toBeGreaterThan(0);
  expect(document.querySelector('img[src*="tracker.test"]')).toBeNull();
  expect(screen.getByRole("link", { name: "View original email" }).getAttribute("href")).toBe(
    message.source_url,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Search conversation" }), {
    target: { value: "missing" },
  });
  expect(screen.getByText("No matching messages")).toBeTruthy();
});
it("keeps bounced send and current-draft filters separate", () => {
  const input = structuredClone(manifest);
  input.rows[0]!.interactions = [
    message,
    {
      type: "email_delivery_failed",
      provider_message_id: "dsn",
      provider_thread_id: "t1",
      occurred_at: "2026-10-20T17:00:00Z",
      smtp_status: "550 5.1.1",
      reason: "Address does not exist",
      source_url: "https://mail.google.com/mail/u/0/#all/dsn",
    },
  ];
  render(<ApprovedRoadmapWorkspace {...props} review={input} />);
  expect(screen.getByText("Bounced")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Drafts to review" }));
  expect(screen.getByText("No roadmaps match this view")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.click(screen.getByRole("button", { name: "Delivery failures" }));
  fireEvent.click(screen.getByRole("button", { name: "View QA company details" }));
  expect(screen.getByText("Delivery failed · 550 5.1.1")).toBeTruthy();
});
it("keeps screenshot-reported reply separate from connector verified sends and exact bodies", () => {
  const coverage: PartialCoverage = {
    status: "partial_reconciliation",
    rows: [
      {
        slug: "qa-company",
        url: manifest.rows[0]!.public_roadmap_url,
        status: "existing_client_history_roadmap_send_unverified",
        gmail_history_complete: false,
        coverage_note: "Partial",
        verified_sent_message_ids: [],
        publication_checked_at: "2026-10-20T16:00:00Z",
        separate_user_evidenced_interaction: {
          evidence_class: "user_provided_screenshot_reported_by_parent_not_connector_verified",
          library_file_id: "libfile-qa",
          sender_context: "Separate mailbox",
          sent_at_reported: "2026-10-20T17:08:00Z",
          reply_at_reported: "2026-10-20T17:38:00Z",
          reply_summary: "User-reported reply",
          limits: "No exact body or provider ID.",
        },
      },
    ],
  };
  render(<ApprovedRoadmapWorkspace {...props} coverage={coverage} />);
  expect(screen.getByText("Reply reported")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Verified email sends" }));
  expect(screen.getByText("No roadmaps match this view")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
  fireEvent.click(screen.getByRole("button", { name: "View QA company details" }));
  expect(screen.getByText("User-reported reply")).toBeTruthy();
});
it("reads the canonical bridge only for a selected native roadmap", async () => {
  const read = vi.fn(async () => ({
    canonical: {
      id: native.id,
      organization_id: "org",
      status: "draft",
      updated_at: "2026-10-20T17:00:00Z",
    },
    evidence: {
      state: "privacy_integration_pending" as const,
      coverage: "unknown" as const,
      sentCount: null,
      interactions: null,
      mailboxSources: null,
    },
  }));
  render(
    <ApprovedRoadmapWorkspace organizationId="org" roadmaps={[native]} readCanonical={read} />,
  );
  expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "View QA company details" }));
  await waitFor(() => expect(screen.getByText("Current canonical status: draft")).toBeTruthy());
  expect(read).toHaveBeenCalledWith("org", native.id);
});
it("switches display layouts and keeps unknown deep links explicit", () => {
  const view = render(<ApprovedRoadmapWorkspace {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
  expect(screen.getByRole("button", { name: "Grid view" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  view.unmount();
  window.history.replaceState(null, "", "/?evidence=not-a-record");
  render(<ApprovedRoadmapWorkspace {...props} />);
  expect(screen.getByText("Roadmap unavailable")).toBeTruthy();
});

it("suppresses duplicate outreach while preserving a superseded physical Gmail draft", () => {
  const input = structuredClone(manifest);
  input.rows[0]!.interactions = [
    {
      type: "email_draft_saved",
      provider: "gmail",
      provider_draft_id: "d1",
      provider_message_id: "dm1",
      provider_thread_id: "dt1",
      from: message.from,
      to: [],
      subject: "Saved email",
      body_plain_text_content_only: "Saved copy",
      draft_only: true,
      sent_at: null,
      saved_message_timestamp: "2026-10-20T16:00:00Z",
      verified_at: "2026-10-20T16:01:00Z",
      source_url: "https://mail.google.com/mail/u/0/#drafts",
      verification: { body_matches: true, to_matches: true, from_matches: true, draft_only: true },
    },
  ];
  render(
    <ApprovedRoadmapWorkspace
      {...props}
      review={input}
      linkedIn={{
        updated_at: "2026-10-20T18:11:00Z",
        records: [
          {
            slug: "qa-company",
            recipient: "QA contact",
            profile_url: "https://www.linkedin.com/in/qa/",
            subject: "LinkedIn subject",
            body: "Exact LinkedIn copy <script>inert</script>",
            status: "sent_ui_verified",
            observed_send_time_utc_approx: "2026-10-20T18:09:00Z",
            receipt: "Sent history verified",
          },
        ],
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Drafts to review" }));
  expect(screen.getByText("No roadmaps match this view")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Verified email sends" }));
  expect(screen.getByText("No roadmaps match this view")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "LinkedIn activity" }));
  fireEvent.click(screen.getByRole("button", { name: "View QA company details" }));
  expect(screen.getByText("Email draft · superseded")).toBeTruthy();
  expect(screen.getByText(/do not send duplicate outreach/)).toBeTruthy();
  fireEvent.click(screen.getByText("Expand full LinkedIn message"));
  expect(screen.getByText("Exact LinkedIn copy <script>inert</script>")).toBeTruthy();
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getByText(/No provider message ID supplied/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Verified LinkedIn profile" }).getAttribute("href")).toBe(
    "https://www.linkedin.com/in/qa/",
  );
});
it("shows multiple LinkedIn events, a received reply and latest activity without inventing a due date", () => {
  const common = {
    slug: "qa-company",
    recipient: "QA contact",
    profile_url: "https://www.linkedin.com/in/qa/",
    subject: "Synthetic conversation",
    receipt: "Synthetic verification",
  };
  render(
    <ApprovedRoadmapWorkspace
      {...props}
      linkedIn={{
        updated_at: "2026-11-03T10:00:00Z",
        records: [
          {
            ...common,
            status: "sent_ui_verified",
            body: "Earlier sent message",
            observed_send_time_utc_approx: "2026-10-20T18:09:00Z",
          },
          {
            ...common,
            status: "received_ui_verified",
            body: "Later received reply",
            observed_at: "2026-11-03T09:00:00Z",
            timestamp_precision: "exact",
          },
        ],
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "View QA company details" }));
  expect(screen.getByText("LinkedIn received")).toBeTruthy();
  expect(screen.getByText("Earlier sent message")).toBeTruthy();
  expect(screen.getByText("Later received reply")).toBeTruthy();
  expect(screen.getByText("Latest observed activity")).toBeTruthy();
  expect(screen.getByText("Follow-up")).toBeTruthy();
  expect(screen.getByText("To be agreed")).toBeTruthy();
  expect(screen.getByText("Review the LinkedIn reply")).toBeTruthy();
  expect(
    screen.getByText(/Only separately approved roadmap correspondence can appear here/),
  ).toBeTruthy();
});
it("filters explicit follow-up dates and never treats missing review as good standing", () => {
  const input = structuredClone(manifest);
  input.rows[0]!.due_at = "2026-11-02";
  render(
    <ApprovedRoadmapWorkspace {...props} review={input} now={new Date("2026-11-03T12:00:00Z")} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /1\s*Due \/ overdue/ }));
  expect(screen.getByText("Overdue")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /0\s*Good standing/ }));
  expect(screen.getByText("No roadmaps match this view")).toBeTruthy();
});
it("renders verified roadmap cover only for its exact public source and falls back after load error", () => {
  render(
    <ApprovedRoadmapWorkspace
      organizationId="org"
      roadmaps={[]}
      publication={{
        checkedAt: "2026-11-03T00:00:00Z",
        sourceUrl: "https://trusttai.com/clients",
        entries: [
          {
            slug: "teamsynerg",
            name: "Public cover QA",
            url: "https://trusttai.com/clients/teamsynerg",
          },
        ],
      }}
    />,
  );
  const cover = screen.getByRole("img", { name: /TeamsynerG proposed sales roadmap/ });
  fireEvent.error(cover);
  expect(screen.queryByRole("img", { name: /TeamsynerG proposed sales roadmap/ })).toBeNull();
  expect(screen.getByText("Roadmap preview unavailable")).toBeTruthy();
});
