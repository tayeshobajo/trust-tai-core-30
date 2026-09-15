// @vitest-environment jsdom
/**
 * The relationship room, on the three things it must not get wrong.
 *
 * A failed history read says so instead of looking like a quiet thread;
 * earlier days stay reachable rather than lost behind the newest exchange;
 * and a narrow screen has a way back to the list. Nothing here sends.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationRoom } from "./conversation-room";
import type { ConversationDay } from "@/data/comms-timeline";
import type { ConversationHealth } from "@/domain/comms-health";
import type { Relationship } from "@/domain/comms";

afterEach(cleanup);

const relationship = {
  id: "rel-1",
  organizationId: "org-1",
  fullName: "Dana Okoye",
  companyName: "Northlight",
  email: "dana@northlight.test",
  stage: "prospect",
  intent: "explore",
  nextAction: null,
} as unknown as Relationship;

const health = { status: "healthy", because: "Replied recently." } as unknown as ConversationHealth;

function day(key: string, count: number): ConversationDay {
  return {
    key,
    label: key,
    events: Array.from({ length: count }, (_, index) => ({
      id: `${key}-${index}`,
      kind: "note",
      occurredAt: `${key}T10:0${index}:00.000Z`,
      body: `Event ${key} ${index}`,
      direction: "inbound",
    })),
  } as unknown as ConversationDay;
}

describe("the relationship room", () => {
  it("says a failed history read is unavailable, never an empty thread", () => {
    render(
      <ConversationRoom
        relationship={relationship}
        days={[]}
        health={health}
        historyGaps={[{ source: "Email", message: "The mailbox read failed." }]}
        onViewProfile={vi.fn()}
      />,
    );

    expect(screen.getByText(/could not be read/i)).toBeTruthy();
    expect(screen.getByText(/The mailbox read failed\./)).toBeTruthy();
    expect(screen.queryByText(/Nothing is on the record yet/i)).toBeNull();
  });

  it("only claims an empty thread when every read succeeded", () => {
    render(
      <ConversationRoom
        relationship={relationship}
        days={[]}
        health={health}
        onViewProfile={vi.fn()}
      />,
    );

    expect(screen.getByText(/Nothing is on the record yet/i)).toBeTruthy();
    expect(screen.queryByText(/could not be read/i)).toBeNull();
  });

  it("keeps earlier days reachable behind a count, and shows them on request", () => {
    const days = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"].map((key) =>
      day(key, 2),
    );

    render(
      <ConversationRoom
        relationship={relationship}
        days={days}
        health={health}
        onViewProfile={vi.fn()}
      />,
    );

    // Two older days, two events each: the count is of real records.
    const toggle = screen.getByRole("button", { name: /Earlier history · 4/ });
    expect(screen.queryByText("Event 2026-09-01 0")).toBeNull();
    expect(screen.getByText("Event 2026-09-05 0")).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.getByText("Event 2026-09-01 0")).toBeTruthy();
  });

  it("offers a way back to the list when one is given", () => {
    const onBack = vi.fn();
    render(
      <ConversationRoom
        relationship={relationship}
        days={[day("2026-09-05", 1)]}
        health={health}
        onBack={onBack}
        onViewProfile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /All people/ }));
    expect(onBack).toHaveBeenCalled();
  });
});
