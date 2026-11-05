import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { RfpWorkspace, emptySnapshot } from "./workspace";
import { blankOpportunity, type Opportunity } from "@/domain/rfps";
import type { RfpService } from "@/data/supabase/rfps";
afterEach(cleanup);
const service = { create: vi.fn(), update: vi.fn() } as unknown as RfpService;
const row = {
  ...blankOpportunity,
  id: "test",
  title: "QA opportunity",
  source_name: "QA issuer",
  stage: "captured",
  kind: "grant",
  source_state: "unchecked",
} as Opportunity;
it("keeps discovery disconnected and empty state truthful", () => {
  render(<RfpWorkspace service={service} refresh={async () => {}} canWork />);
  expect(screen.getByText("Daily discovery · not connected")).toBeTruthy();
  expect(screen.getByText("Your next opportunity starts here")).toBeTruthy();
});
it("does not show zero counts when database unavailable", () => {
  render(
    <RfpWorkspace service={service} refresh={async () => {}} error="Database not installed" />,
  );
  expect(screen.getByText("Opportunities are unavailable")).toBeTruthy();
  expect(screen.getAllByText("—")).toHaveLength(6);
});
it("blocks submitted stage without evidence record and disables read-only writes", () => {
  render(
    <RfpWorkspace
      service={service}
      refresh={async () => {}}
      data={{ ...emptySnapshot, opportunities: [row] }}
    />,
  );
  expect(
    (screen.getByLabelText("Workflow stage") as HTMLSelectElement).querySelector<HTMLOptionElement>(
      "option[value=submitted]",
    )?.disabled,
  ).toBe(true);
  expect((screen.getByRole("button", { name: "Upload draft" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});
it("filters list and replaces detail when current item is filtered out", () => {
  render(
    <RfpWorkspace
      service={service}
      refresh={async () => {}}
      data={{ ...emptySnapshot, opportunities: [row] }}
    />,
  );
  fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "submitted" } });
  expect(screen.getByText("No matching opportunities")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "QA opportunity" })).toBeNull();
});

