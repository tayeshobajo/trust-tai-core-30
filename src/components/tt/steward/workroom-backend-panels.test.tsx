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
  ScopeReviewPanel,
  VerificationPanel,
  type CapabilityState,
} from "./workroom-backend-panels";

afterEach(cleanup);

const enabled: CapabilityState = { kind: "enabled" };
const fictionalTask = {
  id: "00000000-0000-4000-8000-000000000099",
  title: "Fictional required task",
  revision: 3,
  status: "open",
};

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
        task={fictionalTask as never}
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
    expect((screen.getByLabelText(/Completion evidence note/) as HTMLTextAreaElement).value).toBe(
      "Fictional proof recorded for review",
    );
    fireEvent.click(screen.getByRole("button", { name: /Retry same operation/ }));
    await waitFor(() => expect(onVerify).toHaveBeenCalledTimes(2));
    const first = onVerify.mock.calls[0]?.[0] as { note: string; operationId: string };
    const second = onVerify.mock.calls[1]?.[0] as { note: string; operationId: string };
    expect(second.operationId).toBe(first.operationId);
    expect(second.note).toBe("Fictional proof recorded for review");
    // A resolved success clears the note for the next deliberate operation.
    await waitFor(() =>
      expect((screen.getByLabelText(/Completion evidence note/) as HTMLTextAreaElement).value).toBe(
        "",
      ),
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
        task={fictionalTask as never}
        onVerify={undefined}
        onReopen={undefined}
      />,
    );
    expect(screen.getByText(/Verified · durable receipt/)).toBeTruthy();
    expect(screen.getByText(/Reopened · durable receipt/)).toBeTruthy();
  });

  it("replays the exact original verify tuple after state refresh, revision bump and note edits", async () => {
    /* Defect 1: an uncertain-but-committed verify followed by a background
       refetch (status now complete, revision bumped) must NOT turn the
       retry into a reopen, and edits to the note field must not replace
       the captured note or mint a new operation id. */
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
    const onReopen = vi.fn().mockResolvedValue({ kind: "reopened" });
    const { rerender } = render(
      <VerificationPanel
        capability={enabled}
        state={{ kind: "ready", task: { status: "open", revision: 3 }, receipts: [] }}
        task={fictionalTask as never}
        onVerify={onVerify}
        onReopen={onReopen}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Completion evidence note/), {
      target: { value: "Fictional proof recorded for review" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Verify at revision 3/ }));
    reject?.(new Error("network dropped"));
    await screen.findByText(/Outcome unknown/);

    /* Background refetch: the verify actually committed — status is now
       complete and the revision moved on. */
    rerender(
      <VerificationPanel
        capability={enabled}
        state={{ kind: "ready", task: { status: "complete", revision: 4 }, receipts: [] }}
        task={{ ...fictionalTask, revision: 4, status: "complete" } as never}
        onVerify={onVerify}
        onReopen={onReopen}
      />,
    );
    /* The user edits the note field after the uncertain attempt. */
    fireEvent.change(screen.getByLabelText(/Reopen reason|Completion evidence note/), {
      target: { value: "Edited after the fact — must not be sent" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Retry same operation/ }));
    await waitFor(() => expect(onVerify).toHaveBeenCalledTimes(2));
    expect(onReopen).not.toHaveBeenCalled();
    const first = onVerify.mock.calls[0]?.[0] as {
      kind?: string;
      note: string;
      operationId: string;
      expectedRevision: number;
      taskId: string;
    };
    const second = onVerify.mock.calls[1]?.[0] as typeof first;
    expect(second.operationId).toBe(first.operationId);
    expect(second.note).toBe("Fictional proof recorded for review");
    expect(second.expectedRevision).toBe(3);
    expect(second.taskId).toBe(fictionalTask.id);
  });

  it("blocks a new deliberate action while an operation outcome is unknown", async () => {
    let reject: ((reason: Error) => void) | undefined;
    const onVerify = vi.fn().mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    render(
      <VerificationPanel
        capability={enabled}
        state={{ kind: "ready", task: { status: "open", revision: 3 }, receipts: [] }}
        task={fictionalTask as never}
        onVerify={onVerify}
        onReopen={undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Completion evidence note/), {
      target: { value: "Fictional proof recorded for review" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Verify at revision 3/ }));
    reject?.(new Error("network dropped"));
    await waitFor(() => expect(screen.getAllByText(/Outcome unknown/).length).toBeGreaterThan(0));
    const verifyButton = screen.getByRole("button", { name: /Verify at revision 3/ });
    expect((verifyButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(verifyButton);
    expect(onVerify).toHaveBeenCalledTimes(1);
  });
});

