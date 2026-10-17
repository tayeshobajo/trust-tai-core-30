// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StewardPreview } from "./workspace";
beforeAll(() => {
  window.matchMedia = vi
    .fn()
    .mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
});
afterEach(cleanup);
const select = (title: string) =>
  fireEvent.click(screen.getByRole("button", { name: `Select task: ${title}` }));
const proof = (value: string) =>
  fireEvent.change(screen.getByRole("textbox", { name: "Completion reference" }), {
    target: { value },
  });
describe("Approved Steward fictional interactions", () => {
  it("requires nonblank evidence and retains four receipts through repeated cycles", () => {
    render(<StewardPreview />);
    for (const cycle of [1, 2]) {
      proof("  ");
      expect(
        screen.getByRole("button", { name: "Verify completion" }).hasAttribute("disabled"),
      ).toBe(true);
      proof(`Proof ${cycle}`);
      fireEvent.click(screen.getByRole("button", { name: "Verify completion" }));
      fireEvent.click(screen.getByRole("button", { name: "Reopen deliverable" }));
      fireEvent.change(screen.getByRole("textbox", { name: "Reopen reason" }), {
        target: { value: " " },
      });
      expect(
        screen.getByRole("button", { name: "Record example reopening" }).hasAttribute("disabled"),
      ).toBe(true);
      fireEvent.change(screen.getByRole("textbox", { name: "Reopen reason" }), {
        target: { value: `Reason ${cycle}` },
      });
      fireEvent.click(screen.getByRole("button", { name: "Record example reopening" }));
      const history = screen.getByRole("region", { name: "Illustrative receipt history" });
      expect(within(history).getAllByRole("listitem")).toHaveLength(cycle * 2);
      expect(history.textContent).toContain("Proof 1");
      expect(history.textContent).toContain("Reason 1");
      expect(history.textContent).toContain("Alex (fictional)");
    }
    cleanup();
    render(<StewardPreview />);
    expect(screen.getByRole("button", { name: /Completed 3/ })).toBeTruthy();
  });
  it("blocks completion until the dependency is verified, then requires its own evidence", () => {
    render(<StewardPreview />);
    select("Build the launch page");
    expect(screen.queryByRole("button", { name: "Verify completion" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Clear example blocker" }).hasAttribute("disabled"),
    ).toBe(true);
    select("Approve the launch page copy");
    proof("Example approval");
    fireEvent.click(screen.getByRole("button", { name: "Verify completion" }));
    select("Build the launch page");
    fireEvent.click(screen.getByRole("button", { name: "Clear example blocker" }));
    expect(screen.getByRole("button", { name: "Verify completion" }).hasAttribute("disabled")).toBe(
      true,
    );
  });
  it("requires an explicit proposal owner and updates the agreed denominator", () => {
    render(<StewardPreview />);
    select("Check analytics access before launch");
    expect(
      screen.getByRole("button", { name: "Confirm example work" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Confirm example owner" }), {
      target: { value: "Morgan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm example work" }));
    expect(screen.getByRole("button", { name: /Proposed 0/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open 9/ })).toBeTruthy();
    expect(screen.getByLabelText("Meeting work completion")).toBeTruthy();
  });
  it("keeps partial coverage unknown and cross-meeting work available", () => {
    render(<StewardPreview />);
    fireEvent.click(screen.getByRole("button", { name: /Website discovery/ }));
    expect(screen.getByText("—/100")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "All outstanding work" }));
    expect(screen.getByRole("button", { name: /Select task: Bring two homepage/ })).toBeTruthy();
  });
  it("filters fictional tasks by owner, status and search without changing completion", () => {
    render(<StewardPreview />);
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by owner" }), {
      target: { value: "Unassigned" },
    });
    expect(document.querySelectorAll("[data-task-row]")).toHaveLength(1);
    fireEvent.change(screen.getByRole("textbox", { name: "Search tasks" }), {
      target: { value: "no-match" },
    });
    expect(document.querySelectorAll("[data-task-row]")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "View all tasks" }));
    expect(document.querySelectorAll("[data-task-row]")).toHaveLength(12);
  });
  it("prepares illustrative help without writing receipts or completing work", async () => {
    render(<StewardPreview />);
    fireEvent.click(screen.getByRole("button", { name: "Prepare review" }));
    expect(await screen.findByText("Illustrative review · no model execution")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Completed 3/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByText("No completion receipts yet.")).toBeTruthy();
  });
});
