// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelationshipSummary } from "./relationship-summary";
import type { Relationship } from "@/domain/comms";
import type { ConversationHealth } from "@/domain/comms-health";
afterEach(cleanup);
const relationship = {
  id: "test",
  fullName: "Test person",
  stage: "client",
  metadata: {},
} as Relationship;
const health = { status: "quiet", reasons: [] } as unknown as ConversationHealth;
describe("relationship summary", () => {
  it("does not infer an owner, follow-up, email or last correspondence", () => {
    render(
      <RelationshipSummary
        relationship={relationship}
        health={health}
        onContext={vi.fn()}
        onProfile={vi.fn()}
        onInteraction={vi.fn()}
      />,
    );
    expect(screen.getByText("Unassigned")).toBeTruthy();
    expect(screen.getAllByText("Not recorded")).toHaveLength(6);
  });
  it("opens existing context, profile and interaction flows without writing data", () => {
    const onContext = vi.fn(),
      onProfile = vi.fn(),
      onInteraction = vi.fn();
    render(
      <RelationshipSummary
        relationship={relationship}
        health={health}
        onContext={onContext}
        onProfile={onProfile}
        onInteraction={onInteraction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review context & commitments" }));
    fireEvent.click(screen.getByRole("button", { name: "Profile & connections" }));
    fireEvent.click(screen.getByRole("button", { name: "Add interaction or evidence" }));
    expect(onContext).toHaveBeenCalledOnce();
    expect(onProfile).toHaveBeenCalledOnce();
    expect(onInteraction).toHaveBeenCalledOnce();
  });
});