describe("scope review source binding", () => {
  const scopeReady = {
    kind: "ready" as const,
    counts: { denominator: 2, verified: 0, pendingProposals: 0 },
  };

  it("replays the attestation bound to the ORIGINAL reviewed source after the source changes", async () => {
    /* Defect 2: the transcript changes while the human's attestation is in
       flight; the retry must carry the hash/version captured at the click,
       never the newer source. */
    let reject: ((reason: Error) => void) | undefined;
    const onAttest = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue({ kind: "attested" });
    const props = {
      scope: scopeReady,
      coverage: { kind: "ready" as const, current: false, attestedAt: null },
      proposals: { kind: "ready" as const, proposals: [], decisions: [] },
      scopeCapability: enabled,
      coverageCapability: enabled,
      proposalCapability: enabled,
      linkTargets: [],
      onSyncProposals: undefined,
      onSyncRequiredScope: undefined,
      onLinkProposal: undefined,
      onDismissProposal: undefined,
    };
    const { rerender } = render(
      <ScopeReviewPanel
        {...props}
        expectedSource={{ transcriptHash: "hash-a", scopeVersion: 1 }}
        onAttestCoverage={onAttest}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Attest current transcript coverage/ }));
    reject?.(new Error("network dropped"));
    await waitFor(() => expect(screen.getAllByText(/Outcome unknown/).length).toBeGreaterThan(0));

    /* The transcript changed during review: a new hash and scope version
       arrive from a refetch. */
    rerender(
      <ScopeReviewPanel
        {...props}
        expectedSource={{ transcriptHash: "hash-b", scopeVersion: 2 }}
        onAttestCoverage={onAttest}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Retry same operation/ }));
    await waitFor(() => expect(onAttest).toHaveBeenCalledTimes(2));
    const first = onAttest.mock.calls[0]?.[0] as {
      operationId: string;
      expectedTranscriptHash: string;
      expectedScopeVersion: number;
    };
    const second = onAttest.mock.calls[1]?.[0] as typeof first;
    expect(second.operationId).toBe(first.operationId);
    expect(second.expectedTranscriptHash).toBe("hash-a");
    expect(second.expectedScopeVersion).toBe(1);
  });
});

describe("preparation panel honesty", () => {
  it("does not offer an action whose output content is not stored, and says why", () => {
    render(
      <AiPreparationPanel
        capability={enabled}
        runs={{ kind: "ready", runs: [], truncated: false }}
        task={fictionalTask as never}
        meetingId="00000000-0000-4000-8000-000000000011"
        actions={[
          { id: "prepare_brief", label: "Prepare task brief", summary: "draft" },
          {
            id: "review_output",
            label: "Review an attached output",
            summary: "review",
            disabledReason:
              "stored output content is not supported yet; a URL is not proof of reading",
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
              status: "complete",
              artifactText: "Fictional draft",
              artifactDigest: "abcdef0123456789",
              evidenceRefs: ["transcript:abc"],
              failureReason: null,
              clientOperationId: "op-1",
            },
          ],
        }}
        task={fictionalTask as never}
        meetingId="00000000-0000-4000-8000-000000000011"
        actions={[{ id: "prepare_brief", label: "Prepare task brief", summary: "draft" }]}
        onRequestRun={undefined}
        onExecuteRun={undefined}
      />,
    );
    expect(screen.getByText(/Showing the 20 most recent runs/)).toBeTruthy();
  });
});

/* Defect A/B/D: proposal link/dismiss frozen retries, uncertain handler
   outcomes keeping the operation pending, and audited scope
   remove/reinstate controls. */
