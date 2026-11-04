import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
  expect(screen.getAllByText("—")).toHaveLength(5);
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
  fireEvent.change(screen.getByLabelText("Opportunity title *"), {
    target: { value: "Synthetic capture" },
  });
  fireEvent.change(screen.getByLabelText("Issuing organization *"), {
    target: { value: "QA issuer" },
  });
  fireEvent.change(screen.getByLabelText("Official source URL *"), {
    target: { value: "https://example.org/qa" },
  });
  fireEvent.change(screen.getByLabelText("Application cycle / solicitation ID *"), {
    target: { value: "QA" },
  });
  fireEvent.change(screen.getByLabelText("Source evidence / relevant excerpt *"), {
    target: { value: "Synthetic source note" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save opportunity" }));
  expect(
    await screen.findByText(
      "The change completed, but the latest records could not be loaded. Refresh before making another change.",
    ),
  ).toBeTruthy();
  expect(create).toHaveBeenCalledTimes(1);
});
