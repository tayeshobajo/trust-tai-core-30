// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StewardPreview } from "./workspace";

afterEach(cleanup);
describe("Steward illustrative user journey", () => {
  it("reviews source, records example proof, and reopens without persistence", () => {
    render(<StewardPreview />);
    const row = screen.getByRole("heading", { name: "Approve the launch page copy" }).closest("article");
    if (!row) throw new Error("Expected deliverable row");
    fireEvent.click(within(row).getByRole("button", { name: /Review & verify/ }));
    expect(screen.getByRole("dialog").textContent).toContain("source at 12:34");
    expect(screen.getByRole("button", { name: "Verify example completion" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("An illustrative review or evidence reference"), { target: { value: "Example copy approval reviewed" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify example completion" }));
    expect(screen.queryByRole("heading", { name: "Approve the launch page copy" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Verified 2" }));
    const done = screen.getByRole("heading", { name: "Approve the launch page copy" }).closest("article");
    if (!done) throw new Error("Expected completed row");
    expect(done.textContent).toContain("Example copy approval reviewed");
    fireEvent.click(within(done).getByRole("button", { name: "Reopen" }));
    fireEvent.click(screen.getByRole("button", { name: "Outstanding 3" }));
    expect(screen.getByRole("heading", { name: "Approve the launch page copy" })).toBeTruthy();
    cleanup();
    render(<StewardPreview />);
    expect(screen.getByRole("button", { name: "Verified 1" })).toBeTruthy();
  });
  it("does not expose a completion action for blocked work", () => {
    render(<StewardPreview />);
    fireEvent.click(screen.getByRole("button", { name: /View blocker/ }));
    expect(screen.queryByRole("button", { name: "Verify example completion" })).toBeNull();
    expect(screen.getByRole("button", { name: "Clear example blocker" }).hasAttribute("disabled")).toBe(true);
  });
  it("keeps unknown owners explicit until an example proposal is confirmed", () => {
    render(<StewardPreview />);
    fireEvent.click(screen.getByRole("button", { name: "Proposals 1" }));
    fireEvent.click(screen.getByRole("button", { name: /Review proposal/ }));
    expect(screen.getByRole("button", { name: "Confirm example work" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Confirm example owner" }), { target: { value: "Morgan" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm example work" }));
    expect(screen.getByRole("button", { name: "Proposals 0" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Outstanding 4" }));
    const row = screen.getByRole("heading", { name: "Check analytics access before launch" }).closest("article");
    expect(row?.textContent).toContain("Morgan");
  });
  it("shows partial coverage and the fully verified meeting as different states", () => {
    render(<StewardPreview />);
    fireEvent.click(screen.getByRole("button", { name: /Website discovery/ }));
    expect(screen.getByText("—/100")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Onboarding handover/ }));
    expect(screen.getByText("100/100")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Every agreed deliverable is verified." })).toBeTruthy();
  });
});