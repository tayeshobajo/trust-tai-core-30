// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HiringWorkspace } from "./workspace";
import { PrivateResume } from "./companions";
import { blankJob, type Application, type Job, type Snapshot } from "@/domain/hiring";
import type { HiringService } from "@/data/supabase/hiring";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const job: Job = {
  ...blankJob(),
  id: "role-a",
  organization_id: "isolated",
  revision: 2,
  title: "Synthetic Builder",
  slug: "synthetic-builder",
  team: "Build",
  status: "open",
};
const app: Application = {
  id: "candidate-a",
  job_id: job.id,
  job_title: job.title,
  full_name: "Synthetic Person",
  email: "person@example.test",
  location: "Test city",
  timezone: "UTC",
  linkedin_url: "",
  portfolio_url: "https://portfolio.example.test",
  resume_path: "private/synthetic.pdf",
  resume_name: "Stored_Synthetic_Resume.pdf",
  answers: {},
  stage: "new",
  owner_id: null,
  next_action: "",
  review_date: null,
  revision: 2,
  created_at: "2026-11-12",
  talent_pool_consent: false,
};
const base: Snapshot = {
  jobs: [
    job,
    { ...job, id: "role-b", title: "Synthetic Draft", slug: "synthetic-draft", status: "draft" },
    { ...job, id: "role-c", title: "Synthetic Closed", slug: "synthetic-closed", status: "closed" },
  ],
  applications: [
    app,
    { ...app, id: "candidate-b", full_name: "Other Synthetic Person", job_id: "role-c" },
  ],
  messages: [],
  events: [],
};
function setup(data = base, candidate = false) {
  const service = {
    load: vi.fn(),
    saveJob: vi.fn(),
    update: vi.fn(),
    note: vi.fn(),
    draft: vi.fn().mockResolvedValue(null),
    resume: vi.fn(),
    providerQA: vi.fn(),
    testSend: vi.fn(),
  } as HiringService;
  const view = render(
    <HiringWorkspace
      data={data}
      service={service}
      refresh={async () => {}}
      loading={false}
      initialId={candidate ? app.id : undefined}
    />,
  );
  return { service, view };
}
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
describe("Approved Hiring companions", () => {
  it("filters canonical role rows by each status and search without writes", () => {
    const { service } = setup();
    click("Roles");
    expect(screen.getAllByRole("row")).toHaveLength(4);
    click("Open (1)");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText(job.title)).toBeTruthy();
    click("Draft (1)");
    expect(screen.getByText("Synthetic Draft")).toBeTruthy();
    click("Closed (1)");
    expect(screen.getByText("Synthetic Closed")).toBeTruthy();
    click("All (3)");
    fireEvent.change(screen.getByLabelText("Search roles"), { target: { value: "Builder" } });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(service.saveJob).not.toHaveBeenCalled();
  });
  it("View applications initializes the actual role filter and keeps it editable", () => {
    const { service } = setup();
    click("Roles");
    fireEvent.click(
      within(screen.getByText(job.title).closest("tr") as HTMLElement).getByRole("button", {
        name: "View applications",
      }),
    );
    expect((screen.getByLabelText("Role") as HTMLSelectElement).value).toBe(job.id);
    expect(screen.getByText("Synthetic Person")).toBeTruthy();
    expect(screen.queryByText("Other Synthetic Person")).toBeNull();
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "" } });
    expect(screen.getByText("Other Synthetic Person")).toBeTruthy();
    expect(service.saveJob).not.toHaveBeenCalled();
  });
  it("Edit retains canonical revision and Duplicate opens an unsaved draft without overwriting", () => {
    const { service } = setup();
    click("Roles");
    click(`Edit ${job.title}`);
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("open");
    expect((screen.getByLabelText("Slug *") as HTMLInputElement).readOnly).toBe(true);
    click("Cancel");
    click(`Duplicate ${job.title} as draft`);
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("draft");
    expect((screen.getByLabelText("Slug *") as HTMLInputElement).value).not.toBe(job.slug);
    expect(service.saveJob).not.toHaveBeenCalled();
    expect(job.status).toBe("open");
  });
  it("Continue draft opens the existing canonical draft", () => {
    const { service } = setup();
    click("Roles");
    click("Continue draft");
    expect((screen.getByLabelText("Role title *") as HTMLInputElement).value).toBe(
      "Synthetic Draft",
    );
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("draft");
    expect(service.saveJob).not.toHaveBeenCalled();
  });
  it("starts with no invented draft and a readonly actual recipient; applicant sending stays disabled", () => {
    const { service } = setup(base, true);
    click("Messages");
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("");
    const recipient = screen.getByLabelText("Recipient") as HTMLInputElement;
    expect(recipient.value).toBe(app.email);
    expect(recipient.readOnly).toBe(true);
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(service.providerQA).not.toHaveBeenCalled();
    expect(service.testSend).not.toHaveBeenCalled();
  });
  it("saves exact human draft once, then previews only the recorded revision", async () => {
    const { service, view } = setup(base, true);
    click("Messages");
    let resolve = () => {};
    vi.mocked(service.draft).mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Human subject" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Human body" } });
    click("Save draft");
    click("Save draft");
    expect(service.draft).toHaveBeenCalledTimes(1);
    expect(service.draft).toHaveBeenCalledWith(
      expect.objectContaining({
        target: app.id,
        expected: 0,
        subject: "Human subject",
        body: "Human body",
      }),
    );
    expect(screen.queryByRole("region", { name: "Email preview" })).toBeNull();
    await act(async () => resolve());
    const args = vi.mocked(service.draft).mock.calls[0]?.[0];
    const message = {
      id: String(args?.["message_id"]),
      application_id: app.id,
      subject: "Human subject",
      body: "Human body",
      revision: 1,
      status: "draft",
      receipt: null,
    };
    view.rerender(
      <HiringWorkspace
        data={{ ...base, messages: [message] }}
        service={service}
        refresh={async () => {}}
        loading={false}
        initialId={app.id}
      />,
    );
    click("Preview / edit");
    expect(screen.getByLabelText("Email preview").textContent).toContain("Human body");
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Unsaved changed" } });
    expect(screen.queryByLabelText("Email preview")).toBeNull();
    expect(service.providerQA).not.toHaveBeenCalled();
    expect(service.testSend).not.toHaveBeenCalled();
  });
  it("retains failed/stale draft inputs without claiming save or send", async () => {
    const { service } = setup(base, true);
    click("Messages");
    vi.mocked(service.draft).mockRejectedValue(new Error("Revision changed"));
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Retained subject" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Retained body" } });
    click("Save draft");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Revision changed"),
    );
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("Retained body");
    expect(service.testSend).not.toHaveBeenCalled();
  });
  it.each(["prepared", "tested", "queued", "sent", "delivered", "failed", "unknown"])(
    "displays recorded %s evidence without fabricated dates",
    (status) => {
      setup(
        {
          ...base,
          messages: [
            {
              id: "message",
              application_id: app.id,
              subject: "Recorded subject",
              body: "Recorded body",
              revision: 7,
              status,
              receipt: "isolated-receipt",
            },
          ],
        },
        true,
      );
      click("Messages");
      expect(screen.getByText(`${status} · v7`)).toBeTruthy();
      expect(screen.getByText("Recorded receipt: isolated-receipt")).toBeTruthy();
      if (["sent", "delivered", "queued", "unknown"].includes(status))
        expect(screen.queryByText("No messages sent yet.")).toBeNull();
    },
  );
  it.each(["failed", "bounced", "sending", "queued", "unknown", "uncertain"])(
    "does not infer no send from a recorded %s attempt with a receipt",
    (status) => {
      const { service } = setup(
        {
          ...base,
          messages: [
            {
              id: "attempt",
              application_id: app.id,
              subject: "Recorded attempt",
              body: "Recorded body",
              revision: 3,
              status,
              receipt: "recorded-attempt-receipt",
            },
          ],
        },
        true,
      );
      click("Messages");
      expect(screen.getByRole("heading", { name: "Recorded delivery attempts" })).toBeTruthy();
      expect(screen.queryByText("No messages sent yet.")).toBeNull();
      expect(screen.getByText(`${status} · v3`)).toBeTruthy();
      expect(service.providerQA).not.toHaveBeenCalled();
      expect(service.testSend).not.toHaveBeenCalled();
    },
  );
  it("does not label a disabled initial acknowledgment as a test", () => {
    const { service } = setup(
      {
        ...base,
        messages: [
          {
            id: "acknowledgment",
            application_id: app.id,
            subject: "Application acknowledgment",
            body: "Recorded acknowledgment",
            revision: 1,
            status: "disabled",
            receipt: null,
          },
        ],
      },
      true,
    );
    click("Messages");
    expect(screen.getByText("Delivery disabled · v1")).toBeTruthy();
    expect(screen.queryByText(/Delivery disabled · test state/)).toBeNull();
    expect(service.testSend).not.toHaveBeenCalled();
    expect(service.providerQA).not.toHaveBeenCalled();
  });
  it("shows only stored résumé and external portfolio without signing on navigation", () => {
    const { service } = setup(base, true);
    click("Documents");
    expect(screen.getByText(app.resume_name)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open portfolio" }).getAttribute("href")).toBe(
      app.portfolio_url,
    );
    expect(service.resume).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Upload|Preview/ })).toBeNull();
  });
  it.each(["Resume access was denied or the file is unavailable.", "Temporary network failure"])(
    "retains safe retry for document error: %s",
    async (error) => {
      const { service } = setup(base, true);
      click("Documents");
      vi.mocked(service.resume)
        .mockRejectedValueOnce(new Error(error))
        .mockResolvedValueOnce("https://files.example.test/temporary");
      click("Download résumé");
      await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(error));
      expect(screen.queryByRole("link", { name: "Open private résumé (60 seconds)" })).toBeNull();
      click("Retry résumé download");
      await waitFor(() =>
        expect(
          screen
            .getByRole("link", { name: "Open private résumé (60 seconds)" })
            .getAttribute("href"),
        ).toBe("https://files.example.test/temporary"),
      );
      expect(service.resume).toHaveBeenCalledTimes(2);
    },
  );
  it("locks repeated signing clicks, expires at 60 seconds, and requests a fresh link", async () => {
    vi.useFakeTimers();
    const service = { resume: vi.fn() } as unknown as HiringService;
    let resolve = (s: string) => {};
    vi.mocked(service.resume)
      .mockImplementationOnce(
        () =>
          new Promise<string>((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce("https://files.example.test/fresh");
    render(<PrivateResume app={app} service={service} />);
    click("Download résumé");
    expect(screen.getByRole("status").textContent).toContain("Checking private file access");
    click("Preparing link…");
    expect(service.resume).toHaveBeenCalledTimes(1);
    await act(async () => resolve("https://files.example.test/first"));
    act(() => vi.advanceTimersByTime(59999));
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://files.example.test/first");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("link")).toBeNull();
    await act(async () => click("Retry résumé download"));
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://files.example.test/fresh");
  });
});
