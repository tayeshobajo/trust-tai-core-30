import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { InterpretationRun } from "@/domain/steward-semantic";
import { SemanticReview } from "./semantic-review";
const run = {
  candidateCount: 1,
  memory: { available: true },
  signals: [
    {
      id: "finding",
      candidateId: "finding",
      disposition: "commitment",
      normalizedMeaning: "Check the invitation journey",
      ownerName: "Alex",
      ownerConfidence: "high",
      truthTier: "inferred",
      confidence: "moderate",
      evidence: [],
      quote: "I will check the invitation journey.",
      at: "00:01:00",
    },
  ],
} as unknown as InterpretationRun;
afterEach(cleanup);
it("does not display confirmation success when persistence rejects", async () => {
  render(
    <SemanticReview
      run={run}
      names={["Alex"]}
      confirmedKeys={new Set()}
      onConfirm={async () => {
        throw new Error("Save rejected");
      }}
    />,
  );
  fireEvent.click(screen.getByText("Review & confirm deliverable"));
  fireEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));
  await screen.findByRole("alert");
  expect(screen.getByText("Save rejected")).toBeTruthy();
  expect(screen.queryByText("Already a commitment in this workspace")).toBeNull();
});
it("waits for taught corrections and blocks confirmation if they cannot persist", async () => {
  const confirm = vi.fn();
  const correct = vi.fn(async () => {
    throw new Error("Correction unavailable");
  });
  render(
    <SemanticReview
      run={run}
      names={["Alex"]}
      confirmedKeys={new Set()}
      onConfirm={confirm}
      onCorrect={correct}
    />,
  );
  fireEvent.click(screen.getByText("Review & confirm deliverable"));
  fireEvent.change(screen.getByLabelText("What this actually is"), {
    target: { value: "Check the complete invitation journey" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Edit & confirm" }));
  await waitFor(() => expect(correct).toHaveBeenCalled());
  await screen.findByText("Correction unavailable");
  expect(confirm).not.toHaveBeenCalled();
});