const fictionalProposal = {
  id: "prop-1",
  statement: "Fictional proposal statement",
  status: "proposed" as const,
  evidence: [{ label: "39:48 roadmap mention" }],
};
const scopeReady = {
  kind: "ready" as const,
  counts: { denominator: 1, verified: 0, pendingProposals: 1 },
  items: [
    {
      id: "item-1",
      taskId: "00000000-0000-4000-8000-000000000099",
      classification: "manual_required",
      removedAt: null as string | null,
    },
  ],
};
const proposalsReady = {
  kind: "ready" as const,
  proposals: [fictionalProposal],
  decisions: [],
};

function renderScopePanel(overrides: Partial<Parameters<typeof ScopeReviewPanel>[0]> = {}) {
  return render(
    <ScopeReviewPanel
      scope={scopeReady}
      coverage={undefined}
      proposals={proposalsReady}
      scopeCapability={enabled}
      coverageCapability={enabled}
      proposalCapability={enabled}
      linkTargets={[
        { id: "00000000-0000-4000-8000-000000000099", title: "Fictional required task" },
        { id: "00000000-0000-4000-8000-000000000100", title: "Another fictional task" },
      ]}
      expectedSource={null}
      onAttestCoverage={undefined}
      onSyncProposals={undefined}
      onSyncRequiredScope={undefined}
      onLinkProposal={undefined}
      onDismissProposal={undefined}
      onRemoveScopeItem={undefined}
      onReinstateScopeItem={undefined}
      {...overrides}
    />,
  );
}

