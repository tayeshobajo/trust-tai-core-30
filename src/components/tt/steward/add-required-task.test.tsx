// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AddRequiredTask } from "./add-required-task";
afterEach(cleanup);
const meetingId = "00000000-0000-4000-8000-000000000011";
describe("manual required-work add dialog with fictional saves", () => {
  it("validates acknowledgement and title before save, deduplicates submit and retries the same operation", async () => {
    let reject: ((reason: Error) => void) | undefined;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue(undefined);
    const close = vi.fn();
    render(
      <AddRequiredTask
        meetingId={meetingId}
        meetingTitle="Fictional"
        onSave={save}
        onClose={close}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Missed required action" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    fireEvent.submit(
      screen.getByRole("button", { name: "Saving…" }).closest("form") as HTMLFormElement,
    );
    expect(save).toHaveBeenCalledTimes(1);
    reject?.(new Error("Fictional save failed"));
    await screen.findByRole("button", { name: "Retry add task" });
    fireEvent.click(screen.getByRole("button", { name: "Retry add task" }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[1]?.[0]).toEqual(save.mock.calls[0]?.[0]);
    expect(save.mock.calls[0]?.[0].meetingId).toBe(meetingId);
  });
});