it("reports a saved change separately from a failed refresh", async () => {
  const create = vi.fn().mockResolvedValue({ id: "saved" });
  render(
    <RfpWorkspace
      service={{ ...service, create }}
      refresh={async () => {
        throw new Error("offline");
      }}
      canWork
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^Add opportunity$/ }));
  fireEvent.change(screen.getByLabelText("RFP or grant URL"), {
    target: { value: "https://example.org/qa" },
  });
  fireEvent.change(screen.getByLabelText("Source text"), {
    target: { value: "Synthetic capture\nIssued by: QA issuer" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review source" }));
  await screen.findByText("Review opportunity");
  fireEvent.click(screen.getByRole("button", { name: "Create opportunity" }));
  expect(
    await screen.findByText("Saved, but refresh failed. Refresh before making another change."),
  ).toBeTruthy();
  expect(create).toHaveBeenCalledTimes(1);
});

it("saves a Google Doc reference through its own operation", async () => {
  const linkDocument = vi.fn().mockResolvedValue({ id: "doc" });
  render(
    <RfpWorkspace
      service={{ ...service, linkDocument }}
      refresh={async () => {}}
      canWork
      data={{ ...emptySnapshot, opportunities: [row] }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Link Google Doc" }));
  fireEvent.change(screen.getByLabelText("Document title"), {
    target: { value: "Working proposal" },
  });
  fireEvent.change(screen.getByLabelText("Google Doc URL"), {
    target: { value: "https://docs.google.com/document/d/qa/edit" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Google Doc reference" }));
  expect(
    await screen.findByText("Google Doc reference saved. Drive permissions are unchanged."),
  ).toBeTruthy();
  expect(linkDocument).toHaveBeenCalledWith(row, {
    title: "Working proposal",
    url: "https://docs.google.com/document/d/qa/edit",
    note: "",
  });
});
it("appends missing evidence without rewriting the original submission", async () => {
  const amendEvidence = vi.fn().mockResolvedValue({ id: "amendment" });
  render(
    <RfpWorkspace
      service={{ ...service, amendEvidence }}
      refresh={async () => {}}
      canWork
      data={{
        ...emptySnapshot,
        opportunities: [row],
        submissions: [
          {
            id: "submission",
            opportunity_id: "test",
            submitted_at: "2026-01-01T00:00:00Z",
            channel: "Portal",
            reference: "",
            evidence_url: "",
            draft_id: null,
            recorded_at: "2026-01-01T00:00:00Z",
          },
        ],
      }}
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: "Activity (1)" }));
  fireEvent.click(screen.getByRole("button", { name: "Add / correct evidence" }));
  fireEvent.change(screen.getByLabelText("Reason for amendment"), {
    target: { value: "Found receipt" },
  });
  fireEvent.change(screen.getByLabelText("Receipt / reference"), {
    target: { value: "Receipt 123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Append evidence amendment" }));
  expect(
    await screen.findByText("Evidence amendment saved. Earlier records are preserved."),
  ).toBeTruthy();
  expect(amendEvidence).toHaveBeenCalledWith(
    row,
    "submission",
    expect.objectContaining({
      reference: "Receipt 123",
      reason: "Found receipt",
      draft_id: null,
      document_id: null,
    }),
  );
});

it("moves tab selection and keyboard focus with arrows, Home and End", () => {
  render(
    <RfpWorkspace
      service={service}
      refresh={async () => {}}
      data={{ ...emptySnapshot, opportunities: [row] }}
    />,
  );
  const overview = screen.getByRole("tab", { name: "Overview" });
  const drafts = screen.getByRole("tab", { name: "Eligibility" });
  const submissions = screen.getByRole("tab", { name: "Proposal (0)" });
  overview.focus();
  for (const [key, target] of [
    ["ArrowRight", drafts],
    ["End", submissions],
    ["ArrowRight", overview],
    ["ArrowLeft", submissions],
    ["Home", overview],
  ] as const) {
    fireEvent.keyDown(document.activeElement!, { key });
    expect(document.activeElement).toBe(target);
    expect(target.getAttribute("aria-selected")).toBe("true");
    expect(target.tabIndex).toBe(0);
  }
});

it("records minute-level evidence with explicit precision", async () => {
  const recordSubmission = vi.fn().mockResolvedValue({ id: "submission" });
  render(
    <RfpWorkspace
      service={{ ...service, recordSubmission }}
      refresh={async () => {}}
      canWork
      data={{ ...emptySnapshot, opportunities: [row] }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Record external submission" }));
  fireEvent.change(screen.getByLabelText("Submission time precision"), {
    target: { value: "minute" },
  });
  fireEvent.change(screen.getByLabelText("Submitted at (your browser timezone)"), {
    target: { value: "2026-01-05T12:34" },
  });
  fireEvent.change(screen.getByLabelText("Submission channel / recipient"), {
    target: { value: "Email" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Record submission" }));
  expect(
    await screen.findByText(
      "External submission recorded. Review its evidence, then update the workflow stage.",
    ),
  ).toBeTruthy();
  expect(recordSubmission).toHaveBeenCalledWith(
    row,
    expect.objectContaining({
      time_precision: "minute",
      submitted_date: null,
      submitted_at: new Date("2026-01-05T12:34").toISOString(),
    }),
  );
});

it("accounts for every stage and keeps workflow counts aligned with search", () => {
  const stages = [
    "captured",
    "qualifying",
    "review",
    "preparing",
    "ready",
    "submitted",
    "awarded",
    "declined",
    "closed",
  ] as const;
  render(
    <RfpWorkspace
      service={service}
      refresh={async () => {}}
      data={{
        ...emptySnapshot,
        opportunities: stages.map((stage, i) => ({
          ...row,
          id: String(i),
          title: `Item ${stage}`,
          stage,
        })),
      }}
    />,
  );
  const filters = within(screen.getByRole("navigation", { name: "Opportunity workflow filters" }));
  expect(filters.getByRole("button", { name: "All 9" })).toBeTruthy();
  fireEvent.click(filters.getByRole("button", { name: "Needs review 2" }));
  expect(screen.getByText("2 opportunities")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Item qualifying" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search opportunities"), {
    target: { value: "Item review" },
  });
  expect(filters.getByRole("button", { name: "Needs review 1" })).toBeTruthy();
  expect(screen.getByText("1 opportunity")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Item qualifying" })).toBeNull();
});

it("preserves source evidence and requirements in separate detail sections", () => {
  render(
    <RfpWorkspace
      service={service}
      refresh={async () => {}}
      data={{
        ...emptySnapshot,
        opportunities: [
          {
            ...row,
            source_evidence: "Source uncertainty retained",
            requirements: "Original requirements retained",
          },
        ],
      }}
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
  expect(screen.getByText("Source uncertainty retained")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Required docs" }));
  expect(screen.getByText("Original requirements retained")).toBeTruthy();
  expect(
    screen.getByText("These are recorded requirements, not a verified completion checklist."),
  ).toBeTruthy();
});