describe("proposal link/dismiss operation safety", () => {
  it("replays the exact original link tuple after the dropdown selection changes", async () => {
    let reject: ((reason: Error) => void) | undefined;
    const onLinkProposal = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue({ kind: "applied" });
    renderScopePanel({ onLinkProposal });
    fireEvent.change(
      screen.getByLabelText(/Link Fictional proposal statement to an existing task/),
      { target: { value: "00000000-0000-4000-8000-000000000099" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    reject?.(new Error("network dropped"));
    await screen.findByText(/Outcome unknown/);
    // Change the dropdown AFTER the failure — the retry must not follow it.
    fireEvent.change(
      screen.getByLabelText(/Link Fictional proposal statement to an existing task/),
      { target: { value: "00000000-0000-4000-8000-000000000100" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Retry same operation \(link\)/ }));
    await waitFor(() => expect(onLinkProposal).toHaveBeenCalledTimes(2));
    const first = onLinkProposal.mock.calls[0]?.[0] as {
      proposalId: string;
      taskId: string;
      operationId: string;
    };
    const second = onLinkProposal.mock.calls[1]?.[0] as typeof first;
    expect(second.operationId).toBe(first.operationId);
    expect(second.taskId).toBe("00000000-0000-4000-8000-000000000099");
    expect(second.proposalId).toBe("prop-1");
  });

  it("replays the exact original dismiss reason after the reason field is edited", async () => {
    let reject: ((reason: Error) => void) | undefined;
    const onDismissProposal = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue({ kind: "applied" });
    renderScopePanel({ onDismissProposal });
    fireEvent.change(screen.getByLabelText(/Dismiss reason for Fictional proposal statement/), {
      target: { value: "duplicate of an existing task" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    reject?.(new Error("network dropped"));
    await screen.findByText(/Outcome unknown/);
    fireEvent.change(screen.getByLabelText(/Dismiss reason for Fictional proposal statement/), {
      target: { value: "a completely different edited reason" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Retry same operation \(dismiss\)/ }));
    await waitFor(() => expect(onDismissProposal).toHaveBeenCalledTimes(2));
    const first = onDismissProposal.mock.calls[0]?.[0] as {
      reason: string;
      operationId: string;
    };
    const second = onDismissProposal.mock.calls[1]?.[0] as typeof first;
    expect(second.operationId).toBe(first.operationId);
    expect(second.reason).toBe("duplicate of an existing task");
  });

  it("keeps the operation pending when the handler reports an uncertain outcome", async () => {
    const onLinkProposal = vi
      .fn()
      .mockResolvedValueOnce({ kind: "uncertain", message: "response lost" })
      .mockResolvedValue({ kind: "applied" });
    renderScopePanel({ onLinkProposal });
    fireEvent.change(
      screen.getByLabelText(/Link Fictional proposal statement to an existing task/),
      { target: { value: "00000000-0000-4000-8000-000000000099" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    await screen.findByText(/Outcome unknown/);
    fireEvent.click(screen.getByRole("button", { name: /Retry same operation \(link\)/ }));
    await waitFor(() => expect(onLinkProposal).toHaveBeenCalledTimes(2));
    const first = onLinkProposal.mock.calls[0]?.[0] as { operationId: string };
    const second = onLinkProposal.mock.calls[1]?.[0] as typeof first;
    expect(second.operationId).toBe(first.operationId);
  });
});

describe("receipt-backed verified state", () => {
  it("raw board complete without a verify receipt is NOT verified — Verify is offered, not Reopen", () => {
    render(
      <VerificationPanel
        capability={enabled}
        state={{
          kind: "ready",
          verified: false,
          task: { status: "complete", revision: 4 },
          receipts: [],
        }}
        task={{ ...fictionalTask, revision: 4, status: "complete" } as never}
        onVerify={vi.fn()}
        onReopen={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Completion evidence note/)).toBeTruthy();
    expect(screen.queryByLabelText(/Reopen reason/)).toBeNull();
  });

  it("a receipt-backed verified task offers Reopen", () => {
    render(
      <VerificationPanel
        capability={enabled}
        state={{
          kind: "ready",
          verified: true,
          task: { status: "complete", revision: 4 },
          receipts: [
            {
              id: "r1",
              kind: "verify",
              note: "Fictional verification",
              actorId: "aaaaaaaa-0000-0000-0000-000000000000",
              createdAt: "2026-01-02T10:00:00.000Z",
            },
          ],
        }}
        task={{ ...fictionalTask, revision: 4, status: "complete" } as never}
        onVerify={vi.fn()}
        onReopen={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Reopen reason/)).toBeTruthy();
    expect(screen.queryByLabelText(/Completion evidence note/)).toBeNull();
  });
});

describe("scope amendment controls", () => {
  it("replays the exact original removal after the reason field is edited", async () => {
    let reject: ((reason: Error) => void) | undefined;
    const onRemoveScopeItem = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue({ kind: "applied" });
    renderScopePanel({ onRemoveScopeItem });
    fireEvent.click(screen.getByText(/Recorded scope items/));
    fireEvent.change(screen.getByLabelText(/Removal reason for task/i), {
      target: { value: "recorded against the wrong meeting" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Remove from scope/ }));
    reject?.(new Error("network dropped"));
    await screen.findByText(/Outcome unknown/);
    fireEvent.change(screen.getByLabelText(/Removal reason for task/i), {
      target: { value: "an edited reason that must not be sent" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Retry same operation \(remove\)/ }));
    await waitFor(() => expect(onRemoveScopeItem).toHaveBeenCalledTimes(2));
    const first = onRemoveScopeItem.mock.calls[0]?.[0] as {
      itemId: string;
      reason: string;
      operationId: string;
    };
    const second = onRemoveScopeItem.mock.calls[1]?.[0] as typeof first;
    expect(second.operationId).toBe(first.operationId);
    expect(second.itemId).toBe("item-1");
    expect(second.reason).toBe("recorded against the wrong meeting");
  });

  it("offers Reinstate for a removed item only when the handler exists", async () => {
    const onReinstateScopeItem = vi.fn().mockResolvedValue({ kind: "applied" });
    renderScopePanel({
      scope: {
        ...scopeReady,
        items: [{ ...scopeReady.items[0]!, removedAt: "2026-01-05T10:00:00.000Z" }],
      },
      onReinstateScopeItem,
    });
    fireEvent.click(screen.getByText(/Recorded scope items/));
    expect(screen.getByText(/removed from the denominator/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Reinstate reason for task/i), {
      target: { value: "reinstating after review with Tai" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Reinstate in scope/ }));
    await waitFor(() => expect(onReinstateScopeItem).toHaveBeenCalledTimes(1));
    const call = onReinstateScopeItem.mock.calls[0]?.[0] as {
      itemId: string;
      reason: string;
      operationId: string;
    };
    expect(call.itemId).toBe("item-1");
    expect(call.reason).toBe("reinstating after review with Tai");
    expect(call.operationId).toBeTruthy();
  });
});
