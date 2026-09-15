// @vitest-environment jsdom
/**
 * The reply bar, on the one thing it must never do: lose someone's writing.
 *
 * Save asks for exactly the typed words and the chosen intent, no model is
 * involved, and a save that fails leaves every character on screen.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { ReplyRecordBar } from "./reply-record";
import type { VoiceRegister } from "@/domain/voice";

function Harness({ onSaveWriting }: { onSaveWriting: (r: VoiceRegister, t: string) => Promise<boolean> }) {
  const [value, setValue] = useState("");
  const [register, setRegister] = useState<VoiceRegister>("follow_up");
  return (
    <ReplyRecordBar
      drafting={false}
      busy={false}
      value={value}
      onValueChange={setValue}
      register={register}
      onRegisterChange={setRegister}
      onPrepareDraft={vi.fn()}
      onSaveWriting={async (r, t) => {
        const ok = await onSaveWriting(r, t);
        if (ok) setValue("");
        return ok;
      }}
      onRecordInteraction={vi.fn()}
    />
  );
}

const type = (text: string) =>
  fireEvent.change(screen.getByLabelText("Your reply"), { target: { value: text } });

afterEach(cleanup);

describe("saving your own reply", () => {
  it("cannot be pressed with nothing written", () => {
    render(<Harness onSaveWriting={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Save draft" })).toHaveProperty("disabled", true);
  });

  it("sends the exact words and the chosen intent, and asks no model", async () => {
    const save = vi.fn().mockResolvedValue(true);
    render(<Harness onSaveWriting={save} />);
    fireEvent.click(screen.getByRole("button", { name: "Thank you or sensitive" }));
    type("  Dana, Friday works.  ");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith("sensitive", "Dana, Friday works."));
    await waitFor(() =>
      expect((screen.getByLabelText("Your reply") as HTMLTextAreaElement).value).toBe(""),
    );
  });

  it("keeps every character when the save fails", async () => {
    const save = vi.fn().mockResolvedValue(false);
    render(<Harness onSaveWriting={save} />);
    type("Half-written thought that must survive.");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect((screen.getByLabelText("Your reply") as HTMLTextAreaElement).value).toBe(
      "Half-written thought that must survive.",
    );
  });

  it("keeps preparing a draft as a separate, still-available choice", () => {
    render(<Harness onSaveWriting={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Prepare draft" })).toBeTruthy();
  });
});
