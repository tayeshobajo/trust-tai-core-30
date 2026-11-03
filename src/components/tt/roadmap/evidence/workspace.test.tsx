// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { RoadmapEvidenceWorkspace } from "./workspace";
import { manifest, message, native } from "@/domain/roadmap-evidence.fixtures";
afterEach(cleanup);
it("keeps missing history unknown, and search/filter do not alter identities", () => {
  render(<RoadmapEvidenceWorkspace organizationId="org" roadmaps={[native]} review={manifest} />);
  expect(screen.getAllByText("Send history incomplete")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Sent messages" }));
  expect(screen.getByText("No records match this search and filter.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Prepared copy" }));
  expect(screen.getAllByRole("button", { name: "Inspect QA company" })).toHaveLength(1);
  fireEvent.change(screen.getByRole("textbox", { name: "Search roadmap evidence" }), {
    target: { value: "absent" },
  });
  expect(screen.getByText("No records match this search and filter.")).toBeTruthy();
});
it("opens exact prepared copy separately from interactions and preserves snapshot uncertainty", () => {
  render(<RoadmapEvidenceWorkspace organizationId="org" roadmaps={[]} review={manifest} />);
  fireEvent.click(screen.getByRole("button", { name: "Inspect QA company" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).queryByText("UNSENT QA BODY")).toBeNull();
  expect(within(dialog).getByText("No verified messages in this view yet.")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Prepared copy" }));
  expect(within(dialog).getByText("UNSENT QA BODY")).toBeTruthy();
  expect(within(dialog).getByText(/Later draft IDs have not been reconciled/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("renders hostile HTML as text with exact source available and no remote resources", () => {
  const m = structuredClone(manifest);
  m.rows[0]!.prepared_message = null;
  m.rows[0]!.interactions = [
    {
      ...message,
      body_format: "text/html",
      body_exact:
        '<p>Receipt</p><img src="https://tracker.test/pixel" onerror="alert(1)"><script>alert(1)</script>',
    },
  ];
  render(<RoadmapEvidenceWorkspace organizationId="org" roadmaps={[]} review={m} />);
  fireEvent.click(screen.getByRole("button", { name: "Inspect QA company" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Receipt")).toBeTruthy();
  expect(dialog.querySelector("img,script,iframe")).toBeNull();
  expect(
    within(dialog).getByText(
      '<p>Receipt</p><img src="https://tracker.test/pixel" onerror="alert(1)"><script>alert(1)</script>',
    ),
  ).toBeTruthy();
  expect(within(dialog).getByRole("link", { name: "Open source 1" }).getAttribute("rel")).toBe(
    "noopener noreferrer",
  );
});
it("never shows a fake zero after a failed read or exposes stale canonical records", () => {
  render(<RoadmapEvidenceWorkspace organizationId="org" roadmaps={[native]} readError />);
  expect(screen.getByText("Unavailable")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Inspect QA company" })).toBeNull();
  expect(screen.getByRole("alert")).toBeTruthy();
});

it("shows saved DRAFT evidence in prepared copy, with empty To held and no send receipt", () => {
  const m = structuredClone(manifest);
  const prepared = m.rows[0]!.prepared_message!;
  prepared.to = [];
  prepared.mailbox_draft_created = true;
  m.rows[0]!.recipient.verification_status = "held_unverified_named_direct";
  m.rows[0]!.interactions = [
    {
      type: "email_draft_saved",
      provider: "gmail",
      provider_draft_id: "draft-test",
      provider_message_id: "draft-message",
      provider_thread_id: "draft-thread",
      from: prepared.from,
      to: [],
      subject: prepared.subject,
      body_plain_text_content_only: prepared.body_markdown_exact,
      draft_only: true,
      sent_at: null,
      saved_message_timestamp: "2026-10-20T10:59:06-05:00",
      verified_at: "2026-10-20T16:00:45Z",
      source_url: "https://mail.google.com/mail/u/0/#drafts",
      verification: { body_matches: true, to_matches: true, from_matches: true, draft_only: true },
    },
  ];
  render(<RoadmapEvidenceWorkspace organizationId="org" roadmaps={[]} review={m} />);
  expect(screen.getByText("Mailbox draft saved")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Inspect QA company" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("No verified messages in this view yet.")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Prepared copy" }));
  expect(within(dialog).getByText("Gmail draft saved · DRAFT only")).toBeTruthy();
  expect(
    within(dialog).getByText("To is empty · recipient verification remains held."),
  ).toBeTruthy();
  expect(within(dialog).getByText(/Draft: draft-test/)).toBeTruthy();
});

it("closes with Escape and restores keyboard focus to its originating roadmap", async () => {
  render(<RoadmapEvidenceWorkspace organizationId="org" roadmaps={[]} review={manifest} />);
  const opener = screen.getByRole("button", { name: "Inspect QA company" });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

it("labels a team outbound copy explicitly and excludes it from the sent filter", () => {
  const m = structuredClone(manifest);
  m.rows[0]!.interactions = [
    { ...message, type: "email_team_outbound_copy", mailbox: "tai@example.test" },
  ];
  render(<RoadmapEvidenceWorkspace organizationId="org" roadmaps={[]} review={m} />);
  fireEvent.click(screen.getByRole("button", { name: "Inspect QA company" }));
  expect(
    within(screen.getByRole("dialog")).getByText(/Team outbound copy · account SENT unverified/),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Sent messages" }));
  expect(screen.getByText("No records match this search and filter.")).toBeTruthy();
});

it("preserves bounded query scope and unknowns without claiming complete history", () => {
  const note =
    "QA exact URL search exhausted; other addresses and full received history remain unknown.";
  render(
    <RoadmapEvidenceWorkspace
      organizationId="org"
      roadmaps={[]}
      review={manifest}
      coverage={{
        status: "partial_reconciliation",
        rows: [
          {
            slug: "qa-company",
            url: manifest.rows[0]!.public_roadmap_url,
            status: "existing_client_history_roadmap_send_unverified",
            gmail_history_complete: false,
            coverage_note: note,
            verified_sent_message_ids: [],
            publication_checked_at: "2026-10-20T16:30:00Z",
          },
        ],
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Inspect QA company" }));
  expect(
    within(screen.getByRole("dialog")).getByText("Reviewed scope & remaining unknowns"),
  ).toBeTruthy();
  expect(within(screen.getByRole("dialog")).getByText(note)).toBeTruthy();
});

it("loads canonical status when a native dossier opens without inventing mailbox coverage", async () => {
  const calls: string[] = [];
  const readCanonical = async (org: string, id: string) => {
    calls.push(`${org}:${id}`);
    return {
      canonical: {
        id,
        organization_id: org,
        status: "approved",
        updated_at: "2026-10-20T12:00:00Z",
      },
      evidence: {
        state: "privacy_integration_pending" as const,
        coverage: "unknown" as const,
        sentCount: null,
        interactions: null,
        mailboxSources: null,
      },
    };
  };
  render(
    <RoadmapEvidenceWorkspace
      organizationId="org"
      roadmaps={[native]}
      readCanonical={readCanonical}
    />,
  );
  expect(calls).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Inspect QA company" }));
  await waitFor(() => expect(screen.getByText("Current canonical status: approved")).toBeTruthy());
  expect(calls).toEqual([`org:${native.id}`]);
  expect(screen.getByText(/Mailbox coverage unknown/)).toBeTruthy();
});
it("keeps read failures explicit and permits a safe retry", async () => {
  let count = 0;
  const reader = async () => {
    count++;
    throw new Error("denied");
  };
  render(
    <RoadmapEvidenceWorkspace organizationId="org" roadmaps={[native]} readCanonical={reader} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Inspect QA company" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Retry canonical read" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry canonical read" }));
  await waitFor(() => expect(count).toBe(2));
  expect(screen.queryByText("Current canonical status: approved")).toBeNull();
});

it("shows a permanent bounce without calling the sent message delivered or a current draft", () => {
  const input = structuredClone(manifest);
  input.rows[0]!.outreach_status.mailbox_draft_saved = false;
  input.rows[0]!.interactions = [
    message,
    {
      type: "email_delivery_failed",
      provider_message_id: "bounce1",
      provider_thread_id: message.provider_thread_id,
      occurred_at: "2026-10-20T17:19:48Z",
      smtp_status: "550 5.1.1",
      reason: "Recipient does not exist",
      source_url: "https://mail.google.com/mail/u/0/#all/bounce1",
    },
  ];
  render(<RoadmapEvidenceWorkspace organizationId="org" roadmaps={[]} review={input} />);
  fireEvent.click(screen.getByRole("button", { name: "Bounced" }));
  fireEvent.click(screen.getByRole("button", { name: "Inspect QA company" }));
  expect(screen.getByText("Delivery failed · 550 5.1.1")).toBeTruthy();
  expect(screen.getByText(/Sent is verified; delivery failed/)).toBeTruthy();
  expect(screen.getByRole("link", { name: /Open delivery failure source/ })).toBeTruthy();
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Prepared copy" }),
  );
  expect(screen.getByText(/This is not a current unsent draft/)).toBeTruthy();
  expect(screen.queryByText("Gmail draft saved · DRAFT only")).toBeNull();
});
