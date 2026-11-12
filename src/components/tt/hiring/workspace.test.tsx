// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HiringWorkspace } from "./workspace";
import { blankJob, type Snapshot } from "@/domain/hiring";
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
  if (d.applications.length)
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Hiring views" })).getByRole("button", {
        name: "Candidates",
      }),
    );
  return service;
}
describe("Hiring room", () => {
  it("hides global Hiring orientation only while a current candidate is selected", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Hiring" })).toBeTruthy();
    fireEvent.click(screen.getByText("Synthetic Candidate"));
    expect(screen.queryByRole("heading", { name: "Hiring" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Hiring views" })).toBeNull();
    expect(screen.getByRole("button", { name: "All applications" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Candidate views" })).toBeTruthy();
    expect(screen.getByText(/Live applicant emails await separate approval/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "All applications" }));
    expect(screen.getByRole("heading", { name: "Hiring" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Hiring views" })).toBeTruthy();
  });
  it("describes role saves using only the recorded status and revision", () => {
    setup({
      ...data,
      applications: [],
      events: [
        {
          id: "role-event",
          application_id: null,
          actor: null,
          kind: "job.saved",
          detail: { status: "open", revision: 2 },
          created_at: "2026-11-12T19:15:00Z",
        },
      ],
    });
    expect(screen.getByText("Role saved: Status: open. Revision 2.")).toBeTruthy();
    expect(screen.queryByText("Activity: Activity recorded.")).toBeNull();
  });
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
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    expect(screen.queryByText("Approve & test send")).toBeNull();
    fireEvent.click(screen.getByText("Preview / edit"));
    fireEvent.click(screen.getByText("Approve & test send"));
    await waitFor(() => expect(s.testSend).toHaveBeenCalledWith("m", 4));
  });
  it("offers an explicit expiring download link after authorization", async () => {
    const s = setup();
    vi.mocked(s.resume).mockResolvedValue("https://storage.example/signed-synthetic");
    fireEvent.click(screen.getByText("Synthetic Candidate"));
    fireEvent.click(screen.getByText("Download résumé"));
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Open private résumé (60 seconds)" }).getAttribute("href"),
      ).toBe("https://storage.example/signed-synthetic"),
    );
  });
  it("keeps an empty room useful", () => {
    setup({ ...data, applications: [] });
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Hiring views" })).getByRole("button", {
        name: "Candidates",
      }),
    );
    expect(screen.getByText("Room for the right people.")).toBeTruthy();
    fireEvent.click(screen.getByText("Manage jobs"));
    expect(screen.getByText("Create job")).toBeTruthy();
  });
  it("blocks repeated update clicks while saving", async () => {
    const s = setup();
    let resolve = () => {};
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
  it("requires an explicit save with the canonical revision and preserves all four edit fields", async () => {
    const s = setup();
    fireEvent.click(screen.getByText("Synthetic Candidate"));
    fireEvent.change(screen.getByLabelText("Owner"), {
      target: { value: "476e81ff-97d1-4316-9cc3-b8397cdb3fa4" },
    });
    fireEvent.change(screen.getByLabelText("Next action"), {
      target: { value: "Review the application" },
    });
    fireEvent.change(screen.getByLabelText("Review date"), { target: { value: "2026-11-20" } });
    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "reviewing" } });
    expect(s.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Save next step"));
    await waitFor(() =>
      expect(s.update).toHaveBeenCalledWith({
        target: "a",
        expected: 1,
        stage: "reviewing",
        owner_id: "476e81ff-97d1-4316-9cc3-b8397cdb3fa4",
        next_action: "Review the application",
        review_date: "2026-11-20",
      }),
    );
    expect(s.providerQA).not.toHaveBeenCalled();
  });
  it("paginates and filters real snapshot rows", () => {
    setup({
      ...data,
      applications: Array.from({ length: 11 }, (_, i) => ({
        ...app,
        id: String(i),
        full_name: `Candidate ${String(i).padStart(2, "0")}`,
      })),
    });
    expect(screen.getAllByRole("row")).toHaveLength(11);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    fireEvent.change(screen.getByPlaceholderText("Name or email"), {
      target: { value: "Candidate 07" },
    });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("Candidate 07")).toBeTruthy();
  });
  it("keeps document and activity tabs functional without signing on navigation", () => {
    const s = setup();
    fireEvent.click(screen.getByText("Synthetic Candidate"));
    fireEvent.click(screen.getByRole("button", { name: "Documents" }));
    expect(screen.getByText("Only the private application résumé is available.")).toBeTruthy();
    expect(s.resume).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    fireEvent.change(screen.getByLabelText("Add a note"), {
      target: { value: "Reviewed privately" },
    });
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Candidate views" })).getByRole("button", {
        name: "Overview",
      }),
    );
    expect(screen.getByLabelText("Add a note").getAttribute("maxlength")).toBe("5000");
    expect((screen.getByLabelText("Add a note") as HTMLTextAreaElement).value).toBe(
      "Reviewed privately",
    );
  });
  it("preserves stale-save errors and never sends a message", async () => {
    const s = setup();
    vi.mocked(s.update).mockRejectedValue(new Error("Revision changed. Reload before saving."));
    fireEvent.click(screen.getByText("Synthetic Candidate"));
    fireEvent.click(screen.getByText("Save next step"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Revision changed"),
    );
    expect(s.providerQA).not.toHaveBeenCalled();
    expect(s.testSend).not.toHaveBeenCalled();
  });
  it("does not expose provider QA dispatch for ordinary applicants", () => {
    const s = setup({
      ...data,
      messages: [
        {
          id: "m",
          application_id: "a",
          subject: "Saved",
          body: "Saved draft",
          revision: 2,
          status: "draft",
          receipt: null,
        },
      ],
    });
    fireEvent.click(screen.getByText("Synthetic Candidate"));
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    fireEvent.click(screen.getByText("Preview / edit"));
    expect(screen.queryByRole("button", { name: "Approve QA send" })).toBeNull();
    expect(s.providerQA).not.toHaveBeenCalled();
  });
  it("does not turn unavailable or denied snapshots into zero-count dashboards", () => {
    const service = {} as HiringService;
    const view = render(
      <HiringWorkspace service={service} refresh={async () => {}} loading={true} />,
    );
    expect(screen.getByRole("status").textContent).toContain("Opening your private hiring queue");
    expect(screen.queryByText("Total applications")).toBeNull();
    view.rerender(
      <HiringWorkspace
        service={service}
        refresh={async () => {}}
        loading={false}
        error="Hiring access denied"
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("Hiring access denied");
    expect(screen.queryByText("Total applications")).toBeNull();
  });
  it("retains Digital Sales Intern open and AI Builder draft without saving on navigation", () => {
    const s = setup({
      ...data,
      applications: [],
      jobs: [
        {
          ...blankJob(),
          id: "sales",
          organization_id: "test",
          revision: 1,
          title: "Digital Sales Intern",
          slug: "sales",
          status: "open",
        },
        {
          ...blankJob(),
          id: "builder",
          organization_id: "test",
          revision: 1,
          title: "AI Builder",
          slug: "builder",
          status: "draft",
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Roles" }));
    expect(screen.getByText("Digital Sales Intern").closest("article")?.textContent).toContain(
      "open",
    );
    expect(screen.getByText("AI Builder").closest("article")?.textContent).toContain("draft");
    expect(s.saveJob).not.toHaveBeenCalled();
  });
  it("reads a changed saved provider receipt in the current preview", () => {
    const service = {
      update: vi.fn(),
      note: vi.fn(),
      draft: vi.fn(),
      providerQA: vi.fn(),
      testSend: vi.fn(),
      resume: vi.fn(),
      saveJob: vi.fn(),
      load: vi.fn(),
    } as HiringService;
    const message = {
      id: "m",
      application_id: "a",
      subject: "Saved",
      body: "Saved body",
      revision: 2,
      status: "draft",
      receipt: null,
    };
    const view = render(
      <HiringWorkspace
        data={{ ...data, messages: [message] }}
        service={service}
        refresh={async () => {}}
        loading={false}
        initialId="a"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    fireEvent.click(screen.getByText("Preview / edit"));
    view.rerender(
      <HiringWorkspace
        data={{
          ...data,
          messages: [{ ...message, status: "delivered", receipt: "synthetic-receipt" }],
        }}
        service={service}
        refresh={async () => {}}
        loading={false}
        initialId="a"
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Approve & test send" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(safeCalls(service)).toBe(0);
  });
});
function safeCalls(service: HiringService) {
  return (
    vi.mocked(service.providerQA).mock.calls.length + vi.mocked(service.testSend).mock.calls.length
  );
}
