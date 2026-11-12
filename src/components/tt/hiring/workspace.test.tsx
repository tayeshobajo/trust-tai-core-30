import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HiringWorkspace } from "./workspace";
import type { Snapshot } from "@/domain/hiring";
import type { HiringService } from "@/data/supabase/hiring";
afterEach(cleanup);
const app = {
  id: "a",
  job_id: "j",
  job_title: "Engineer",
  full_name: "Synthetic Candidate",
  email: "candidate@example.test",
  location: "Test City",
  timezone: "UTC",
  linkedin_url: "",
  portfolio_url: "",
  resume_path: "private/resume.pdf",
  resume_name: "resume.pdf",
  answers: { why: { label: "Why?", answer: "Synthetic answer" } },
  stage: "new" as const,
  owner_id: null,
  next_action: "",
  review_date: null,
  revision: 1,
  created_at: "2026-11-12",
  talent_pool_consent: false,
};
const data: Snapshot = { jobs: [], applications: [app], events: [], messages: [] };
function setup(d = data) {
  const service = {
    update: vi.fn().mockResolvedValue(null),
    note: vi.fn().mockResolvedValue(null),
    draft: vi.fn().mockResolvedValue(null),
    providerQA: vi.fn(),
    testSend: vi.fn().mockResolvedValue("test"),
    resume: vi.fn(),
    saveJob: vi.fn(),
    load: vi.fn(),
  } as HiringService;
  render(<HiringWorkspace data={d} service={service} refresh={async () => {}} loading={false} />);
  return service;
}
describe("Hiring room", () => {
  it("separates stage edits from communication", async () => {
    const s = setup();
    fireEvent.click(screen.getByText("Synthetic Candidate"));
    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "interview" } });
    fireEvent.click(screen.getByText("Save next step"));
    await waitFor(() => expect(s.update).toHaveBeenCalledTimes(1));
    expect(s.testSend).not.toHaveBeenCalled();
    expect(s.draft).not.toHaveBeenCalled();
    expect(screen.getByText("Application updated. No email was sent.")).toBeTruthy();
  });
  it("opens the exact saved message and deliberately tests it", async () => {
    const s = setup({
      ...data,
      messages: [
        {
          id: "m",
          application_id: "a",
          subject: "Saved subject",
          body: "Saved body",
          revision: 4,
          status: "draft",
          receipt: null,
        },
      ],
    });
    fireEvent.click(screen.getByText("Synthetic Candidate"));
    expect(screen.queryByText("Approve & test send")).toBeNull();
    fireEvent.click(screen.getByText("Preview / edit"));
    fireEvent.click(screen.getByText("Approve & test send"));
    await waitFor(() => expect(s.testSend).toHaveBeenCalledWith("m", 4));
  });
  it("keeps an empty room useful", () => {
    setup({ ...data, applications: [] });
    expect(screen.getByText("Room for the right people.")).toBeTruthy();
    fireEvent.click(screen.getByText("Manage jobs"));
    expect(screen.getByText("Create job")).toBeTruthy();
  });
  it("blocks repeated update clicks while saving", async () => {
    const s = setup();
    let resolve!: () => void;
    vi.mocked(s.update).mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    fireEvent.click(screen.getByText("Synthetic Candidate"));
    const save = screen.getByText("Save next step");
    fireEvent.click(save);
    fireEvent.click(save);
    expect(s.update).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() =>
      expect(screen.getByText("Application updated. No email was sent.")).toBeTruthy(),
    );
  });
});
