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
  stage: "client",
  intent: "explore",
  nextAction: null,
  metadata: {},
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

it("filters Notes and Files from loaded records without losing the complete timeline", () => {
  const days = [
    {
      key: "2026-11-03",
      label: "Nov 3",
      events: [
        {
          id: "note",
          kind: "note",
          title: "A recorded note",
          body: "Remember this",
          occurredAt: "2026-11-03T10:00:00Z",
        },
        {
          id: "text",
          kind: "they_texted",
          title: "A received message",
          body: "Hello",
          occurredAt: "2026-11-03T11:00:00Z",
        },
      ],
    },
  ] as ConversationDay[];
  render(
    <ConversationRoom
      relationship={relationship}
      health={health}
      days={days}
      onViewProfile={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Notes" }));
  expect(screen.getByText("A recorded note")).toBeTruthy();
  expect(screen.queryByText("A received message")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Files" }));
  expect(screen.getByText("No files in the loaded history.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
  expect(screen.getByText("A received message")).toBeTruthy();
  expect(screen.getByText("A recorded note")).toBeTruthy();
});

it("keeps history errors visible in Files and does not claim complete history", () => {
  render(
    <ConversationRoom
      relationship={relationship}
      health={health}
      days={[]}
      historyGaps={[{ source: "Email", message: "Unavailable" }]}
      onViewProfile={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Files" }));
  expect(screen.getByText(/This history is incomplete/)).toBeTruthy();
  expect(screen.getByText(/Part of this history could not be read/)).toBeTruthy();
});

it("focuses a separately loaded link while history is pending, then retains it through history arrival and navigation", () => {
  const scroll = vi.fn();
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    const linkedDay = day("2026-09-01", 1);
    linkedDay.events[0]!.messageId = "linked";
    const props = {
      relationship,
      health,
      onViewProfile: vi.fn(),
      focusMessageId: "linked",
      historyLoading: true,
    };
    const rendered = render(<ConversationRoom {...props} days={[]} />);
    expect(screen.getByRole("status").textContent).toContain("Loading stored email history");
    rendered.rerender(<ConversationRoom {...props} days={[linkedDay]} />);
    expect(document.activeElement?.getAttribute("data-message-id")).toBe("linked");
    rendered.rerender(
      <ConversationRoom
        {...props}
        historyLoading={false}
        days={[linkedDay, day("2026-09-02", 1), day("2026-09-03", 1), day("2026-09-04", 1)]}
      />,
    );
    expect(document.activeElement?.getAttribute("data-message-id")).toBe("linked");
    expect(screen.queryByRole("status")).toBeNull();
    const nextDay = day("2026-09-05", 1);
    nextDay.events[0]!.messageId = "next";
    rendered.rerender(
      <ConversationRoom {...props} focusMessageId="next" days={[linkedDay, nextDay]} />,
    );
    expect(document.activeElement?.getAttribute("data-message-id")).toBe("next");
    expect(scroll).toHaveBeenCalled();
  } finally {
    HTMLElement.prototype.scrollIntoView = original;
  }
});
