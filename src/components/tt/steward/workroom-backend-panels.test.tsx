// @vitest-environment jsdom
/**
 * Fictional, fully in-memory checks for the staged backend panels:
 * - a transport failure keeps the SAME operation id and the user's exact
 *   payload for an explicit retry (defect 1);
 * - verify and reopen receipts render with distinct kinds (defect 4);
 * - run-history truncation is disclosed (defect 4);
 * - an action without stored output content is not offered (defect 5).
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  AiPreparationPanel,
  VerificationPanel,
  type CapabilityState,
} from "./workroom-backend-panels";

afterEach(cleanup);

const enabled: CapabilityState = { kind: "ready" };
const fictionalTask = {
  id: "00000000-0000-4000-8000-000000000099",
  title: "Fictional required task",
  revision: 3,
  status: "open",
} as never;

describe("verification panel operation safety", () => {
  it("keeps the same operation id and the user's note across an uncertain transport retry", async () => {
    let reject: ((reason: Error) => void) | undefined;
    const onVerify = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue({ kind: "verified" });
    render(
      <VerificationPanel
        capability={enabled}
        state={{ kind: "ready", task: { status: "open", revision: 3 }, receipts: [] }}
        task={fictionalTask}
        onVerify={onVerify}
        onReopen={undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Completion evidence note/), {
      target: { value: "Fictional proof recorded for review" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Verify at revision 3/ }));
    reject?.(new Error("network dropped"));
    await screen.findByText(/Outcome unknown/);
    // The user's words are preserved for correction/retry.
    expect(
      (screen.getByLabelText(/Completion evidence note/) as HTMLTextAreaElement).value,
    ).toBe("Fictional proof recorded for review");
    fireEvent.click(screen.getByRole("button", { name: /Retry same operation/ }));
    await waitFor(() => expect(onVerify).toHaveBeenCalledTimes(2));
    const first = onVerify.mock.calls[0]?.[0] as { note: string; operationId: string };
    const second = onVerify.mock.calls[1]?.[0] as { note: string; operationId: string };
    expect(second.operationId).toBe(first.operationId);
    expect(second.note).toBe("Fictional proof recorded for review");
    // A resolved success clears the note for the next deliberate operation.
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/Completion evidence note/) as HTMLTextAreaElement).value,
      ).toBe(""),
    );
  });

  it("renders verify and reopen receipts with distinct kinds, never as one style", () => {
    render(
      <VerificationPanel
        capability={enabled}
        state={{
          kind: "ready",
          task: { status: "open", revision: 3 },
          receipts: [
            {
              id: "r1",
              kind: "verify",
              note: "Fictional verification",
              actorId: "aaaaaaaa-0000-0000-0000-000000000000",
              createdAt: "2026-01-02T10:00:00.000Z",
            },
            {
              id: "r2",
              kind: "reopen",
              note: "Fictional reopen reason",
              actorId: "bbbbbbbb-0000-0000-0000-000000000000",
              createdAt: "2026-01-03T10:00:00.000Z",
            },
          ],
        }}
        task={fictionalTask}
        onVerify={undefined}
        onReopen={undefined}
      />,
    );
    expect(screen.getByText(/Verified · durable receipt/)).toBeTruthy();
    expect(screen.getByText(/Reopened · durable receipt/)).toBeTruthy();
  });
});

describe("preparation panel honesty", () => {
  it("does not offer an action whose output content is not stored, and says why", () => {
    render(
      <AiPreparationPanel
        capability={enabled}
        runs={{ kind: "ready", runs: [], truncated: false }}
        task={fictionalTask}
        meetingId="00000000-0000-4000-8000-000000000011"
        actions={[
          { id: "prepare_brief", label: "Prepare task brief", summary: "draft" },
          {
            id: "review_output",
            label: "Review an attached output",
            summary: "review",
            disabledReason: "stored output content is not supported yet; a URL is not proof of reading",
          },
        ]}
        onRequestRun={undefined}
        onExecuteRun={undefined}
      />,
    );
    const select = screen.getByLabelText("Preparation action") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["prepare_brief"]);
    expect(screen.getByText(/Review an attached output: not offered/)).toBeTruthy();
    expect(screen.getByText(/a URL is not proof of reading/)).toBeTruthy();
  });

  it("discloses run-history truncation instead of implying the list is complete", () => {
    render(
      <AiPreparationPanel
        capability={enabled}
        runs={{
          kind: "ready",
          truncated: true,
          runs: [
            {
              id: "run-1",
              action: "prepare_brief",
              status: "completed",
              artifactText: "Fictional draft",
              artifactDigest: "abcdef0123456789",
              evidenceRefs: ["transcript:abc"],
              failureReason: null,
              clientOperationId: "op-1",
            },
          ],
        }}
        task={fictionalTask}
        meetingId="00000000-0000-4000-8000-000000000011"
        actions={[{ id: "prepare_brief", label: "Prepare task brief", summary: "draft" }]}
        onRequestRun={undefined}
        onExecuteRun={undefined}
      />,
    );
    expect(screen.getByText(/Showing the 20 most recent runs/)).toBeTruthy();
  });
});
