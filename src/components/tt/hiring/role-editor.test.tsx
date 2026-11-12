// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RoleEditor } from "./role-editor";
import { HiringWorkspace } from "./workspace";
import { blankJob, HIRING_PEOPLE, jobSchema, type Job, type Snapshot } from "@/domain/hiring";
import type { HiringService } from "@/data/supabase/hiring";

afterEach(cleanup);
const full: Job = {
  ...blankJob(),
  id: "synthetic-role",
  organization_id: "synthetic-org",
  revision: 2,
  title: "Synthetic Builder",
  slug: "synthetic-builder",
  team: "Build",
  location: "Test City",
  arrangement: "Part time",
  summary: "Build useful things.",
  about: "First line\nSecond line",
  responsibilities: ["Ship tools", "Review work"],
  requirements: ["Careful judgment"],
  nice_to_have: ["Prototyping"],
  owner_id: HIRING_PEOPLE[2]?.id ?? null,
  status: "open",
  questions: [
    { id: "why", label: "Why build?", required: true },
    { id: "work", label: "What work?", required: false },
    { id: "extra", label: "What else?", required: false },
  ],
};
const snapshot = (jobs: Job[] = []): Snapshot => ({
  jobs,
  applications: [],
  events: [],
  messages: [],
});
function setup(existing?: Job, duplicate: Job | null = null) {
  const save = vi.fn().mockResolvedValue(undefined);
  const read = vi.fn().mockResolvedValue(snapshot(existing ? [existing] : []));
  const close = vi.fn(),
    saved = vi.fn();
  const props = { existing, duplicate, save, read, close, saved };
  const view = render(<RoleEditor {...props} />);
  return { ...props, view };
}
const edit = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const button = (name: string) => screen.getByRole("button", { name });
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

