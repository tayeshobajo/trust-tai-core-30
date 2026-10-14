// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Roadmap } from "@/domain/roadmap";
import { prepareTrackerEdit } from "@/domain/roadmap-tracker-edit";
import { toRoadmap } from "@/data/supabase/roadmap-schema";
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn() }));
vi.mock("@/data/roadmap-tracker/editor-client", () => ({
  trackerEditorClient: mocks,
  TrackerSaveError: class extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly current?: Roadmap,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/components/tt/primitives", () => ({
  TTButton: ({
    variant: _v,
    children,
    ...p
  }: React.ComponentProps<"button"> & { variant?: string }) => <button {...p}>{children}</button>,
  TTInput: (p: React.ComponentProps<"input">) => <input {...p} />,
}));
import { TrackerEditor } from "./editor";
import { TrackerSaveError } from "@/data/roadmap-tracker/editor-client";
const user = "22222222-2222-4222-8222-222222222222";
const raw = {
  id: "33333333-3333-4333-8333-333333333333",
  organization_id: "11111111-1111-4111-8111-111111111111",
  subject_label: "Fixture Company",
  status: "draft",
  owner_user_id: user,
  next_move: { action: "Read evidence", because: "Original", tier: "decided" },
  metadata: { outreach_tracker: { fields: { priority: "Normal" } } },
  updated_at: "2026-10-01T00:00:00Z",
  created_at: "2026-10-01T00:00:00Z",
};
function mount(canWork = true) {
  return render(
    <TrackerEditor
      roadmap={toRoadmap(raw)}
      userId={user}
      owners={[{ userId: user, label: "Fixture owner" }]}
      canWork={canWork}
      onSaved={vi.fn()}
    />,
  );
}
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.save.mockImplementation(async (input) => ({
    roadmap: toRoadmap({
      ...raw,
      ...prepareTrackerEdit(
        toRoadmap(raw),
        input.patch,
        user,
        input.operationId,
        "2026-10-14T00:00:00Z",
      ).patch,
    }),
  }));
});
afterEach(cleanup);
it("saves stage, owner, next action and follow-up with visible saved status and history", async () => {
  mount();
  change("Pipeline stage", "Approved");
  change("Next action", "Review the proposal");
  change("Follow-up date", "2026-10-22");
  change("Owner", "");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("Saved. Edit history recorded.")).toBeTruthy();
  expect(mocks.save.mock.calls[0]![0].patch).toEqual({
    pipelineStage: "Approved",
    ownerUserId: null,
    nextAction: "Review the proposal",
    followUpDate: "2026-10-22",
  });
  expect(screen.getByText("Edit history (1)")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});
it("does not offer writes to view-only users", () => {
  mount(false);
  change("Priority", "Urgent");
  expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(mocks.save).not.toHaveBeenCalled();
});
it("preserves a failed draft and requires a readback before retrying", async () => {
  mocks.save.mockRejectedValueOnce(new Error("Network unavailable"));
  mocks.read.mockResolvedValue({ roadmap: toRoadmap(raw) });
  mount();
  change("Next action", "Keep this draft");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("Next action") as HTMLTextAreaElement).value).toBe(
    "Keep this draft",
  );
  expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Check saved state" }));
  await screen.findByText(/Your draft has not been applied/);
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Saved. Edit history recorded.");
  expect(mocks.save.mock.calls[1]![0].operationId).toBe(mocks.save.mock.calls[0]![0].operationId);
});
it("rebases only explicitly edited fields after a conflict, preserving unrelated newer human facts", async () => {
  const current = toRoadmap({
    ...raw,
    metadata: { outreach_tracker: { fields: { priority: "Urgent", clientSignal: "New reply" } } },
  });
  mocks.save.mockRejectedValueOnce(new TrackerSaveError("Changed", 409, current));
  mount();
  change("Next action", "Review next week");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Compare with the latest saved record");
  fireEvent.click(screen.getByRole("button", { name: "Keep draft after review" }));
  expect((screen.getByLabelText("Priority") as HTMLInputElement).value).toBe("Urgent");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[1]![0].patch).toEqual({ nextAction: "Review next week" });
});
it("blocks invalid links without invoking persistence", async () => {
  mount();
  change("Key links", "javascript:alert(1)");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(mocks.save).not.toHaveBeenCalled();
});
it("retries a history mirror warning with the same durable operation, without another edit", async () => {
  const normalSave = mocks.save.getMockImplementation()!;
  let saved: { roadmap: Roadmap };
  mocks.save.mockImplementationOnce(async (input) => {
    saved = await normalSave(input);
    return { ...saved, warning: "Saved; check the saved state to retry history sync." };
  });
  mocks.read.mockImplementation(async () => saved);
  mocks.save.mockImplementationOnce(async () => saved);
  mount();
  change("Next action", "Record this once");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText(/retry history sync/);
  fireEvent.click(screen.getByRole("button", { name: "Check saved state" }));
  await screen.findByText(/Confirmed from edit history; no duplicate edit/);
  expect(mocks.save.mock.calls[1]![0].operationId).toBe(mocks.save.mock.calls[0]![0].operationId);
  expect(screen.getByText("Edit history (1)")).toBeTruthy();
});
