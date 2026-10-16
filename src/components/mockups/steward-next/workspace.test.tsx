// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StewardPreview } from "./workspace";

afterEach(cleanup);
describe("Steward illustrative user journey", () => {
  it("reviews source, records example proof, and reopens without persistence", () => {
    render(<StewardPreview />);
    const row = screen
      .getByRole("heading", { name: "Approve the launch page copy" })
      .closest("article");
    if (!row) throw new Error("Expected deliverable row");
    fireEvent.click(within(row).getByRole("button", { name: /Review & verify/ }));
    expect(screen.getByRole("dialog").textContent).toContain("source at 12:34");
    expect(
      screen.getByRole("button", { name: "Verify example completion" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("An illustrative review or evidence reference"), {
      target: { value: "Example copy approval reviewed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify example completion" }));
    expect(screen.queryByRole("heading", { name: "Approve the launch page copy" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Verified\s*2$/ }));
    const done = screen
      .getByRole("heading", { name: "Approve the launch page copy" })
      .closest("article");
    if (!done) throw new Error("Expected completed row");
    expect(done.textContent).toContain("Example copy approval reviewed");
    fireEvent.click(within(done).getByRole("button", { name: "Reopen" }));
    expect(screen.getByRole("button", { name: "Record example reopening" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Reopen reason" }), { target: { value: "Example copy needs a correction" } });
    fireEvent.click(screen.getByRole("button", { name: "Record example reopening" }));
    expect(screen.getByRole("region", { name: "Illustrative receipt history" }).textContent).toContain("Example copy approval reviewed");
    expect(screen.getByRole("region", { name: "Illustrative receipt history" }).textContent).toContain("Example copy needs a correction");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: /^Outstanding\s*3$/ }));
    expect(screen.getByRole("heading", { name: "Approve the launch page copy" })).toBeTruthy();
    cleanup();
    render(<StewardPreview />);
    expect(screen.getByRole("button", { name: /^Verified\s*1$/ })).toBeTruthy();
  });
  it("retains two completion receipts and two reopen reasons through the actual dialog", () => {
    render(<StewardPreview />);
    for (const cycle of [1, 2]) {
      fireEvent.click(screen.getByRole("button", { name: /^Outstanding\s*3$/ }));
      const row = screen.getByRole("heading", { name: "Approve the launch page copy" }).closest("article");
      if (!row) throw new Error("Expected work row");
      fireEvent.click(within(row).getByRole("button", { name: /Review & verify/ }));
      fireEvent.change(screen.getByPlaceholderText("An illustrative review or evidence reference"), { target: { value: `Proof ${cycle}` } });
      fireEvent.click(screen.getByRole("button", { name: "Verify example completion" }));
      fireEvent.click(screen.getByRole("button", { name: /^Verified\s*2$/ }));
      const done = screen.getByRole("heading", { name: "Approve the launch page copy" }).closest("article");
      if (!done) throw new Error("Expected completed work");
      fireEvent.click(within(done).getByRole("button", { name: "Reopen" }));
      fireEvent.change(screen.getByRole("textbox", { name: "Reopen reason" }), { target: { value: `Reason ${cycle}` } });
      fireEvent.click(screen.getByRole("button", { name: "Record example reopening" }));
      const history = screen.getByRole("region", { name: "Illustrative receipt history" });
      expect(within(history).getAllByRole("listitem")).toHaveLength(cycle * 2);
      expect(history.textContent).toContain("Proof 1");
      expect(history.textContent).toContain("Reason 1");
      expect(history.textContent).toContain("Alex (fictional)");
      if (cycle === 2) {
        expect(history.textContent).toContain("Proof 2");
        expect(history.textContent).toContain("Reason 2");
      }
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    }
  });
  it("does not expose a completion action for blocked work", () => {
    render(<StewardPreview />);
    fireEvent.click(screen.getByRole("button", { name: /View blocker/ }));
    expect(screen.queryByRole("button", { name: "Verify example completion" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Clear example blocker" }).hasAttribute("disabled"),
    ).toBe(true);
  });
  it("keeps unknown owners explicit until an example proposal is confirmed", () => {
    render(<StewardPreview />);
    fireEvent.click(screen.getByRole("button", { name: /^Proposals\s*1$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Review proposal/ }));
    expect(
      screen.getByRole("button", { name: "Confirm example work" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Confirm example owner" }), {
      target: { value: "Morgan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm example work" }));
    expect(screen.getByRole("button", { name: /^Proposals\s*0$/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Outstanding\s*4$/ }));
    const row = screen
      .getByRole("heading", { name: "Check analytics access before launch" })
      .closest("article");
    expect(row?.textContent).toContain("Morgan");
  });
  it("shows partial coverage and the fully verified meeting as different states", () => {
    render(<StewardPreview />);
    fireEvent.click(screen.getByRole("button", { name: /Website discovery/ }));
    expect(screen.getByText("—/100")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Onboarding handover/ }));
    expect(screen.getAllByText("100/100")[0]).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Every agreed deliverable is verified." }),
    ).toBeTruthy();
  });
});
