// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CorrespondenceReview } from "./correspondence-review";
import { reviewFixture, reviewScope } from "@/domain/roadmap-correspondence-review.fixtures";
afterEach(cleanup);
it("requires explicit review before confirmation and preserves exact text as text", async () => {
  const fixture = structuredClone(reviewFixture);
  fixture.envelope.selections[0]!.event.bodyText = '<img src="https://invalid.test/tracker">';
  const action = vi
    .fn()
    .mockResolvedValueOnce(fixture)
    .mockResolvedValueOnce({
      ...fixture,
      approvedAt: "2026-11-03T12:00:00Z",
      approvedBy: fixture.envelope.approverId,
    });
  const { container } = render(<CorrespondenceReview scope={reviewScope} action={action} />);
  await screen.findByText(/Approval fingerprint/);
  expect(container.querySelector("img")).toBeNull();
  const button = screen.getByRole("button", { name: "Approve exact correspondence scope" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(button);
  await screen.findByText(/Approved by/);
  expect(action.mock.calls[1]).toEqual([reviewScope, true]);
});
it("clears all private text after failed confirmation", async () => {
  const action = vi
    .fn()
    .mockResolvedValueOnce(reviewFixture)
    .mockRejectedValueOnce(new Error("denied"));
  render(<CorrespondenceReview scope={reviewScope} action={action} />);
  await screen.findByText(/Approval fingerprint/);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("alert");
  await waitFor(() =>
    expect(screen.queryByText(reviewFixture.envelope.selections[0]!.event.bodyText)).toBeNull(),
  );
});
