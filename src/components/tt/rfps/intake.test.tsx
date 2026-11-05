import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { OpportunityIntake } from "./intake";
import type { RfpService } from "@/data/supabase/rfps";
import { blankOpportunity, type Opportunity } from "@/domain/rfps";
const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock("@/lib/rfp-source-file", () => ({ readSourceFile: readFile }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function mount(overrides: Partial<RfpService> = {}, opportunities: Opportunity[] = []) {
  const create = vi.fn().mockResolvedValue({ id: "new" });
  const preserveSource = vi.fn().mockResolvedValue({ id: "source" });
  const readSource = vi.fn();
  const complete = vi.fn();
  const open = vi.fn();
  const service = { create, preserveSource, readSource, ...overrides } as unknown as RfpService;
  render(
    <OpportunityIntake
      service={service}
      opportunities={opportunities}
      onComplete={complete}
      onExisting={open}
    />,
  );
  return { create, preserveSource, readSource, complete, open };
}
async function reviewUrl(text = "Title: Website services\nIssued by: Test Board") {
  fireEvent.change(screen.getByLabelText("RFP or grant URL"), {
    target: { value: "https://example.org/rfp" },
  });
  fireEvent.change(screen.getByLabelText("Source text"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Review source" }));
  await screen.findByText("Review opportunity");
}
it("reviews pasted fields without fetching the URL or inventing eligibility", async () => {
  const { create, readSource, complete } = mount();
  expect(screen.getByText(/Automatic URL reading is not connected/)).toBeTruthy();
  await reviewUrl();
  expect(create).not.toHaveBeenCalled();
  expect(readSource).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Issuing organization (if known)") as HTMLInputElement).value).toBe(
    "Test Board",
  );
  fireEvent.click(screen.getByRole("button", { name: "Create opportunity" }));
  await vi.waitFor(() => expect(complete).toHaveBeenCalled());
  expect(create.mock.calls[0]?.[0]).toMatchObject({
    eligibility: "unknown",
    source_url: "https://example.org/rfp",
  });
  expect(create.mock.calls[0]?.[0].source_evidence).toContain("page was not fetched");
});
it("permits a URL reference with manually entered title, leaving unknown fields blank", async () => {
  const { create, readSource } = mount();
  await reviewUrl("");
  expect((screen.getByLabelText("Opportunity title *") as HTMLInputElement).value).toBe("");
  expect(
    (screen.getByLabelText("Solicitation ID / round (if known)") as HTMLInputElement).value,
  ).toBe("");
  fireEvent.change(screen.getByLabelText("Opportunity title *"), {
    target: { value: "Verified source title" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create opportunity" }));
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(readSource).not.toHaveBeenCalled();
});
it("opens a matching source rather than silently creating a duplicate", async () => {
  const { create, open } = mount({}, [
    {
      ...blankOpportunity,
      id: "existing",
      title: "Existing",
      source_url: "https://example.org/rfp",
      cycle: "2026",
    } as Opportunity,
  ]);
  await reviewUrl();
  expect(
    (screen.getByRole("button", { name: "Create opportunity" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Open existing opportunity" }));
  expect(open).toHaveBeenCalledWith("existing");
  expect(create).not.toHaveBeenCalled();
});
it("keeps incomplete URL edits reviewable rather than crashing", async () => {
  const { create } = mount({}, [
    {
      ...blankOpportunity,
      id: "existing",
      source_url: "https://example.org/old",
      cycle: "2026",
    } as Opportunity,
  ]);
  await reviewUrl();
  fireEvent.change(screen.getByLabelText("Source URL (optional for a document)"), {
    target: { value: "https:" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create opportunity" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(create).not.toHaveBeenCalled();
});
async function reviewFile() {
  readFile.mockResolvedValue({
    fileName: "source.pdf",
    sha256: "a".repeat(64),
    text: "Title: Website services",
  });
  fireEvent.click(screen.getByRole("button", { name: "Choose a document" }));
  const file = new File(["synthetic"], "source.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("Choose source document"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Read document & review" }));
  await screen.findByText("Review opportunity");
  return file;
}
it("creates file-first intake with a hash, no invented URL, and a separate source file", async () => {
  const { create, preserveSource, complete, readSource } = mount();
  const file = await reviewFile();
  fireEvent.click(screen.getByRole("button", { name: "Create opportunity" }));
  await vi.waitFor(() => expect(complete).toHaveBeenCalled());
  expect(create.mock.calls[0]?.[0]).toMatchObject({
    source_url: "",
    source_file_sha256: "a".repeat(64),
    source_name: "",
    cycle: "",
  });
  expect(preserveSource).toHaveBeenCalledWith({ id: "new" }, file, "a".repeat(64));
  expect(readSource).not.toHaveBeenCalled();
});
it("does not repeat a creation after the separate file step fails", async () => {
  const preserveSource = vi.fn().mockRejectedValue(new Error("Transfer failed"));
  const { create, complete } = mount({ preserveSource });
  await reviewFile();
  fireEvent.click(screen.getByRole("button", { name: "Create opportunity" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("Do not create it again"),
  );
  expect(screen.queryByRole("button", { name: "Create opportunity" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open created opportunity" }));
  expect(create).toHaveBeenCalledTimes(1);
  expect(preserveSource).toHaveBeenCalledTimes(1);
  expect(complete).toHaveBeenCalled();
});