describe("Approved role editor", () => {
  it("lets keyboard users focus the named scrollable preview without saving", () => {
    const s = setup(full);
    const aside = screen.getByRole("complementary", { name: "Job preview and role tips" });
    expect(aside.tabIndex).toBe(0);
    aside.focus();
    expect(document.activeElement).toBe(aside);
    expect(s.save).not.toHaveBeenCalled();
  });
  it("roundtrips every canonical field through save and reopen in an isolated store", async () => {
    let rows: Job[] = [];
    const saves = vi.fn(async (input, existing?: Job) => {
      const row: Job = {
        ...jobSchema.parse(input),
        id: existing?.id ?? "created",
        revision: (existing?.revision ?? 0) + 1,
        organization_id: "test",
      };
      rows = [row];
    });
    function Harness() {
      const [open, setOpen] = useState(true);
      const [savedRow, setSavedRow] = useState<Job>();
      return open ? (
        <RoleEditor
          existing={savedRow}
          duplicate={null}
          save={saves}
          read={async () => snapshot(rows)}
          close={() => setOpen(false)}
          saved={() => {
            setSavedRow(rows[0]);
            setOpen(false);
          }}
        />
      ) : (
        <button onClick={() => setOpen(true)}>Reopen fixture</button>
      );
    }
    render(<Harness />);
    edit("Role title *", full.title);
    edit("Slug *", full.slug);
    edit("Team", full.team);
    edit("Location", full.location);
    edit("Arrangement", full.arrangement);
    edit("Owner", full.owner_id ?? "");
    edit("Summary", full.summary);
    edit("About the role", full.about);
    for (const [add, label, texts] of [
      ["Add responsibility", "Responsibility", full.responsibilities],
      ["Add requirement", "Requirement", full.requirements],
      ["Add nice to have", "Nice to have", full.nice_to_have],
    ] as const) {
      for (const [i, text] of texts.entries()) {
        fireEvent.click(button(add));
        edit(`${label} ${i + 1}`, text);
      }
    }
    edit("Question 1", "Why build?");
    edit("Question 2", "What work?");
    fireEvent.click(screen.getByLabelText("Required question 2"));
    fireEvent.click(button("Add question"));
    edit("Question 3", "What else?");
    fireEvent.click(screen.getByLabelText("Allow applications"));
    fireEvent.click(button("Create role"));
    await waitFor(() => expect(saves).toHaveBeenCalledTimes(1));
    expect(rows[0]).toMatchObject({
      ...jobSchema.parse(full),
      questions: full.questions.map(({ id: _id, ...q }) => q),
    });
    fireEvent.click(button("Reopen fixture"));
    for (const [label, expected] of [
      ["Role title *", full.title],
      ["Slug *", full.slug],
      ["Team", full.team],
      ["Location", full.location],
      ["Arrangement", full.arrangement],
      ["Owner", full.owner_id],
      ["Summary", full.summary],
      ["About the role", full.about],
      ["Responsibility 2", full.responsibilities[1]],
      ["Requirement 1", full.requirements[0]],
      ["Nice to have 1", full.nice_to_have[0]],
      ["Question 3", "What else?"],
      ["Status", "open"],
    ])
      expect(value(String(label))).toBe(expected);
    expect((screen.getByLabelText("Slug *") as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText("Required question 2") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(button("Save changes"));
    await waitFor(() => expect(saves).toHaveBeenCalledTimes(2));
    expect(rows[0]?.revision).toBe(2);
  });
  it.each(["draft", "open", "closed"] as const)(
    "maps %s to intake state and persists the canonical status",
    async (status) => {
      const s = setup(full);
      edit("Status", status);
      expect((screen.getByLabelText("Allow applications") as HTMLInputElement).checked).toBe(
        status === "open",
      );
      fireEvent.click(button("Save changes"));
      await waitFor(() =>
        expect(s.save).toHaveBeenCalledWith({ ...jobSchema.parse(full), status }, full),
      );
    },
  );
  it("Save draft overrides an unsaved Open selection and persists Draft", async () => {
    const s = setup(full);
    fireEvent.click(button("Save draft"));
    await waitFor(() =>
      expect(s.save).toHaveBeenCalledWith({ ...jobSchema.parse(full), status: "draft" }, full),
    );
  });
  it("Allow applications is status Open, not a separate flag; unchecking returns Draft", async () => {
    const s = setup(full);
    fireEvent.click(screen.getByLabelText("Allow applications"));
    expect(value("Status")).toBe("draft");
    fireEvent.click(screen.getByLabelText("Allow applications"));
    expect(value("Status")).toBe("open");
    fireEvent.click(button("Save changes"));
    await waitFor(() => expect(s.save).toHaveBeenCalledWith(jobSchema.parse(full), full));
  });
  it("edits with immutable slug and the original revision", async () => {
    const s = setup(full);
    edit("Role title *", "Changed role");
    fireEvent.click(button("Save changes"));
    await waitFor(() =>
      expect(s.save).toHaveBeenCalledWith(
        { ...jobSchema.parse(full), title: "Changed role" },
        full,
      ),
    );
    expect((screen.getByLabelText("Slug *") as HTMLInputElement).readOnly).toBe(true);
  });
  it("duplicates all content into a new draft, never passes the source for update", async () => {
    const s = setup(undefined, full);
    fireEvent.click(button("Create role"));
    await waitFor(() =>
      expect(s.save).toHaveBeenCalledWith(
        {
          ...jobSchema.parse(full),
          title: full.title + " (copy)",
          slug: full.slug + "-copy",
          status: "draft",
        },
        undefined,
      ),
    );
    expect(full.status).toBe("open");
    expect(full.revision).toBe(2);
  });
  it("updates unsaved preview from identity, text, bullets, questions, owner and status", () => {
    const s = setup(full);
    edit("Role title *", "Unsaved title");
    edit("Summary", "Unsaved summary");
    edit("About the role", "Unsaved about");
    edit("Team", "New team");
    edit("Location", "New place");
    edit("Arrangement", "New arrangement");
    edit("Owner", HIRING_PEOPLE[0]?.id ?? "");
    edit("Responsibility 1", "Unsaved duty");
    edit("Requirement 1", "Unsaved requirement");
    edit("Nice to have 1", "Unsaved strength");
    edit("Question 1", "Unsaved question");
    edit("Status", "closed");
    const preview = screen.getByLabelText("Unsaved role preview");
    for (const text of [
      "Unsaved title",
      "Unsaved summary",
      "Unsaved about",
      "New team",
      "New place",
      "New arrangement",
      "Owner: Tai",
      "Unsaved duty",
      "Unsaved requirement",
      "Unsaved strength",
      "Unsaved question",
      "Closed · Intake off",
    ])
      expect(preview.textContent).toContain(text);
    expect(s.save).not.toHaveBeenCalled();
    expect(within(preview).queryByRole("button")).toBeNull();
  });
  it("requires title, valid slug and nonempty questions before any save", () => {
    const s = setup();
    edit("Question 1", "");
    fireEvent.click(button("Create role"));
    expect(s.save).not.toHaveBeenCalled();
    for (const label of ["Role title *", "Slug *", "Question 1"])
      expect(screen.getByLabelText(label).getAttribute("aria-invalid")).toBe("true");
    edit("Role title *", "Valid role");
    edit("Slug *", "Bad slug");
    fireEvent.click(button("Create role"));
    expect(s.save).not.toHaveBeenCalled();
  });
  it("preserves question IDs/required/order and constrains the canonical 2–3 count", async () => {
    const s = setup(full);
    fireEvent.click(button("Move question 3 up"));
    fireEvent.click(screen.getByLabelText("Required question 2"));
    fireEvent.click(button("Remove question 3"));
    expect((button("Remove question 1") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button("Save changes"));
    await waitFor(() =>
      expect(s.save).toHaveBeenCalledWith(
        {
          ...jobSchema.parse(full),
          questions: [full.questions[0], { ...full.questions[2], required: true }],
        },
        full,
      ),
    );
  });
  it("adds/removes real bullet rows without changing other content", async () => {
    const s = setup(full);
    fireEvent.click(button("Remove responsibility 1"));
    fireEvent.click(button("Add requirement"));
    edit("Requirement 2", "New skill");
    fireEvent.click(button("Save changes"));
    await waitFor(() =>
      expect(s.save).toHaveBeenCalledWith(
        {
          ...jobSchema.parse(full),
          responsibilities: ["Review work"],
          requirements: ["Careful judgment", "New skill"],
        },
        full,
      ),
    );
  });
  it("prevents repeated clicks while a save is pending", async () => {
    const s = setup(full);
    let resolve = () => {};
    s.save.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    fireEvent.click(button("Save changes"));
    fireEvent.click(button("Save draft"));
    expect(s.save).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByLabelText("Role title *") as HTMLInputElement).disabled ||
        screen.getByLabelText("Role title *").closest("fieldset")?.disabled,
    ).toBe(true);
    resolve();
    await waitFor(() => expect(s.saved).toHaveBeenCalledTimes(1));
  });
  it("retains failed inputs and blocks retries until an explicit successful read", async () => {
    const s = setup(full);
    s.save.mockRejectedValue(new Error("synthetic failure"));
    edit("Summary", "Keep this input");
    fireEvent.click(button("Save changes"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Save could not be confirmed"),
    );
    expect(value("Summary")).toBe("Keep this input");
    fireEvent.click(button("Save changes"));
    expect(s.save).toHaveBeenCalledTimes(1);
    s.read.mockRejectedValueOnce(new Error("unavailable"));
    fireEvent.click(button("Check saved role"));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("could not be checked"),
    );
    expect((button("Save changes") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button("Check saved role"));
    await waitFor(() => expect((button("Save changes") as HTMLButtonElement).disabled).toBe(false));
    expect(value("Summary")).toBe("Keep this input");
  });
  it("reconciles interrupted create success without inserting again", async () => {
    const s = setup(undefined, full);
    s.save.mockRejectedValue(new Error("interrupted"));
    s.read.mockResolvedValue(
      snapshot([
        {
          ...full,
          id: "copy",
          title: full.title + " (copy)",
          slug: full.slug + "-copy",
          status: "draft",
          revision: 1,
        },
      ]),
    );
    fireEvent.click(button("Create role"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.click(button("Check saved role"));
    await waitFor(() => expect(s.saved).toHaveBeenCalledTimes(1));
    expect(s.save).toHaveBeenCalledTimes(1);
  });
  it("holds stale edits until explicit review and replacement of saved values", async () => {
    const s = setup(full);
    s.save.mockRejectedValue(new Error("stale"));
    const newer = { ...full, revision: 3, summary: "Other reviewer saved" };
    s.read.mockResolvedValue(snapshot([newer]));
    edit("Summary", "My unsaved text");
    fireEvent.click(button("Save changes"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.click(button("Check saved role"));
    await waitFor(() => expect(button("Replace inputs with saved version")).toBeTruthy());
    expect(value("Summary")).toBe("My unsaved text");
    expect((button("Save changes") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button("Replace inputs with saved version"));
    fireEvent.click(button("Keep editing"));
    expect(value("Summary")).toBe("My unsaved text");
    fireEvent.click(button("Replace inputs with saved version"));
    fireEvent.click(button("Replace unsaved inputs"));
    expect(value("Summary")).toBe("Other reviewer saved");
    s.save.mockResolvedValue(undefined);
    fireEvent.click(button("Save changes"));
    await waitFor(() => expect(s.save).toHaveBeenLastCalledWith(jobSchema.parse(newer), newer));
  });
  it("never converts a collided duplicate create into an update of the source", async () => {
    const s = setup(undefined, full);
    s.save.mockRejectedValueOnce(new Error("slug collision"));
    s.read.mockResolvedValue(snapshot([{ ...full, slug: full.slug + "-copy" }]));
    fireEvent.click(button("Create role"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.click(button("Check saved role"));
    await waitFor(() => expect(button("Keep as new draft")).toBeTruthy());
    fireEvent.click(button("Keep as new draft"));
    edit("Slug *", "synthetic-new-copy");
    fireEvent.click(button("Create role"));
    await waitFor(() => expect(s.save).toHaveBeenCalledTimes(2));
    expect(s.save.mock.calls[1]?.[1]).toBeUndefined();
    expect(full.revision).toBe(2);
  });
  it("holds a newer snapshot revision without resetting unsaved inputs or writing", () => {
    const s = setup(full);
    edit("Summary", "Retained during refresh");
    s.view.rerender(<RoleEditor {...s} currentRevision={3} />);
    fireEvent.click(button("Save changes"));
    expect(s.save).not.toHaveBeenCalled();
    expect(value("Summary")).toBe("Retained during refresh");
    expect(screen.getByRole("alert").textContent).toContain("changed while you were editing");
  });
  it("warns on dirty cancel/back and never saves through discard", () => {
    const s = setup(full);
    edit("Summary", "Unsaved");
    fireEvent.click(button("Cancel"));
    expect(s.close).not.toHaveBeenCalled();
    fireEvent.click(button("Keep editing"));
    expect(value("Summary")).toBe("Unsaved");
    fireEvent.click(button("Hiring / Roles"));
    fireEvent.click(button("Discard changes"));
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(s.save).not.toHaveBeenCalled();
  });
  it("warns on browser unload with dirty inputs", () => {
    setup(full);
    edit("Summary", "Unsaved");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
  it("blocks navigation links when dirty discard is declined", () => {
    setup(full);
    edit("Summary", "Unsaved");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const link = document.createElement("a");
    link.href = "/modules/hiring";
    document.body.append(link);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(value("Summary")).toBe("Unsaved");
    link.remove();
    confirm.mockRestore();
  });
  it("dedicated editor replaces global views without touching live-role fixture status", () => {
    const service = { saveJob: vi.fn() } as unknown as HiringService;
    render(
      <HiringWorkspace
        data={snapshot([full])}
        service={service}
        loading={false}
        refresh={async () => {}}
      />,
    );
    fireEvent.click(button("Roles"));
    fireEvent.click(button("Edit Synthetic Builder"));
    expect(screen.queryByRole("navigation", { name: "Hiring views" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Roles worth doing" })).toBeNull();
    expect(value("Status")).toBe("open");
    expect(service.saveJob).not.toHaveBeenCalled();
  });
});
